import type { LeafTrace, SchemeStatus } from "./types";

/** "familyPaysIncomeTax" → "Family pays income tax" */
export function humanize(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function formatValue(v: unknown): string {
  if (v === true) return "yes";
  if (v === false) return "no";
  if (v === undefined || v === null) return "?";
  if (Array.isArray(v)) return v.join(" / ");
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString("en-IN") : v.toFixed(2);
  return String(v);
}

const OPS = { eq: "=", lte: "≤", gte: "≥", in: "∈" } as const;

/** "Age ≥ 18" */
export function describeCondition(leaf: Extract<LeafTrace, { fact: string }>): string {
  if (leaf.op === "eq" && typeof leaf.expected === "boolean") {
    return leaf.expected ? humanize(leaf.fact) : `Not: ${humanize(leaf.fact).toLowerCase()}`;
  }
  return `${humanize(leaf.fact)} ${OPS[leaf.op]} ${formatValue(leaf.expected)}`;
}

export const STATUS: Record<SchemeStatus, { label: string; badge: string; card: string; order: number }> = {
  eligible: {
    label: "Eligible",
    badge: "bg-emerald-600 text-white",
    card: "border-emerald-300 bg-emerald-50",
    order: 0,
  },
  likely_eligible: {
    label: "Likely · confirm at CSC",
    badge: "bg-amber-500 text-white",
    card: "border-amber-300 bg-amber-50",
    order: 1,
  },
  need_more_info: {
    label: "Need more info",
    badge: "bg-sky-600 text-white",
    card: "border-sky-200 bg-white",
    order: 2,
  },
  not_eligible: {
    label: "Not eligible",
    badge: "bg-slate-400 text-white",
    card: "border-slate-200 bg-slate-50 opacity-70",
    order: 3,
  },
};

export const LANG_LABEL = { hi: "हिंदी", mr: "मराठी", en: "English" } as const;

export function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
