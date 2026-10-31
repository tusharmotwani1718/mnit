// Mirrors core/src/live.ts and core/src/agent/types.ts (what core streams on /live/events).

export type Lang = "hi" | "mr" | "en";
export type Tri = true | false | "unknown";
export type SchemeStatus = "eligible" | "likely_eligible" | "not_eligible" | "need_more_info";
export type Localized = { hi: string; mr: string; en: string };

export type LeafTrace =
  | { fact: string; op: "eq" | "lte" | "gte" | "in"; expected: unknown; actual?: unknown; result: Tri; assumed: boolean }
  | { manualCheck: string; result: "unknown" };

export type SchemeResult = {
  schemeId: string;
  status: SchemeStatus;
  missingFacts: string[];
  caveats: Localized[];
  manualChecks: string[];
  trace: LeafTrace[];
};

export type Action =
  | { type: "SEND_CHECKLIST"; to: string; schemeIds: string[]; lang: Lang }
  | { type: "LOG_SCAM_REPORT"; pattern: string }
  | { type: "SET_LANGUAGE"; lang: Lang }
  | { type: "HANDOFF" };

export type Trace = {
  state: "collecting" | "results" | "details" | "consent" | "closed";
  lang: Lang;
  facts: Record<string, string | number | boolean>;
  results: SchemeResult[];
  next: { fact: string; ask: Localized; resolves: number } | null;
  questionsAsked: number;
  topics: string[];
  rag: RagTrace | null;
};

export type RagTrace = {
  retrieved: { id: string; schemeId: string; tier: "tier1" | "extra"; title: string; section: string; sourceUrl: string; score: number | null; preview: string }[];
  used: number[];
};

export type LiveTurn = { at: number; userText: string; replyText: string; actions: Action[]; done: boolean; trace: Trace };

export type LiveSession = {
  sessionId: string;
  channel: string;
  caller: string | null;
  startedAt: number;
  lastAt: number;
  ended: boolean;
  turns: LiveTurn[];
};

export type LiveEvent =
  | { type: "snapshot"; sessions: LiveSession[] }
  | { type: "turn"; session: Omit<LiveSession, "turns">; turn: LiveTurn }
  | { type: "ended"; sessionId: string; at: number };

export type Meta = {
  schemes: {
    id: string;
    name: Localized;
    level: "central" | "state";
    state: string | null;
    topics: string[];
    source: string;
    lastVerified: string | null;
  }[];
  facts: Record<string, { label: string; askable: boolean; type: string }>;
};

export type TurnResult = { replyText: string; actions: Action[]; done: boolean; trace: Trace };

export type CatalogScheme = {
  id: string;
  name: Localized;
  level: "central" | "state";
  state: string | null;
  topics: string[];
  benefitSummary: Localized;
  documents: Localized[];
  applyAt: string[];
  applyAtSpoken: Localized;
  helpline: string | null;
  source: string;
  lastVerified: string | null;
};

export type CatalogFact = {
  type: "enum" | "boolean" | "number" | "string";
  values: string[] | null;
  askable: boolean;
  ask: Localized | null;
  description: string | null;
  topics: string[] | null;
};

export type Catalog = { schemes: CatalogScheme[]; facts: Record<string, CatalogFact> };

export type Profile = { phone: string; name: string | null; lang: Lang; facts: Record<string, string | number | boolean>; consent: boolean };
