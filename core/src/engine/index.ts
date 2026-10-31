import { applyDerivations } from "./derive.js";
import { evaluateScheme } from "./evaluate.js";
import { loadSchemes, loadVocabulary } from "./loader.js";
import { nextQuestion } from "./nextQuestion.js";
import type { FactDef, Facts, NextQuestion, Scheme, SchemeResult } from "./types.js";

export * from "./types.js";
export { toHectares } from "./units.js";
export { applyDerivations, evaluateScheme, nextQuestion };

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

/** Loads approved schemes and the fact vocabulary from data/. */
export function loadEngine(dataDir?: string): Engine {
  const facts = loadVocabulary(dataDir);
  return createEngine(facts, loadSchemes(facts, { dataDir }));
}
