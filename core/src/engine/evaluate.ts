import type { Cond, FactCond, FactDef, Facts, FactValue, LeafTrace, Scheme, SchemeResult, Tri } from "./types.js";

type Outcome = { tri: Tri; missing: Set<string>; caveats: FactCond[]; manualChecks: string[] };

type Mode = {
  /** Second pass: a non-askable fact that is still unknown counts as false. */
  pessimistic: boolean;
  askable: (fact: string) => boolean;
  trace?: LeafTrace[];
};

const FALSE: Outcome = { tri: false, missing: new Set(), caveats: [], manualChecks: [] };

function merge(outs: Outcome[], tri: Tri): Outcome {
  return {
    tri,
    missing: new Set(outs.flatMap((o) => [...o.missing])),
    caveats: outs.flatMap((o) => o.caveats),
    manualChecks: outs.flatMap((o) => o.manualChecks),
  };
}

function compare(c: FactCond, v: FactValue): boolean {
  switch (c.op) {
    case "eq":
      return v === c.value;
    case "in":
      return Array.isArray(c.value) && c.value.includes(v);
    case "lte":
      return typeof v === "number" && v <= (c.value as number);
    case "gte":
      return typeof v === "number" && v >= (c.value as number);
  }
}

function evalCond(c: Cond, facts: Facts, mode: Mode): Outcome {
  if ("all" in c) {
    const outs = c.all.map((x) => evalCond(x, facts, mode));
    if (outs.some((o) => o.tri === false)) return FALSE;
    return merge(outs, outs.every((o) => o.tri === true) ? true : "unknown");
  }
  if ("any" in c) {
    const outs = c.any.map((x) => evalCond(x, facts, mode));
    const trues = outs.filter((o) => o.tri === true);
    if (trues.length) {
      // Prefer the satisfied branch that needs the fewest assumptions.
      const best = trues.reduce((a, b) => (b.caveats.length < a.caveats.length ? b : a));
      return { ...best, missing: new Set(), manualChecks: [] };
    }
    if (outs.every((o) => o.tri === false)) return FALSE;
    return merge(outs.filter((o) => o.tri === "unknown"), "unknown");
  }
  if ("not" in c) {
    const o = evalCond(c.not, facts, mode);
    return { ...o, tri: o.tri === "unknown" ? "unknown" : !o.tri, caveats: [] };
  }
  if ("manualCheck" in c) {
    mode.trace?.push({ manualCheck: c.manualCheck, result: "unknown" });
    return { tri: "unknown", missing: new Set(), caveats: [], manualChecks: [c.manualCheck] };
  }

  const actual = facts[c.fact];
  let out: Outcome;
  if (actual !== undefined) {
    out = { ...FALSE, tri: compare(c, actual) };
  } else if (c.assumeIfUnknown) {
    out = { tri: true, missing: new Set(), caveats: [c], manualChecks: [] };
  } else if (mode.pessimistic && !mode.askable(c.fact)) {
    out = FALSE;
  } else {
    out = { tri: "unknown", missing: new Set([c.fact]), caveats: [], manualChecks: [] };
  }
  mode.trace?.push({
    fact: c.fact,
    op: c.op,
    expected: c.value,
    actual,
    result: out.tri,
    assumed: actual === undefined && !!c.assumeIfUnknown,
  });
  return out;
}

/**
 * Three-valued evaluation of one scheme.
 * - false → not_eligible; true → eligible
 * - unknown with askable facts missing → need_more_info
 * - otherwise re-evaluate treating unvolunteered non-askable facts as false:
 *   still unknown means only manual checks remain → likely_eligible.
 */
export function evaluateScheme(scheme: Scheme, facts: Facts, defs: Record<string, FactDef>): SchemeResult {
  const askable = (f: string) => defs[f]?.askable ?? false;
  const trace: LeafTrace[] = [];
  const first = evalCond(scheme.rules, facts, { pessimistic: false, askable, trace });

  const result = (status: SchemeResult["status"], o: Outcome, missingFacts: string[] = []): SchemeResult => ({
    schemeId: scheme.id,
    status,
    missingFacts,
    caveats: o.caveats.flatMap((c) => (c.caveat ? [c.caveat] : [])),
    manualChecks: o.manualChecks,
    trace,
  });

  if (first.tri === true) return result("eligible", first);
  if (first.tri === false) return result("not_eligible", first);

  const askableMissing = [...first.missing].filter(askable);
  if (askableMissing.length) return result("need_more_info", first, askableMissing);

  const second = evalCond(scheme.rules, facts, { pessimistic: true, askable });
  if (second.tri === "unknown") return result("likely_eligible", second);
  return result(second.tri ? "eligible" : "not_eligible", second);
}
