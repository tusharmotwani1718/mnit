// npm run rag:ingest: builds the corpus from data/ and syncs it into Supabase pgvector (only new or changed chunks are embedded).
// One-time setup: run core/db/rag.sql in Supabase → SQL Editor.
import { loadEngine } from "../engine/index.js";
import { buildCorpus } from "../rag/corpus.js";
import { EMBED_MODEL, Embedder, SupabaseRest, syncCorpus } from "../rag/store.js";

const engine = loadEngine();
const chunks = buildCorpus(engine.schemes);
const bySchemes = new Set(chunks.map((c) => c.schemeId)).size;
const chars = chunks.reduce((n, c) => n + c.text.length, 0);
console.log(`Corpus: ${chunks.length} chunks from ${bySchemes} schemes (~${Math.round(chars / 4 / 1000)}k tokens), model ${EMBED_MODEL}`);

const result = await syncCorpus(new SupabaseRest(), new Embedder(), chunks);
console.log(`Done: ${result.embedded} embedded, ${result.deleted} removed, ${result.total} total.`);
