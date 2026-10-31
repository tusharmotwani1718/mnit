import { applyDerivations } from "./derive.js";
import { evaluateCondition, evaluateScheme } from "./evaluate.js";
import type { Cond, FactCond, FactDef, Facts, FactValue, Scheme, SchemeStatus, Tri } from "./types.js";

/**
 * Application readiness: how ready someone's application to one scheme is, from the scheme's own rules.
 * Not a prediction of approval (there is no approval data): every point comes from a rule, a document or the bank account.
 *
 *   60 points  eligibility conditions (met = full, assumed / checked at the office = half, unknown = none)
 *   30 points  documents the person already has
 *   10 points  a bank account (benefits are paid by DBT)
 *   Any condition that clearly fails caps the score at 20: "not eligible".
 */
export const POINTS = { conditions: 60, documents: 30, bank: 10 } as const;
export const NOT_ELIGIBLE_CAP = 20;

export type Band = "ready" | "almost" | "missing_info" | "not_eligible";

export type Leaf = { fact: string; op: FactCond["op"]; expected: unknown } | { manualCheck: string };

export type ReadinessRow = {
  /** One condition, or a group where meeting any option is enough. */
  options: Leaf[][];
  result: Tri;
  /** Met only through an assumption (rare exclusion) or an office check. */
  partial: boolean;
  /** Facts that would settle this condition, for the form. */
  missing: string[];
  points: number;
  max: number;
};

export type Readiness = {
  schemeId: string;
  status: SchemeStatus;
  score: number;
  band: Band;
  rows: ReadinessRow[];
  documents: { name: string; have: boolean }[];
  points: { conditions: number; documents: number; bank: number };
  bank: Tri;
  /** A sample applicant who meets every condition, generated from the rules, with all documents and a bank account. */
  ideal: { name: string; gender: "female" | "male"; facts: Facts; score: number };
  /** All facts the rules use (to show and fill in), in rule order. */
  facts: string[];
};

const leavesOf = (c: Cond): Leaf[] => {
  if ("all" in c) return c.all.flatMap(leavesOf);
  if ("any" in c) return c.any.flatMap(leavesOf);
  if ("not" in c) return leavesOf(c.not);
  if ("manualCheck" in c) return [{ manualCheck: c.manualCheck }];
  return [{ fact: c.fact, op: c.op, expected: c.value }];
};

/** Top-level conditions of a scheme, each a row; `any` groups stay one row with their options. */
function rowConds(rules: Cond): Cond[] {
  return "all" in rules ? rules.all : [rules];
}

/** Picks the conditions a model applicant meets: everything under `all`, the first fact-based option of an `any`. */
function chosenLeaves(c: Cond): FactCond[] {
  if ("all" in c) return c.all.flatMap(chosenLeaves);
  if ("any" in c) {
    for (const option of c.any) {
      const picked = chosenLeaves(option);
      if (picked.length) return picked;
    }
    return [];
  }
  if ("not" in c || "manualCheck" in c) return [];
  return [c];
}

const roundNice = (n: number) => (n >= 10000 ? Math.round(n / 1000) * 1000 : n >= 100 ? Math.round(n / 10) * 10 : Math.round(n * 2) / 2);

/** Values that satisfy the chosen conditions; numbers sit comfortably inside their limits. */
export function idealFacts(scheme: Scheme): Facts {
  const facts: Facts = {};
  const bounds = new Map<string, { lo?: number; hi?: number }>();
  for (const c of chosenLeaves(scheme.rules)) {
    if (c.op === "eq") facts[c.fact] = c.value as FactValue;
    else if (c.op === "in") facts[c.fact] = (c.value as FactValue[])[0]!;
    else {
      const b = bounds.get(c.fact) ?? {};
      if (c.op === "lte") b.hi = Math.min(b.hi ?? Infinity, c.value as number);
      else b.lo = Math.max(b.lo ?? -Infinity, c.value as number);
      bounds.set(c.fact, b);
    }
  }
  for (const [fact, { lo, hi }] of bounds) {
    let v: number;
    if (lo !== undefined && hi !== undefined) v = roundNice((lo + hi) / 2);
    else if (hi !== undefined) v = roundNice(hi * 0.75);
    // A typical value above a minimum: "18 or older" gives 28, "65 or older" gives 68.
    else v = lo! < 30 ? lo! + 10 : Math.round(lo! + Math.max(1, lo! * 0.05));
    // Ages, incomes and counts are whole numbers; land (hectares) may be fractional.
    facts[fact] = fact === "landHectares" ? v : Math.round(v);
  }
  return facts;
}

// Sample names (same in every script the web app shows them in; it transliterates via its own table).
const NAMES = { female: ["Sunita", "Priya", "Lata", "Meena"], male: ["Ramesh", "Suresh", "Ganesh", "Vijay"] } as const;

function idealName(scheme: Scheme, facts: Facts): { name: string; gender: "female" | "male" } {
  const gender = facts.gender === "female" || facts.isWidowOrSingleWoman === true || facts.isPregnantOrLactating === true ? "female" : "male";
  const seed = [...scheme.id].reduce((n, ch) => n + ch.charCodeAt(0), 0);
  return { name: NAMES[gender][seed % NAMES[gender].length]!, gender };
}

const band = (score: number, status: SchemeStatus): Band =>
  status === "not_eligible" ? "not_eligible" : score >= 80 ? "ready" : score >= 50 ? "almost" : "missing_info";

/**
 * @param stated facts the person gave (derivations are applied here)
 * @param documentsHave English names of the scheme's documents the person already has
 */
export function readiness(scheme: Scheme, stated: Facts, documentsHave: string[], defs: Record<string, FactDef>): Readiness {
  const result = score(scheme, stated, documentsHave, defs);
  const idealStated = { ...idealFacts(scheme), hasBankAccount: true };
  const idealScore = score(scheme, idealStated, scheme.documents.map((d) => d.en), defs).score;
  return { ...result, ideal: { ...idealName(scheme, idealStated), facts: idealStated, score: idealScore } };
}

function score(scheme: Scheme, stated: Facts, documentsHave: string[], defs: Record<string, FactDef>): Omit<Readiness, "ideal"> {
  const facts = applyDerivations(stated, defs);
  const conds = rowConds(scheme.rules);
  const perRow = POINTS.conditions / conds.length;

  const rows: ReadinessRow[] = conds.map((c) => {
    const options = "any" in c ? c.any.map(leavesOf) : [leavesOf(c)];
    const r = evaluateCondition(c, facts);
    // An office check that hasn't happened yet isn't a failure; an unknown fact is just unanswered.
    const partial = r.result === true ? r.assumed || r.manual : r.result === "unknown" && r.manual && r.missing.length === 0;
    const share = r.result === true ? (partial ? 0.5 : 1) : partial ? 0.5 : 0;
    return { options, result: r.result, partial, missing: r.missing, points: perRow * share, max: perRow };
  });

  const status = evaluateScheme(scheme, facts, defs).status;
  const failed = rows.some((r) => r.result === false);

  const have = new Set(documentsHave);
  const documents = scheme.documents.map((d) => ({ name: d.en, have: have.has(d.en) }));
  const bank: Tri = facts.hasBankAccount === undefined ? "unknown" : facts.hasBankAccount === true;

  const points = {
    conditions: Math.round(rows.reduce((n, r) => n + r.points, 0)),
    documents: documents.length ? Math.round((POINTS.documents * documents.filter((d) => d.have).length) / documents.length) : POINTS.documents,
    bank: bank === true ? POINTS.bank : 0,
  };
  const total = points.conditions + points.documents + points.bank;
  const score = failed ? Math.min(total, NOT_ELIGIBLE_CAP) : total;

  const factOrder = [...new Set(leavesOf(scheme.rules).flatMap((l) => ("fact" in l ? [l.fact] : [])))];

  return {
    schemeId: scheme.id,
    status: failed ? "not_eligible" : status,
    score,
    band: band(score, failed ? "not_eligible" : status),
    rows,
    documents,
    points,
    bank,
    facts: factOrder,
  };
}
