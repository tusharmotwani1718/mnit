import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Lang, Localized, Scheme } from "../engine/index.js";
import { DEFAULT_DATA_DIR } from "../engine/loader.js";
import type { Chunk } from "../agent/retriever.js";

/** A chunk ready to embed. */
export type CorpusChunk = Omit<Chunk, "score"> & { lang: Lang; hash: string };

const CHUNK_CHARS = 1200;
const OVERLAP_CHARS = 200;
const LANGS: Lang[] = ["hi", "mr", "en"];

type DocumentEntry = { file: string; schemeId: string; title: string; url: string };
type ExtraScheme = {
  id: string;
  name: Localized;
  source: string;
  text: string[];
  summary: { hi: string; mr: string };
};

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

/** PDF text comes with hard line breaks mid-sentence; collapse whitespace into single spaces. */
export function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Splits text into ~CHUNK_CHARS windows on sentence boundaries, overlapping by ~OVERLAP_CHARS. */
export function chunkText(text: string, size = CHUNK_CHARS, overlap = OVERLAP_CHARS): string[] {
  // A single very long "sentence" (tables, lists in PDFs) is cut into size-long pieces first.
  const sentences = normalise(text)
    .split(/(?<=[.।?!])\s+/)
    .filter(Boolean)
    .flatMap((s) => (s.length <= size ? [s] : Array.from({ length: Math.ceil(s.length / size) }, (_, i) => s.slice(i * size, (i + 1) * size))));
  const chunks: string[] = [];
  let current: string[] = [];
  let length = 0;
  for (const sentence of sentences) {
    if (length + sentence.length > size && current.length) {
      chunks.push(current.join(" "));
      // Carry the tail sentences into the next chunk so an answer split across a boundary is still found.
      const carry: string[] = [];
      let carried = 0;
      for (let i = current.length - 1; i >= 0 && carried < overlap; i--) {
        carry.unshift(current[i]!);
        carried += current[i]!.length;
      }
      current = carry;
      length = carried;
    }
    current.push(sentence);
    length += sentence.length + 1;
  }
  if (current.length) chunks.push(current.join(" "));
  return chunks;
}

function make(c: Omit<CorpusChunk, "hash">): CorpusChunk {
  return { ...c, hash: hash(`${c.title}\n${c.sourceUrl}\n${c.text}`) };
}

/** One summary chunk per language per rule scheme, from the verified scheme file (matches hi/mr questions well). */
function schemeSummaries(scheme: Scheme): CorpusChunk[] {
  const notes = Array.isArray(scheme.notes) ? (scheme.notes as string[]) : [];
  return LANGS.map((lang) =>
    make({
      id: `${scheme.id}:summary:${lang}`,
      schemeId: scheme.id,
      tier: "tier1",
      title: `${scheme.name.en}: summary`,
      section: "summary",
      lang,
      sourceUrl: scheme.source,
      text: [
        `${scheme.name[lang]} (${scheme.name.en}).`,
        scheme.benefitSummary[lang],
        `${{ hi: "ज़रूरी कागज़", mr: "आवश्यक कागदपत्रे", en: "Documents" }[lang]}: ${scheme.documents.map((d) => d[lang]).join(", ")}.`,
        `${{ hi: "आवेदन", mr: "अर्ज", en: "Apply" }[lang]}: ${scheme.applyAtSpoken[lang]}.`,
        scheme.helpline ? `Helpline: ${scheme.helpline}.` : "",
        lang === "en" ? notes.join(" ") : "",
      ]
        .filter(Boolean)
        .join(" "),
    }),
  );
}

export function buildCorpus(schemes: Scheme[], dataDir = DEFAULT_DATA_DIR): CorpusChunk[] {
  const dir = join(dataDir, "corpus");
  const chunks: CorpusChunk[] = schemes.flatMap(schemeSummaries);
  const known = new Set(schemes.map((s) => s.id));

  const { documents } = JSON.parse(readFileSync(join(dir, "documents.json"), "utf8")) as { documents: DocumentEntry[] };
  for (const doc of documents) {
    if (!known.has(doc.schemeId)) throw new Error(`documents.json: ${doc.file} refers to unknown scheme "${doc.schemeId}"`);
    const text = readFileSync(join(dir, "docs", doc.file), "utf8");
    chunkText(text).forEach((piece, i) =>
      chunks.push(
        make({ id: `${doc.file}#${i}`, schemeId: doc.schemeId, tier: "tier1", title: doc.title, section: "official", lang: "en", sourceUrl: doc.url, text: piece }),
      ),
    );
  }

  const { schemes: extras } = JSON.parse(readFileSync(join(dir, "extra-schemes.json"), "utf8")) as { schemes: ExtraScheme[] };
  for (const s of extras) {
    if (known.has(s.id)) throw new Error(`extra-schemes.json: "${s.id}" already has rules`);
    s.text.forEach((para, i) =>
      chunks.push(make({ id: `${s.id}:text:${i}`, schemeId: s.id, tier: "extra", title: s.name.en, section: "overview", lang: "en", sourceUrl: s.source, text: `${s.name.en}. ${para}` })),
    );
    for (const lang of ["hi", "mr"] as const) {
      chunks.push(
        make({ id: `${s.id}:summary:${lang}`, schemeId: s.id, tier: "extra", title: `${s.name.en}: summary`, section: "summary", lang, sourceUrl: s.source, text: `${s.name[lang]}. ${s.summary[lang]}` }),
      );
    }
  }
  return chunks;
}
