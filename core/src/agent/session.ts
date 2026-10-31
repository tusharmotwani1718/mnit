import type { Lang } from "../engine/index.js";
import type { Session, TurnMeta } from "./types.js";

/** In-memory session store for the prototype; persisted to Supabase at call end later. */
export class SessionStore {
  private sessions = new Map<string, Session>();

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  create(id: string, lang: Lang, meta: TurnMeta = {}): Session {
    const session: Session = {
      id,
      lang,
      state: "collecting",
      stated: {},
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
      checklist: null,
      channel: meta.channel ?? "text",
      startedAt: Date.now(),
    };
    this.sessions.set(id, session);
    return session;
  }

  delete(id: string): void {
    this.sessions.delete(id);
  }
}
