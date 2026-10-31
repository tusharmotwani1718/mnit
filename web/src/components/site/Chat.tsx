"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { t, VALUE_LABELS } from "@/lib/i18n";
import { useLang } from "@/lib/lang";
import type { Catalog, Lang, Profile, RagTrace, Trace, TurnResult } from "@/lib/types";

type Message = { role: "bot" | "user"; text: string; sources?: { title: string; url: string }[] };
type ChatState = { sessionId: string; messages: Message[]; trace: Trace | null; ended: boolean; lang: Lang };

const STORAGE_KEY = "yd_chat";

const newSessionId = () => `web-${crypto.randomUUID()}`;

function load(): ChatState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ChatState) : null;
  } catch {
    return null;
  }
}

function persist(state: ChatState) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // the chat still works, it just won't survive a reload
  }
}

function citations(rag: RagTrace | null): Message["sources"] {
  const used = rag?.used.map((i) => rag.retrieved[i]).filter((c) => c !== undefined) ?? [];
  return used.length ? used.map((c) => ({ title: c.title, url: c.sourceUrl })) : undefined;
}

/** Buttons for the likely answers to what the assistant just asked. */
function quickReplies(trace: Trace | null, catalog: Catalog | null, lang: Lang): string[] {
  if (!trace) return [];
  const yesNo = [t("yes", lang), t("no", lang)];
  if (trace.state === "collecting" && trace.next) {
    const def = catalog?.facts[trace.next.fact];
    if (def?.type === "boolean") return yesNo;
    const options = VALUE_LABELS[trace.next.fact];
    if (def?.type === "enum" && options) return Object.values(options).map((o) => o[lang]);
    return [];
  }
  if (trace.state === "results" || trace.state === "details") {
    const names = trace.results
      .filter((r) => r.status === "eligible" || r.status === "likely_eligible")
      .map((r) => catalog?.schemes.find((s) => s.id === r.schemeId)?.name[lang])
      .filter((n): n is string => !!n)
      .slice(0, 4);
    return [...yesNo, ...names];
  }
  if (trace.state === "consent") return yesNo;
  return [];
}

/** Text chat with the same agent (rules engine + RAG) as the phone line. Reports each turn's trace to the parent. */
export function Chat({ catalog, me, onTrace }: { catalog: Catalog | null; me: Profile | null | undefined; onTrace: (trace: Trace | null) => void }) {
  const { lang } = useLang();
  // Rendered only in the browser (see HomePage), so the chat of this tab can be restored right away.
  const [state, setState] = useState<ChatState | null>(load);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<ChatState | null>(state);

  const update = useCallback(
    (next: ChatState) => {
      stateRef.current = next;
      setState(next);
      persist(next);
      onTrace(next.trace);
    },
    [onTrace],
  );

  const turn = useCallback(
    async (base: ChatState, text: string): Promise<void> => {
      setBusy(true);
      setError(false);
      let current = text ? { ...base, messages: [...base.messages, { role: "user" as const, text }] } : base;
      let sent = text;
      if (text) update(current);
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          const res = await fetch("/api/chat/turn", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sessionId: current.sessionId, text: sent, lang: current.lang }),
          });
          if (res.status === 403) {
            // The chat belonged to a different login (logged in or out since): start a fresh one.
            current = { sessionId: newSessionId(), messages: [], trace: null, ended: false, lang: current.lang };
            sent = "";
            continue;
          }
          if (!res.ok) throw new Error(String(res.status));
          const r = (await res.json()) as TurnResult;
          update({
            ...current,
            messages: [...current.messages, { role: "bot", text: r.replyText, sources: citations(r.trace.rag) }],
            trace: r.trace,
            ended: r.done,
            lang: r.trace.lang,
          });
          return;
        }
      } catch {
        setError(true);
      } finally {
        setBusy(false);
      }
    },
    [update],
  );

  const start = useCallback(() => {
    void turn({ sessionId: newSessionId(), messages: [], trace: null, ended: false, lang }, "");
  }, [lang, turn]);

  // Show the restored chat's schemes; or start a chat once we know whether the user is logged in.
  useEffect(() => {
    if (stateRef.current) {
      onTrace(stateRef.current.trace);
      return;
    }
    if (me === undefined) return;
    const id = setTimeout(start, 0);
    return () => clearTimeout(id);
  }, [me, onTrace, start]);

  // Site language changed mid-chat: the agent switches too and repeats its question.
  useEffect(() => {
    const s = stateRef.current;
    if (!s || s.lang === lang || s.ended || busy) return;
    void (async () => {
      const res = await fetch("/api/chat/language", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: s.sessionId, lang }),
      }).catch(() => null);
      if (res?.ok) {
        const r = (await res.json()) as TurnResult;
        update({ ...s, lang, trace: r.trace, messages: r.replyText ? [...s.messages, { role: "bot", text: r.replyText }] : s.messages });
      } else if (res?.status === 404) {
        start(); // core restarted and forgot the chat
      } else update({ ...s, lang });
    })();
  }, [lang, busy, start, update]);

  // Block body on purpose: newer browsers return a Promise from scrollIntoView, and an effect may only return a cleanup.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [state?.messages.length, busy]);

  const send = (text: string) => {
    const s = stateRef.current;
    const clean = text.trim();
    if (!s || !clean || busy || s.ended) return;
    setInput("");
    void turn(s, clean);
  };

  const reset = () => {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {}
    stateRef.current = null;
    setState(null);
    onTrace(null);
    start();
  };

  const replies = state && !state.ended && !busy ? quickReplies(state.trace, catalog, lang) : [];

  return (
    <section aria-label={t("chatTitle", lang)} className="flex h-[70vh] min-h-[28rem] flex-col rounded-2xl border border-slate-200 bg-white shadow-sm lg:h-[calc(100dvh-9rem)]">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <h2 className="font-semibold text-slate-900">💬 {t("chatTitle", lang)}</h2>
        <button onClick={reset} className="rounded-full px-3 py-1 text-sm text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50">
          {t("newChat", lang)}
        </button>
      </div>

      <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-600">
        {me ? (
          me.consent ? (
            <span>✓ {t("usingProfile", lang)}</span>
          ) : (
            <Link href="/profile" className="text-emerald-700 hover:underline">
              {t("turnOnSaving", lang)}
            </Link>
          )
        ) : me === null ? (
          <Link href="/login" className="text-emerald-700 hover:underline">
            {t("loginToSave", lang)}
          </Link>
        ) : null}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
        {state?.messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-emerald-600 px-4 py-2.5 text-white">
              {m.text}
            </div>
          ) : (
            <div key={i} className="max-w-[90%]">
              <div className="rounded-2xl rounded-bl-sm bg-slate-100 px-4 py-2.5 leading-relaxed text-slate-900">{m.text}</div>
              {m.sources && (
                <p className="mt-1 px-1 text-xs text-slate-500">
                  📚 {t("answeredFrom", lang)}:{" "}
                  {m.sources.map((s, j) => (
                    <a key={j} href={s.url} target="_blank" rel="noreferrer" className="mr-2 text-emerald-700 hover:underline">
                      {s.title} ↗
                    </a>
                  ))}
                </p>
              )}
            </div>
          ),
        )}
        {busy && <div className="w-fit rounded-2xl bg-slate-100 px-4 py-2.5 text-slate-500">{t("thinking", lang)}</div>}
        {error && <p className="text-sm text-rose-700">{t("chatError", lang)}</p>}
        {state?.ended && <p className="text-center text-sm text-slate-500">{t("chatEnded", lang)}</p>}
        <div ref={endRef} />
      </div>

      {replies.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-slate-100 px-4 pt-3">
          {replies.map((r) => (
            <button key={r} onClick={() => send(r)} className="rounded-full bg-emerald-50 px-3 py-1.5 text-sm text-emerald-900 ring-1 ring-emerald-200 hover:bg-emerald-100">
              {r}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (state?.ended) reset();
          else send(input);
        }}
        className="flex gap-2 p-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("placeholder", lang)}
          maxLength={500}
          disabled={!state || state.ended}
          aria-label={t("placeholder", lang)}
          className="min-w-0 flex-1 rounded-full border border-slate-300 px-4 py-2.5 text-base outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 disabled:bg-slate-50"
        />
        <button
          type="submit"
          disabled={busy || (!state?.ended && !input.trim())}
          className="rounded-full bg-emerald-600 px-5 py-2.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {state?.ended ? t("newChat", lang) : t("send", lang)}
        </button>
      </form>
    </section>
  );
}
