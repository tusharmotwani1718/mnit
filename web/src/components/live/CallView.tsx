"use client";

import { useEffect, useRef } from "react";
import { clock, formatValue, humanize, LANG_LABEL, STATUS } from "@/lib/format";
import type { Action, LiveSession, Meta, RagTrace } from "@/lib/types";
import { SchemeCard } from "./SchemeCard";

const MAX_QUESTIONS = 5; // core/src/agent/turn.ts stopping rule

function ActionBadge({ action, meta }: { action: Action; meta: Meta | null }) {
  switch (action.type) {
    case "LOG_SCAM_REPORT":
      return <span className="rounded bg-rose-600 px-2 py-0.5 text-xs font-medium text-white">⚠ Scam report logged: {humanize(action.pattern)}</span>;
    case "SEND_CHECKLIST": {
      const names = action.schemeIds.map((id) => meta?.schemes.find((s) => s.id === id)?.name.en ?? id);
      return (
        <span className="rounded bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white">
          ✉ Checklist by SMS: {names.join(", ")}
        </span>
      );
    }
    case "SET_LANGUAGE":
      return <span className="rounded bg-violet-600 px-2 py-0.5 text-xs font-medium text-white">↻ Language → {LANG_LABEL[action.lang]}</span>;
    case "HANDOFF":
      return <span className="rounded bg-slate-600 px-2 py-0.5 text-xs font-medium text-white">→ Handed off to CSC</span>;
  }
}

function Citations({ rag }: { rag: RagTrace | null }) {
  const used = rag?.used.map((i) => rag.retrieved[i]).filter((c) => c !== undefined) ?? [];
  if (!used.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
      <span className="font-medium text-sky-800">📚 Answered from</span>
      {used.map((c) => (
        <a
          key={c.id}
          href={c.sourceUrl}
          target="_blank"
          rel="noreferrer"
          title={c.preview}
          className="rounded bg-sky-50 px-2 py-0.5 text-sky-900 ring-1 ring-sky-200 hover:bg-sky-100"
        >
          {c.title}
          {c.tier === "extra" && " (no rules: “may be eligible”)"} ↗
        </a>
      ))}
    </div>
  );
}

function Retrieval({ rag }: { rag: RagTrace | null }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-slate-700">Knowledge retrieved (RAG over official documents)</h2>
      {!rag ? (
        <p className="mt-2 text-sm text-slate-500">Not needed this turn: a plain answer to the engine&apos;s question.</p>
      ) : rag.retrieved.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">Nothing retrieved.</p>
      ) : (
        <ol className="mt-2 space-y-2">
          {rag.retrieved.map((c, i) => {
            const cited = rag.used.includes(i);
            return (
              <li key={c.id} className={`rounded-lg border px-3 py-2 text-sm ${cited ? "border-sky-300 bg-sky-50" : "border-slate-200"}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="font-medium text-slate-900 hover:underline">
                    {c.title} ↗
                  </a>
                  <span className="text-xs text-slate-500">
                    {cited && <span className="mr-2 font-semibold text-sky-800">cited</span>}
                    {c.tier === "extra" ? "RAG-only scheme" : "rule scheme"}
                    {c.score !== null && ` · similarity ${c.score.toFixed(2)}`}
                  </span>
                </div>
                <p className="mt-1 line-clamp-3 text-xs text-slate-600">{c.preview}</p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function Transcript({ session, meta }: { session: LiveSession; meta: Meta | null }) {
  const end = useRef<HTMLDivElement>(null);
  // Block body: newer browsers return a Promise from scrollIntoView, and an effect may only return a cleanup.
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [session.turns.length]);

  return (
    <section className="flex min-h-0 flex-col rounded-xl border border-slate-200 bg-white">
      <h2 className="border-b border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">Conversation</h2>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {session.turns.map((t, i) => (
          <div key={i} className="space-y-1.5">
            {t.userText && (
              <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-slate-800 px-3 py-2 text-white">
                <p className="text-[15px] leading-snug">{t.userText}</p>
              </div>
            )}
            <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-slate-100 px-3 py-2 text-slate-900">
              <p className="text-[15px] leading-snug">{t.replyText}</p>
              <p className="mt-1 text-[11px] text-slate-500">{clock(t.at)}</p>
            </div>
            <Citations rag={t.trace.rag ?? null} />
            {t.actions.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {t.actions.map((a, j) => (
                  <ActionBadge key={j} action={a} meta={meta} />
                ))}
              </div>
            )}
          </div>
        ))}
        <div ref={end} />
      </div>
    </section>
  );
}

export function CallView({ session, meta }: { session: LiveSession; meta: Meta | null }) {
  const last = session.turns.at(-1);
  if (!last) return null;
  const { trace } = last;
  const scam = session.turns.flatMap((t) => t.actions).find((a) => a.type === "LOG_SCAM_REPORT");
  const schemeById = new Map(meta?.schemes.map((s) => [s.id, s]));
  const results = [...trace.results].sort(
    (a, b) => STATUS[a.status].order - STATUS[b.status].order || a.schemeId.localeCompare(b.schemeId),
  );
  const counts = Object.fromEntries(
    (Object.keys(STATUS) as (keyof typeof STATUS)[]).map((k) => [k, trace.results.filter((r) => r.status === k).length]),
  );
  const facts = Object.entries(trace.facts);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-full bg-slate-800 px-3 py-1 font-medium text-white">
          {session.channel === "phone" ? "📞 Phone call" : session.channel === "browser" ? "🌐 Browser call" : `💬 ${session.channel}`}
          {session.caller && <> · {session.caller}</>}
        </span>
        <span className="rounded-full bg-violet-100 px-3 py-1 font-medium text-violet-800">{LANG_LABEL[trace.lang]}</span>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">Stage: {humanize(trace.state)}</span>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
          Topics: {trace.topics.length ? trace.topics.join(", ") : "all"}
        </span>
        {session.ended ? (
          <span className="rounded-full bg-slate-200 px-3 py-1 text-slate-600">Call ended</span>
        ) : (
          <span className="flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 font-medium text-emerald-800">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> Live
          </span>
        )}
      </div>

      {scam && (
        <div className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-2 text-sm text-rose-900">
          <span className="font-semibold">⚠ Scam attempt reported on this call.</span> The caller was warned that schemes are free, and
          an anonymised report was logged for the area.
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Transcript session={session} meta={meta} />

        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
          <div className="grid gap-3 md:grid-cols-2">
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-slate-700">Next question (chosen by the rules engine)</h2>
              {trace.next && trace.state === "collecting" ? (
                <>
                  <p className="mt-2 text-base font-medium text-slate-900">{meta?.facts[trace.next.fact]?.label ?? humanize(trace.next.fact)}</p>
                  <p className="mt-1 text-sm text-slate-600">
                    Asked because it settles <span className="font-semibold">{trace.next.resolves}</span> open scheme
                    {trace.next.resolves === 1 ? "" : "s"} at once.
                  </p>
                </>
              ) : (
                <p className="mt-2 text-sm text-slate-600">No more questions: speaking results.</p>
              )}
              <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                <div className="h-1.5 flex-1 rounded-full bg-slate-100">
                  <div
                    className="h-1.5 rounded-full bg-slate-700 transition-all"
                    style={{ width: `${Math.min(trace.questionsAsked / MAX_QUESTIONS, 1) * 100}%` }}
                  />
                </div>
                {trace.questionsAsked}/{MAX_QUESTIONS} questions
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-slate-700">Facts understood</h2>
              {facts.length ? (
                <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
                  {facts.map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-slate-600">{humanize(k)}</dt>
                      <dd className="text-right font-medium text-slate-900">
                        {k === "landHectares" ? `${formatValue(v)} ha` : formatValue(v)}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mt-2 text-sm text-slate-500">Nothing yet.</p>
              )}
            </section>
          </div>

          <Retrieval rag={trace.rag ?? null} />

          <section>
            <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="text-sm font-semibold text-slate-700">Eligibility: decided by verified rules, not the AI</h2>
              <span className="text-xs text-slate-500">
                {counts.eligible} eligible · {counts.likely_eligible} likely · {counts.need_more_info} need info ·{" "}
                {counts.not_eligible} not eligible
              </span>
            </div>
            <div className="grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
              {results.map((r) => (
                <SchemeCard key={r.schemeId} result={r} scheme={schemeById.get(r.schemeId)} lang={trace.lang} />
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
