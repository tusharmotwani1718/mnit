import OpenAI from "openai";
import type { Lang } from "../engine/index.js";
import type { Chunk, Retriever } from "../agent/retriever.js";
import type { CorpusChunk } from "./corpus.js";

export const EMBED_MODEL = process.env.RAG_EMBED_MODEL ?? "text-embedding-3-small";

const TIMEOUT_MS = 15_000;
const SETUP_HINT = "Run core/db/rag.sql once in Supabase → SQL Editor.";

/**
 * Supabase pgvector over HTTPS (REST API on port 443), so it works on networks that block Postgres ports.
 * Uses the secret (service_role) key: server-side only, never sent to a browser.
 */
export class SupabaseRest {
  private base: string;
  private headers: Record<string, string>;

  constructor(url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY) {
    if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY must be set");
    this.base = `${url.replace(/\/$/, "")}/rest/v1`;
    this.headers = { apikey: key, "Content-Type": "application/json" };
    // Legacy service_role keys are JWTs and also go in Authorization; new sb_secret_ keys only in apikey.
    if (key.startsWith("eyJ")) this.headers.Authorization = `Bearer ${key}`;
  }

  async request<T>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method: init.method ?? "GET",
      headers: { ...this.headers, ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = (await res.text().catch(() => "")).slice(0, 300);
      const missing = res.status === 404 || /PGRST20[25]|does not exist|Could not find/.test(text);
      throw new Error(`Supabase ${init.method ?? "GET"} ${path.split("?")[0]} → HTTP ${res.status}: ${text}${missing ? ` (${SETUP_HINT})` : ""}`);
    }
    return (res.status === 204 ? undefined : await res.json().catch(() => undefined)) as T;
  }
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

async function existingHashes(db: SupabaseRest): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const rows = await db.request<{ id: string; content_hash: string }[]>(
      `/rag_chunks?select=id,content_hash&order=id&limit=${PAGE}&offset=${offset}`,
    );
    for (const r of rows) out.set(r.id, r.content_hash);
    if (rows.length < PAGE) return out;
  }
}

/** Embeds new or changed chunks and deletes ones no longer in the corpus. Returns counts. */
export async function syncCorpus(db: SupabaseRest, embedder: Embedder, chunks: CorpusChunk[], log = console.log) {
  const existing = await existingHashes(db);
  const todo = chunks.filter((c) => existing.get(c.id) !== c.hash);
  const keep = new Set(chunks.map((c) => c.id));
  const stale = [...existing.keys()].filter((id) => !keep.has(id));

  const BATCH = 32;
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const vectors = await embedder.embed(batch.map((c) => `${c.title}\n${c.text}`));
    await db.request("/rag_chunks?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: batch.map((c, j) => ({
        id: c.id,
        scheme_id: c.schemeId,
        tier: c.tier,
        title: c.title,
        section: c.section,
        lang: c.lang,
        source_url: c.sourceUrl,
        content: c.text,
        content_hash: c.hash,
        embedding: toVector(vectors[j]!),
        updated_at: new Date().toISOString(),
      })),
    });
    log(`  embedded ${Math.min(i + BATCH, todo.length)}/${todo.length}`);
  }
  for (let i = 0; i < stale.length; i += 100) {
    const ids = stale.slice(i, i + 100).map((id) => `"${id.replace(/"/g, '\\"')}"`).join(",");
    await db.request(`/rag_chunks?id=in.(${encodeURIComponent(ids)})`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  }
  return { total: chunks.length, embedded: todo.length, deleted: stale.length };
}

type Row = { id: string; scheme_id: string; tier: "tier1" | "extra"; title: string; section: string; source_url: string; content: string; score: number };

/** Vector search via the match_rag_chunks function. With schemes in focus, the best of those come first, then the best overall. */
export class PgVectorRetriever implements Retriever {
  constructor(
    private db: SupabaseRest,
    private embedder: Embedder,
    private k = 4,
  ) {}

  async search(vector: number[], schemeIds: string[] | null, k: number): Promise<Chunk[]> {
    const rows = await this.db.request<Row[]>("/rpc/match_rag_chunks", {
      method: "POST",
      body: { query_embedding: toVector(vector), scheme_filter: schemeIds, match_count: k },
    });
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
