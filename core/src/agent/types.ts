import type { Facts, Lang, NextQuestion, SchemeResult } from "../engine/index.js";

export const TOPICS = [
  "farming", "health", "housing", "women", "insurance", "pension", "household", "work", "education", "welfare",
] as const;
export type Topic = (typeof TOPICS)[number];

export const SCAM_PATTERNS = ["fee_request", "otp_request", "aadhaar_or_bank_request", "agent_registration", "other"] as const;
export type ScamPattern = (typeof SCAM_PATTERNS)[number];

export type ConversationState = "collecting" | "results" | "details" | "consent" | "closed";

/** What the assistant last asked, so a bare "haan"/"nahi" can be interpreted. */
export type PromptKind = "fact" | "more" | "pick" | "check_others" | "anything_else" | "consent" | null;

export type Action =
  | { type: "SEND_CHECKLIST"; to: string; schemeIds: string[]; lang: Lang }
  | { type: "LOG_SCAM_REPORT"; pattern: ScamPattern }
  | { type: "SET_LANGUAGE"; lang: Lang }
  | { type: "HANDOFF" };

export type Turn = { role: "user" | "assistant"; text: string };

export type Session = {
  id: string;
  lang: Lang;
  state: ConversationState;
  stated: Facts;
  topics: Topic[];
  /** Questions asked in the current topic round (stopping rule). */
  questionsAsked: number;
  pendingFact: string | null;
  lastPrompt: PromptKind;
  /** Ranked eligible / likely-eligible scheme ids presented in this round. */
  offered: string[];
  offeredUpTo: number;
  selectedScheme: string | null;
  discussed: string[];
  scamPatternsLogged: ScamPattern[];
  history: Turn[];
  callerNumber: string | null;
  /** Checklist the caller agreed to receive; sent by SMS when the call ends. */
  checklist: { to: string; schemeIds: string[]; lang: Lang } | null;
  channel: string;
  startedAt: number;
};

export type Trace = {
  state: ConversationState;
  lang: Lang;
  facts: Facts;
  results: SchemeResult[];
  next: NextQuestion | null;
  questionsAsked: number;
  topics: Topic[];
  /** Passages retrieved this turn (null when retrieval was skipped), and which ones the answer cited. */
  rag: RagTrace | null;
};

export type RagTrace = {
  retrieved: { id: string; schemeId: string; tier: "tier1" | "extra"; title: string; section: string; sourceUrl: string; score: number | null; preview: string }[];
  /** 0-based indexes into `retrieved` that the spoken answer used. */
  used: number[];
};

export type TurnResult = {
  replyText: string;
  actions: Action[];
  done: boolean;
  trace: Trace;
};

export type TurnMeta = { callerNumber?: string; channel?: string };
