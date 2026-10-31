// npm run rag:eval: retrieval quality on data/corpus/eval.json (does the expected scheme come back in the top 4?).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_DATA_DIR } from "../engine/loader.js";
import { createPool, Embedder, PgVectorRetriever } from "../rag/store.js";

type Case = { q: string; lang: "hi" | "mr" | "en"; expect: string };
const { cases } = JSON.parse(readFileSync(join(DEFAULT_DATA_DIR, "corpus", "eval.json"), "utf8")) as { cases: Case[] };

const pool = createPool();
const retriever = new PgVectorRetriever(pool, new Embedder(), 4);
let hits = 0;
let reciprocal = 0;
const byLang: Record<string, { n: number; hits: number }> = {};
try {
  for (const c of cases) {
    const chunks = await retriever.retrieve(c.q, { schemeIds: [], lang: c.lang });
    const rank = chunks.findIndex((ch) => ch.schemeId === c.expect) + 1;
    if (rank) {
      hits++;
      reciprocal += 1 / rank;
    }
    const l = (byLang[c.lang] ??= { n: 0, hits: 0 });
    l.n++;
    if (rank) l.hits++;
    console.log(`${rank ? `✓ #${rank}` : "✗   "}  [${c.lang}] ${c.q}  →  ${chunks.map((ch) => ch.schemeId).join(", ")}`);
  }
} finally {
  await pool.end();
}
const pct = (a: number, b: number) => `${Math.round((a / b) * 100)}%`;
console.log(`\nHit@4: ${hits}/${cases.length} (${pct(hits, cases.length)})   MRR: ${(reciprocal / cases.length).toFixed(2)}`);
for (const [lang, l] of Object.entries(byLang)) console.log(`  ${lang}: ${l.hits}/${l.n} (${pct(l.hits, l.n)})`);
