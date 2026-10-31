import type { Engine, Lang, Localized } from "../engine/index.js";
import type { Session } from "../agent/types.js";

// Hindi/Marathi SMS are UCS-2: 70 characters per part, so the checklist stays short.
// Schemes, documents and where-to-apply all come from verified scheme data.

/** Most schemes put in one SMS; the rest are mentioned as a count. */
export const MAX_SMS_SCHEMES = 3;
const MAX_DOCS = 3;

const L = {
  title: { hi: "योजना दर्शक: आपकी योजनाएँ", mr: "योजना दर्शक: तुमच्या योजना", en: "Yojana Darshak: your schemes" },
  eligible: { hi: "पात्र", mr: "पात्र", en: "eligible" },
  likely: { hi: "शायद पात्र, सीएससी पर पक्का करें", mr: "कदाचित पात्र, सीएससीवर खात्री करा", en: "likely eligible, confirm at CSC" },
  docs: { hi: "कागज़", mr: "कागदपत्रे", en: "Documents" },
  where: { hi: "कहाँ", mr: "कुठे", en: "Go" },
  helpline: { hi: "हेल्पलाइन", mr: "हेल्पलाइन", en: "Helpline" },
  more: (n: number): Localized => ({
    hi: `${n} और योजनाओं के लिए दोबारा कॉल करें।`,
    mr: `आणखी ${n} योजनांसाठी पुन्हा कॉल करा.`,
    en: `Call again to hear ${n} more scheme${n === 1 ? "" : "s"}.`,
  }),
  free: {
    hi: "आवेदन मुफ़्त है। कोई पैसे, ओटीपी या आधार नंबर माँगे तो न दें।",
    mr: "अर्ज मोफत आहे. कोणी पैसे, ओटीपी किंवा आधार नंबर मागितल्यास देऊ नका.",
    en: "Applying is free. Never pay anyone or share an OTP or Aadhaar number.",
  },
};

/** "1912 / 19120; MSEDCL toll free ..." → "1912 / 19120" */
const shortHelpline = (h: string) => h.split(/[;(]/)[0]!.trim();

/** The checklist SMS for the schemes the caller agreed to receive, re-checked against their final facts. */
export function composeChecklistSms(engine: Engine, schemeIds: string[], facts: Session["stated"], lang: Lang): string | null {
  const results = new Map(engine.evaluate(facts).results.map((r) => [r.schemeId, r]));
  const ids = schemeIds.filter((id) => results.has(id) && results.get(id)!.status !== "not_eligible");
  if (!ids.length) return null;

  const lines = [L.title[lang]];
  ids.slice(0, MAX_SMS_SCHEMES).forEach((id, i) => {
    const scheme = engine.schemes.find((s) => s.id === id)!;
    const status = results.get(id)!.status === "eligible" ? L.eligible : L.likely;
    lines.push("", `${i + 1}) ${scheme.name[lang]} (${status[lang]})`);
    lines.push(`${L.docs[lang]}: ${scheme.documents.slice(0, MAX_DOCS).map((d) => d[lang]).join(", ")}`);
    lines.push(`${L.where[lang]}: ${scheme.applyAtSpoken[lang]}`);
    if (scheme.helpline) lines.push(`${L.helpline[lang]}: ${shortHelpline(scheme.helpline)}`);
  });
  if (ids.length > MAX_SMS_SCHEMES) lines.push("", L.more(ids.length - MAX_SMS_SCHEMES)[lang]);
  lines.push("", L.free[lang]);
  return lines.join("\n");
}
