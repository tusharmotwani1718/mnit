import OpenAI from "openai";
import pg from "pg";
import type { Lang } from "../engine/index.js";
import type { Chunk, Retriever } from "../agent/retriever.js";
import type { CorpusChunk } from "./corpus.js";

export const EMBED_MODEL = process.env.RAG_EMBED_MODEL ?? "text-embedding-3-small";
export const EMBED_DIMS = 1536;

/** Schema for Supabase Postgres. RLS is on with no policies, so the public REST API can't read it; core connects directly. */
export const SCHEMA_SQL = `
create extension if not exists vector;
create table if not exists rag_chunks (
  id text primary key,
  scheme_id text not null,
  tier text not null check (tier in ('tier1', 'extra')),
  title text not null,
  section text not null,
  lang text not null,
  source_url text not null,
  content text not null,
  content_hash text not null,
  embedding vector(${EMBED_DIMS}) not null,
  updated_at timestamptz not null default now()
);
create index if not exists rag_chunks_embedding_idx on rag_chunks using hnsw (embedding vector_cosine_ops);
create index if not exists rag_chunks_scheme_idx on rag_chunks (scheme_id);
alter table rag_chunks enable row level security;
`;

export function createPool(connectionString = process.env.DATABASE_URL): pg.Pool {
  if (!connectionString) throw new Error("DATABASE_URL is not set (Supabase → Connect → Session pooler connection string)");
  return new pg.Pool({
    connectionString,
    max: 4,
    connectionTimeoutMillis: 5000,
    // Supabase requires TLS. Its certificate chain isn't in Node's default store, so verification is
    // relaxed unless the CA is provided (Supabase → Database settings → SSL certificate).
    ssl: process.env.DATABASE_CA_CERT ? { ca: process.env.DATABASE_CA_CERT } : { rejectUnauthorized: false },
  });
}

export class Embedder {
  private client: OpenAI;
  constructor(apiKey = process.env.OPENAI_API_KEY) {
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
    this.client = new OpenAI({ apiKey });
  }

  async embed(texts: string[]): Promise<number[][]> {
    const res = await this.client.embeddings.create({ model: EMBED_MODEL, input: texts });
    return res.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}

const toVector = (v: number[]) => `[${v.join(",")}]`;

/** Embeds new or changed chunks and deletes ones no longer in the corpus. Returns counts. */
export async function syncCorpus(pool: pg.Pool, embedder: Embedder, chunks: CorpusChunk[], log = console.log) {
  await pool.query(SCHEMA_SQL);
  const existing = new Map(
    (await pool.query<{ id: string; content_hash: string }>("select id, content_hash from rag_chunks")).rows.map((r) => [r.id, r.content_hash]),
  );
  const todo = chunks.filter((c) => existing.get(c.id) !== c.hash);
  const keep = new Set(chunks.map((c) => c.id));
  const stale = [...existing.keys()].filter((id) => !keep.has(id));

  const BATCH = 64;
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const vectors = await embedder.embed(batch.map((c) => `${c.title}\n${c.text}`));
    for (const [j, c] of batch.entries()) {
      await pool.query(
        `insert into rag_chunks (id, scheme_id, tier, title, section, lang, source_url, content, content_hash, embedding)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::vector)
         on conflict (id) do update set scheme_id = excluded.scheme_id, tier = excluded.tier, title = excluded.title,
           section = excluded.section, lang = excluded.lang, source_url = excluded.source_url, content = excluded.content,
           content_hash = excluded.content_hash, embedding = excluded.embedding, updated_at = now()`,
        [c.id, c.schemeId, c.tier, c.title, c.section, c.lang, c.sourceUrl, c.text, c.hash, toVector(vectors[j]!)],
      );
    }
    log(`  embedded ${Math.min(i + BATCH, todo.length)}/${todo.length}`);
  }
  if (stale.length) await pool.query("delete from rag_chunks where id = any($1)", [stale]);
  return { total: chunks.length, embedded: todo.length, deleted: stale.length };
}

type Row = { id: string; scheme_id: string; tier: "tier1" | "extra"; title: string; section: string; source_url: string; content: string; score: number };

/** Vector search over Supabase pgvector. With schemes in focus, the best of those come first, then the best overall. */
export class PgVectorRetriever implements Retriever {
  constructor(
    private pool: pg.Pool,
    private embedder: Embedder,
    private k = 4,
  ) {}

  async search(vector: number[], schemeIds: string[] | null, k: number): Promise<Chunk[]> {
    const { rows } = await this.pool.query<Row>(
      `select id, scheme_id, tier, title, section, source_url, content, 1 - (embedding <=> $1::vector) as score
       from rag_chunks where ($2::text[] is null or scheme_id = any($2))
       order by embedding <=> $1::vector limit $3`,
      [toVector(vector), schemeIds, k],
    );
    return rows.map((r) => ({
      id: r.id,
      schemeId: r.scheme_id,
      tier: r.tier,
      title: r.title,
      section: r.section,
      text: r.content,
      sourceUrl: r.source_url,
      score: Number(r.score),
    }));
  }

  async retrieve(query: string, { schemeIds }: { schemeIds: string[]; lang: Lang }): Promise<Chunk[]> {
    const [vector] = await this.embedder.embed([query]);
    const [focused, overall] = await Promise.all([
      schemeIds.length ? this.search(vector!, schemeIds, this.k - 1) : Promise.resolve([]),
      this.search(vector!, null, this.k),
    ]);
    const seen = new Set<string>();
    return [...focused, ...overall].filter((c) => !seen.has(c.id) && seen.add(c.id)).slice(0, this.k);
  }
}
