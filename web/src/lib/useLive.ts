"use client";

import { useEffect, useReducer, useState } from "react";
import type { LiveEvent, LiveSession, Meta } from "./types";

type State = { sessions: Record<string, LiveSession>; connected: boolean };
type Msg = LiveEvent | { type: "connection"; connected: boolean };

const MAX_TURNS = 60;

function reducer(state: State, msg: Msg): State {
  switch (msg.type) {
    case "connection":
      return { ...state, connected: msg.connected };
    case "snapshot":
      return { ...state, sessions: Object.fromEntries(msg.sessions.map((s) => [s.sessionId, s])) };
    case "turn": {
      const prev = state.sessions[msg.session.sessionId];
      const turns = [...(prev?.turns ?? []), msg.turn].slice(-MAX_TURNS);
      return { ...state, sessions: { ...state.sessions, [msg.session.sessionId]: { ...msg.session, turns } } };
    }
    case "ended": {
      const prev = state.sessions[msg.sessionId];
      if (!prev) return state;
      return { ...state, sessions: { ...state.sessions, [msg.sessionId]: { ...prev, ended: true, lastAt: msg.at } } };
    }
  }
}

/** Live call sessions from core, via the /api/live/events proxy. EventSource reconnects on its own. */
export function useLiveSessions() {
  const [state, dispatch] = useReducer(reducer, { sessions: {}, connected: false });

  useEffect(() => {
    const source = new EventSource("/api/live/events");
    source.onopen = () => dispatch({ type: "connection", connected: true });
    source.onerror = () => dispatch({ type: "connection", connected: false });
    source.onmessage = (e) => {
      try {
        dispatch(JSON.parse(e.data) as LiveEvent);
      } catch {
        // ignore malformed events
      }
    };
    return () => source.close();
  }, []);

  const sessions = Object.values(state.sessions).sort((a, b) => b.lastAt - a.lastAt);
  return { sessions, connected: state.connected };
}

export function useMeta() {
  const [meta, setMeta] = useState<Meta | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      for (let attempt = 0; attempt < 30 && !cancelled; attempt++) {
        try {
          const res = await fetch("/api/live/meta");
          if (res.ok) {
            const data = (await res.json()) as Meta;
            if (!cancelled) setMeta(data);
            return;
          }
        } catch {
          // core not up yet; retry
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);
  return meta;
}
