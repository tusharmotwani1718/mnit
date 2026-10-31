/** Callers hear hi or mr; en exists for testing the flow in text chat. */
export type Lang = "hi" | "mr" | "en";
export type Localized = { hi: string; mr: string; en: string };

export type FactValue = string | number | boolean;
export type Facts = Record<string, FactValue>;

export type Op = "eq" | "lte" | "gte" | "in";
export type Tri = true | false | "unknown";

export type FactCond = {
  fact: string;
  op: Op;
  value: unknown;
  assumeIfUnknown?: boolean;
  caveat?: Localized;
};

export type Cond =
  | { all: Cond[] }
  | { any: Cond[] }
  | { not: Cond }
  | { manualCheck: string }
  | FactCond;

export type FactDef = {
  type: "enum" | "boolean" | "number" | "string";
  values?: string[];
  askable: boolean;
  priority?: number;
  description?: string;
  ask?: Localized;
  derives?: { when: FactValue; set: Facts }[];
  /** Only asked when the caller's topics include one of these (e.g. caste only for scholarships). */
  topics?: string[];
  unitNormalisation?: unknown;
};

export type Scheme = {
  id: string;
  name: Localized;
  level: "central" | "state";
  state?: string;
  tier: 1 | 2;
  topics: string[];
  rules: Cond;
  benefitSummary: Localized;
  documents: Localized[];
  applyAt: string[];
  /** Where to go, as it should be spoken ("अपनी बैंक शाखा में"). */
  applyAtSpoken: Localized;
  helpline: string | null;
  source: string;
  status: "draft" | "approved" | "needs_review";
  [extra: string]: unknown;
};

export type SchemeStatus = "eligible" | "likely_eligible" | "not_eligible" | "need_more_info";

/** One evaluated leaf condition, for the live engine panel. */
export type LeafTrace =
  | { fact: string; op: Op; expected: unknown; actual: FactValue | undefined; result: Tri; assumed: boolean }
  | { manualCheck: string; result: "unknown" };

export type SchemeResult = {
  schemeId: string;
  status: SchemeStatus;
  /** Askable facts that would move this scheme forward (only for need_more_info). */
  missingFacts: string[];
  /** Caveats from rare exclusions that were assumed (assumeIfUnknown). */
  caveats: Localized[];
  /** Conditions only a CSC / office can confirm (why a result is likely_eligible). */
  manualChecks: string[];
  trace: LeafTrace[];
};

export type NextQuestion = {
  fact: string;
  ask: Localized;
  /** How many still-open schemes ask for this fact. */
  resolves: number;
};
