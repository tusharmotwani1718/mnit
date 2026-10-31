import type { FactDef, Facts } from "./types.js";

/**
 * Applies `derives` from the vocabulary until nothing changes.
 * A fact the caller stated always wins over a derived value.
 */
export function applyDerivations(stated: Facts, defs: Record<string, FactDef>): Facts {
  const facts: Facts = { ...stated };
  let changed = true;
  while (changed) {
    changed = false;
    for (const [key, value] of Object.entries(facts)) {
      for (const d of defs[key]?.derives ?? []) {
        if (d.when !== value) continue;
        for (const [target, targetValue] of Object.entries(d.set)) {
          if (target in stated || target in facts) continue;
          facts[target] = targetValue;
          changed = true;
        }
      }
    }
  }
  return facts;
}
