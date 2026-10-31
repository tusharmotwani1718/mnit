// npm run rag:eval: retrieval quality on data/corpus/eval.json (does the expected scheme come back in the top 4?).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_DATA_DIR } from "../engine/loader.js";
import { likelyState } from "../agent/retriever.js";
import { Embedder, PgVectorRetriever, SupabaseRest } from "../rag/store.js";

type Case = { q: string; lang: "hi" | "mr" | "en"; expect: string; heldOut?: boolean; set?: string };
const { cases } = JSON.parse(readFileSync(join(DEFAULT_DATA_DIR, "corpus", "eval.json"), "utf8")) as { cases: Case[] };

const retriever = new PgVectorRetriever(new SupabaseRest(), new Embedder(), 4);
let hits = 0;
let reciprocal = 0;
const byLang: Record<string, { n: number; hits: number }> = {};
const heldOut = { n: 0, hits: 0 };
const rajasthan = { n: 0, hits: 0 };
for (const c of cases) {
  // Like a caller who hasn't said their state yet: Marathi speakers are assumed to be in Maharashtra.
  const chunks = await retriever.retrieve(c.q, { schemeIds: [], lang: c.lang, state: likelyState(undefined, c.lang) });
  const rank = chunks.findIndex((ch) => ch.schemeId === c.expect) + 1;
  if (rank) {
    hits++;
    reciprocal += 1 / rank;
  }
  const l = (byLang[c.lang] ??= { n: 0, hits: 0 });
  l.n++;
  if (rank) l.hits++;
  if (c.set === "rajasthan") {
    rajasthan.n++;
    if (rank) rajasthan.hits++;
  }
  if (c.heldOut) {
    heldOut.n++;
    if (rank) heldOut.hits++;
  }
  console.log(`${rank ? `✓ #${rank}` : "✗   "}  [${c.lang}]${c.heldOut ? " (held out)" : ""} ${c.q}  →  ${chunks.map((ch) => ch.schemeId).join(", ")}`);
}
const pct = (a: number, b: number) => `${Math.round((a / b) * 100)}%`;
console.log(`\nHit@4: ${hits}/${cases.length} (${pct(hits, cases.length)})   MRR: ${(reciprocal / cases.length).toFixed(2)}`);
for (const [lang, l] of Object.entries(byLang)) console.log(`  ${lang}: ${l.hits}/${l.n} (${pct(l.hits, l.n)})`);
if (heldOut.n) console.log(`  held out (not used for tuning): ${heldOut.hits}/${heldOut.n} (${pct(heldOut.hits, heldOut.n)})`);
if (rajasthan.n) console.log(`  rajasthan: ${rajasthan.hits}/${rajasthan.n} (${pct(rajasthan.hits, rajasthan.n)})`);
