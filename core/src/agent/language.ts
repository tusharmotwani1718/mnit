import type { Lang } from "../engine/index.js";

// Words that are distinctly Marathi or distinctly Hindi. Hindi STT on Marathi speech still yields these (shared script).
const MARATHI = [
  "आहे", "आहेत", "माझ्या", "माझ्याकडे", "माझी", "माझा", "माझे", "मला", "आम्ही", "आमच्या", "तुम्ही", "तुमच्या",
  "काय", "नाही", "पाहिजे", "करतो", "आणि", "किती", "मिळेल", "मिळते", "सांगा", "बोला", "शेती", "घेतो", "होय",
  "aahe", "ahe", "mala", "majhya", "mazya", "pahije", "sanga", "milel", "aani",
];
const HINDI = [
  "है", "हैं", "मेरे", "मेरा", "मेरी", "मुझे", "हम", "हमारे", "आप", "आपके", "क्या", "नहीं", "चाहिए", "करता",
  "करती", "और", "कितनी", "कितने", "मिलेगा", "मिलेगी", "बताइए", "बताओ", "खेती", "हाँ",
  "hai", "mera", "mere", "mujhe", "kya", "nahin", "chahiye", "milega", "bataiye",
];

const tokens = (text: string) => text.toLowerCase().split(/[\s,.!?।]+/).filter(Boolean);

export function markerLanguage(text: string): Lang | null {
  const t = new Set(tokens(text));
  const mr = MARATHI.filter((w) => t.has(w)).length;
  const hi = HINDI.filter((w) => t.has(w)).length;
  if (mr >= 2 && mr > hi) return "mr";
  if (hi >= 2 && hi > mr) return "hi";
  return null;
}

/**
 * Switch only when the marker words and the LLM agree, or when the caller asks explicitly.
 * Keeps code-mixed speech from flip-flopping the language.
 */
export function decideLanguage(current: Lang, text: string, llmLang: string, explicit: Lang | null): Lang {
  if (explicit) return explicit;
  if (current === "en") return current; // test mode: stay in English unless asked

  const markers = markerLanguage(text);
  if (markers && markers === llmLang && markers !== current) return markers;
  return current;
}
