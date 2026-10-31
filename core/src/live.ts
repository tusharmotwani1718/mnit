import type { Action, Trace, TurnResult } from "./agent/index.js";

/** One turn as the live panel shows it. */
export type LiveTurn = {
  at: number;
  userText: string;
  replyText: string;
  actions: Action[];
  done: boolean;
  trace: Trace;
};

export type LiveSession = {
  sessionId: string;
  channel: string;
  caller: string | null; // masked
  startedAt: number;
  lastAt: number;
  ended: boolean;
  turns: LiveTurn[];
};

export type LiveEvent =
  | { type: "turn"; session: Omit<LiveSession, "turns">; turn: LiveTurn }
  | { type: "ended"; sessionId: string; at: number };

const MAX_SESSIONS = 50;
const MAX_TURNS = 60;

/** "+919876543210" → "+91•••••3210": enough to tell calls apart, not enough to identify a caller. */
export function maskNumber(n: string | null | undefined): string | null {
  if (!n) return null;
  const digits = n.replace(/\D/g, "");
  if (digits.length < 6) return "•••";
  return `${n.startsWith("+") ? "+" : ""}${digits.slice(0, 2)}${"•".repeat(Math.max(digits.length - 6, 3))}${digits.slice(-4)}`;
}

/** In-memory fan-out of call turns to live panel viewers (SSE). Keeps the last few sessions for page reloads. */
export class LiveBus {
  private sessions = new Map<string, LiveSession>();
  private listeners = new Set<(e: LiveEvent) => void>();

  recordTurn(sessionId: string, meta: { channel: string; callerNumber: string | null }, userText: string, result: TurnResult) {
    const now = Date.now();
    let s = this.sessions.get(sessionId);
    if (!s) {
      s = { sessionId, channel: meta.channel, caller: maskNumber(meta.callerNumber), startedAt: now, lastAt: now, ended: false, turns: [] };
      this.sessions.set(sessionId, s);
      this.evict();
    }
    // A number the caller spoke for the SMS is personal data: mask it like the caller number.
    const actions = result.actions.map((a) => (a.type === "SEND_CHECKLIST" ? { ...a, to: maskNumber(a.to) ?? "•••" } : a));
    const turn: LiveTurn = { at: now, userText, replyText: result.replyText, actions, done: result.done, trace: result.trace };
    s.turns.push(turn);
    if (s.turns.length > MAX_TURNS) s.turns.shift();
    s.lastAt = now;
    if (result.done) s.ended = true;
    const { turns: _turns, ...session } = s;
    this.emit({ type: "turn", session, turn });
  }

  recordEnd(sessionId: string) {
    const s = this.sessions.get(sessionId);
    if (!s || s.ended) return;
    s.ended = true;
    this.emit({ type: "ended", sessionId, at: Date.now() });
  }

  snapshot(): LiveSession[] {
    return [...this.sessions.values()].sort((a, b) => b.lastAt - a.lastAt);
  }

  subscribe(fn: (e: LiveEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: LiveEvent) {
    for (const fn of this.listeners) {
      try {
        fn(e);
      } catch (err) {
        console.error("live listener failed:", err);
      }
    }
  }

  private evict() {
    while (this.sessions.size > MAX_SESSIONS) {
      const oldest = [...this.sessions.values()].sort((a, b) => a.lastAt - b.lastAt)[0];
      if (!oldest) break;
      this.sessions.delete(oldest.sessionId);
    }
  }
}
