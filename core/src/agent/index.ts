import { loadEngine } from "../engine/index.js";
import { OpenAiTurnLlm } from "./openaiLlm.js";
import { Embedder, PgVectorRetriever, SupabaseRest } from "../rag/store.js";
import { FallbackRetriever, LocalSchemeRetriever, type Retriever } from "./retriever.js";
import { createAgent, type Agent } from "./turn.js";

export * from "./types.js";
export { createAgent, MAX_QUESTIONS, BATCH, type Agent } from "./turn.js";
export type { TurnLlm, LlmTurnInput, LlmTurnOutput } from "./llm.js";
export type { Retriever, Chunk } from "./retriever.js";
export { shouldRetrieve } from "./turn.js";
export { SessionStore } from "./session.js";

/** Production wiring: approved schemes from data/, gpt-4.1-mini, pgvector RAG over Supabase HTTPS (local scheme text if unset or Supabase fails). */
export function createDefaultAgent(): Agent {
  const engine = loadEngine();
  const local = new LocalSchemeRetriever(engine.schemes);
  let retriever: Retriever = local;
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY) {
    const pgvector = new PgVectorRetriever(new SupabaseRest(), new Embedder());
    pgvector
      .checkModel()
      .then(() => pgvector.warmUp())
      .catch((err) => console.warn("RAG store check failed:", err instanceof Error ? err.message : err));
    retriever = new FallbackRetriever(pgvector, local);
  } else console.warn("SUPABASE_URL / SUPABASE_SECRET_KEY not set: RAG uses the local scheme text only.");
  return createAgent({
    engine,
    llm: new OpenAiTurnLlm(engine.facts, engine.schemes.map((s) => s.id)),
    retriever,
  });
}
