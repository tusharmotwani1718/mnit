import type { FactDef, NextQuestion, Scheme, SchemeResult } from "./types.js";

/**
 * Picks the askable fact that the most open schemes are waiting on.
 * Only schemes in `topics` count when topics are given. Ties go to the lower `priority`.
 * A fact with its own `topics` is only asked when one of them is among the caller's topics.
 */
export function nextQuestion(
  results: SchemeResult[],
  schemes: Scheme[],
  defs: Record<string, FactDef>,
  topics?: string[],
): NextQuestion | null {
  const byId = new Map(schemes.map((s) => [s.id, s]));
  const inScope = (r: SchemeResult) =>
    !topics?.length || (byId.get(r.schemeId)?.topics ?? []).some((t) => topics.includes(t));

  const askable = (f: string) => {
    const def = defs[f];
    if (!def?.askable) return false;
    return !def.topics || def.topics.some((t) => topics?.includes(t));
  };

  const counts = new Map<string, number>();
  for (const r of results) {
    if (r.status !== "need_more_info" || !inScope(r)) continue;
    for (const f of r.missingFacts) if (askable(f)) counts.set(f, (counts.get(f) ?? 0) + 1);
  }

  const priority = (f: string) => defs[f]?.priority ?? Number.MAX_SAFE_INTEGER;
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || priority(a[0]) - priority(b[0]))[0];
  if (!best) return null;
  const ask = defs[best[0]]?.ask;
  if (!ask) throw new Error(`Askable fact "${best[0]}" has no ask prompt`);
  return { fact: best[0], ask, resolves: best[1] };
}
