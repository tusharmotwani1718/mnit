"use client";

import { useState } from "react";
import { clock, LANG_LABEL } from "@/lib/format";
import { useLiveSessions, useMeta } from "@/lib/useLive";
import { BrowserCall } from "./BrowserCall";
import { CallView } from "./CallView";

export function LivePanel() {
  const { sessions, connected } = useLiveSessions();
  const meta = useMeta();
  const [pinned, setPinned] = useState<string | null>(null);

  // Follow the most recent live call unless the viewer picked one.
  const followed = sessions.find((s) => !s.ended) ?? sessions[0];
  const selected = sessions.find((s) => s.sessionId === pinned) ?? followed;

  return (
    <div className="flex h-dvh flex-col bg-slate-50 text-slate-900">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <div>
          <h1 className="text-lg font-bold tracking-tight">Yojana Darshak · Live call view</h1>
          <p className="text-xs text-slate-500">Every turn of every call, as the rules engine sees it.</p>
        </div>
        <div className="flex items-center gap-4">
          <span className={`flex items-center gap-1.5 text-xs ${connected ? "text-emerald-700" : "text-rose-700"}`}>
            <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-500" : "bg-rose-500"}`} />
            {connected ? "Connected to core" : "Core not reachable, retrying…"}
          </span>
          <BrowserCall />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
          <h2 className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Calls</h2>
          <ul className="flex-1 overflow-y-auto px-2 pb-3">
            {sessions.length === 0 && <li className="px-2 py-2 text-sm text-slate-500">No calls yet.</li>}
            {sessions.map((s) => {
              const lang = s.turns.at(-1)?.trace.lang;
              const isSelected = s.sessionId === selected?.sessionId;
              return (
                <li key={s.sessionId}>
                  <button
                    onClick={() => setPinned(isSelected && pinned ? null : s.sessionId)}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm ${isSelected ? "bg-slate-800 text-white" : "hover:bg-slate-100"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">
                        {s.channel === "phone" ? "📞" : s.channel === "browser" ? "🌐" : "💬"} {s.caller ?? s.channel}
                      </span>
                      {!s.ended && <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-500" />}
                    </div>
                    <div className={`text-xs ${isSelected ? "text-slate-300" : "text-slate-500"}`}>
                      {clock(s.startedAt)} · {s.turns.length} turns{lang ? ` · ${LANG_LABEL[lang]}` : ""}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
          {pinned && (
            <button onClick={() => setPinned(null)} className="m-2 rounded-lg bg-slate-100 py-1.5 text-xs text-slate-700 hover:bg-slate-200">
              Follow latest call
            </button>
          )}
        </aside>

        <main className="flex min-h-0 flex-1 flex-col p-4">
          {selected ? (
            <CallView session={selected} meta={meta} />
          ) : (
            <div className="m-auto max-w-md text-center text-slate-600">
              <p className="text-lg font-semibold text-slate-800">Waiting for a call…</p>
              <p className="mt-2 text-sm">
                Call the Yojana Darshak number, or use “Call from browser” above. The conversation, the facts understood and every
                scheme&apos;s eligibility will appear here live.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
