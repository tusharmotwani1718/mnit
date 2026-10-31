import type { Lang, Scheme } from "../engine/index.js";

export type Chunk = {
  id: string;
  schemeId: string;
  /** tier1 = scheme has verified rules; extra = RAG-only, never confirmed as eligible. */
  tier: "tier1" | "extra";
  title: string;
  section: string;
  text: string;
  sourceUrl: string;
  /** Cosine similarity, when retrieved by vector search. */
  score?: number;
};

export type RetrieveOptions = {
  schemeIds: string[];
  lang: Lang;
  /** The caller's state ("MH", "RJ"), if known: other states' schemes are left out. */
  state?: string;
};

export interface Retriever {
  retrieve(query: string, opts: RetrieveOptions): Promise<Chunk[]>;
}

/** State the caller most likely lives in: what they said, else Maharashtra for Marathi speakers. */
export function likelyState(stated: string | undefined, lang: Lang): string | undefined {
  if (stated === "MH" || stated === "RJ") return stated;
  if (stated === "OTHER") return "OTHER";
  return lang === "mr" ? "MH" : undefined;
}

/**
 * Offline stand-in for the pgvector retriever (tests, and fallback when Supabase is down):
 * returns the scheme files' own text for the schemes in focus.
 */
export class LocalSchemeRetriever implements Retriever {
  private byId: Map<string, Scheme>;

  constructor(schemes: Scheme[]) {
    this.byId = new Map(schemes.map((s) => [s.id, s]));
  }

  async retrieve(_query: string, { schemeIds, lang }: RetrieveOptions): Promise<Chunk[]> {
    return schemeIds.flatMap((id) => {
      const s = this.byId.get(id);
      if (!s) return [];
      const notes = Array.isArray(s.notes) ? (s.notes as string[]) : [];
      const text = [
        `${s.name[lang]} (${s.name.en})`,
        s.benefitSummary[lang],
        s.benefitSummary.en,
        `Documents: ${s.documents.map((d) => d[lang]).join(", ")}`,
        `Apply: ${s.applyAtSpoken[lang]}`,
        s.helpline ? `Helpline: ${s.helpline}` : "",
        ...notes,
      ]
        .filter(Boolean)
        .join("\n");
      return [{ id: `${id}:local`, schemeId: id, tier: "tier1" as const, title: s.name.en, section: "summary", text, sourceUrl: s.source }];
    });
  }
}

/** Uses `primary` (pgvector), and `fallback` if it fails or is slower than `timeoutMs`, so a call never stalls on RAG. */
export class FallbackRetriever implements Retriever {
  constructor(
    private primary: Retriever,
    private fallback: Retriever,
    private timeoutMs = 2500,
  ) {}

  async retrieve(query: string, opts: RetrieveOptions): Promise<Chunk[]> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`retrieval timed out after ${this.timeoutMs} ms`)), this.timeoutMs);
    });
    try {
      return await Promise.race([this.primary.retrieve(query, opts), timeout]);
    } catch (err) {
      console.error("RAG retrieval failed, using local fallback:", err instanceof Error ? err.message : err);
      return this.fallback.retrieve(query, opts);
    } finally {
      clearTimeout(timer);
    }
  }
}
