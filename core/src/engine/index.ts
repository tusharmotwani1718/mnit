import { applyDerivations } from "./derive.js";
import { evaluateScheme } from "./evaluate.js";
import { loadSchemes, loadVocabulary } from "./loader.js";
import { nextQuestion } from "./nextQuestion.js";
import type { FactDef, Facts, NextQuestion, Scheme, SchemeResult } from "./types.js";

export * from "./types.js";
export { toHectares } from "./units.js";
export { applyDerivations, evaluateScheme, nextQuestion };
export { readiness, idealFacts, POINTS, NOT_ELIGIBLE_CAP, type Readiness, type ReadinessRow, type Band, type Leaf } from "./readiness.js";

export type Evaluation = {
  facts: Facts; // stated + derived
  results: SchemeResult[];
  next: NextQuestion | null;
};

export type Engine = {
  facts: Record<string, FactDef>;
  schemes: Scheme[];
  evaluate(stated: Facts, opts?: { topics?: string[] }): Evaluation;
};

export function createEngine(facts: Record<string, FactDef>, schemes: Scheme[]): Engine {
  return {
    facts,
    schemes,
    evaluate(stated, { topics } = {}) {
      const all = applyDerivations(stated, facts);
      const results = schemes.map((s) => evaluateScheme(s, all, facts));
      return { facts: all, results, next: nextQuestion(results, schemes, facts, topics) };
    },
  };
}

/** Keeps only known facts with values of the right type (for facts coming from a profile or a request). */
export function cleanFacts(defs: Record<string, FactDef>, facts: Record<string, unknown>): Facts {
  const out: Facts = {};
  for (const [key, value] of Object.entries(facts)) {
    const def = defs[key];
    if (!def || value === null || value === undefined) continue;
    if (def.type === "enum" && !(typeof value === "string" && def.values?.includes(value))) continue;
    if (def.type === "number" && !(typeof value === "number" && Number.isFinite(value))) continue;
    if (def.type === "boolean" && typeof value !== "boolean") continue;
    if (def.type === "string" && typeof value !== "string") continue;
    out[key] = value as Facts[string];
  }
  return out;
}

/** Loads approved schemes and the fact vocabulary from data/. */
export function loadEngine(dataDir?: string): Engine {
  const facts = loadVocabulary(dataDir);
  return createEngine(facts, loadSchemes(facts, { dataDir }));
}
