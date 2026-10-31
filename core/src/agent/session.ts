import type { Lang } from "../engine/index.js";
import type { Session, TurnMeta } from "./types.js";

/** Sessions idle longer than this are dropped (web chats never send a hang-up). */
const IDLE_MS = 2 * 60 * 60 * 1000;

/** In-memory session store for the prototype. */
export class SessionStore {
  private sessions = new Map<string, Session>();

  constructor(private idleMs = IDLE_MS) {}

  get(id: string): Session | undefined {
    const s = this.sessions.get(id);
    if (s && Date.now() - s.lastActiveAt > this.idleMs) {
      this.sessions.delete(id);
      return undefined;
    }
    if (s) s.lastActiveAt = Date.now();
    return s;
  }

  create(id: string, lang: Lang, meta: TurnMeta = {}): Session {
    this.sweep();
    const now = Date.now();
    const session: Session = {
      id,
      lang,
      state: "collecting",
      stated: { ...(meta.knownFacts ?? {}) },
      topics: [],
      questionsAsked: 0,
      pendingFact: null,
      lastPrompt: null,
      offered: [],
      offeredUpTo: 0,
      selectedScheme: null,
      discussed: [],
      scamPatternsLogged: [],
      history: [],
      callerNumber: meta.callerNumber ?? null,
      profilePhone: meta.profilePhone ?? null,
      checklist: null,
      channel: meta.channel ?? "text",
      startedAt: now,
      lastActiveAt: now,
    };
    this.sessions.set(id, session);
    return session;
  }

  delete(id: string): void {
    this.sessions.delete(id);
  }

  private sweep() {
    const now = Date.now();
    for (const [id, s] of this.sessions) if (now - s.lastActiveAt > this.idleMs) this.sessions.delete(id);
  }
}
