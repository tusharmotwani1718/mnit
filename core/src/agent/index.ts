import { loadEngine } from "../engine/index.js";
import { OpenAiTurnLlm } from "./openaiLlm.js";
import { Embedder, PgVectorRetriever, createPool } from "../rag/store.js";
import { FallbackRetriever, LocalSchemeRetriever, type Retriever } from "./retriever.js";
import { createAgent, type Agent } from "./turn.js";

export * from "./types.js";
export { createAgent, MAX_QUESTIONS, BATCH, type Agent } from "./turn.js";
export type { TurnLlm, LlmTurnInput, LlmTurnOutput } from "./llm.js";
export type { Retriever, Chunk } from "./retriever.js";
export { shouldRetrieve } from "./turn.js";
export { SessionStore } from "./session.js";

/** Production wiring: approved schemes from data/, gpt-4.1-mini, pgvector RAG (local scheme text if DATABASE_URL is unset or Supabase fails). */
export function createDefaultAgent(): Agent {
  const engine = loadEngine();
  const local = new LocalSchemeRetriever(engine.schemes);
  let retriever: Retriever = local;
  if (process.env.DATABASE_URL) retriever = new FallbackRetriever(new PgVectorRetriever(createPool(), new Embedder()), local);
  else console.warn("DATABASE_URL not set: RAG uses the local scheme text only (run npm run rag:ingest after setting it).");
  return createAgent({
    engine,
    llm: new OpenAiTurnLlm(engine.facts, engine.schemes.map((s) => s.id)),
    retriever,
  });
}
