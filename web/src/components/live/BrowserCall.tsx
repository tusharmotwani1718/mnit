"use client";

import { LiveKitRoom, RoomAudioRenderer, useRoomContext } from "@livekit/components-react";
import { useState } from "react";
import { LANG_LABEL } from "@/lib/format";
import type { Lang } from "@/lib/types";

const LANGS: Lang[] = ["hi", "mr", "en"];
const LANG_TOPIC = "yojana.lang"; // voice/agent.py listens on this text-stream topic

function InCallControls({ lang, onLang }: { lang: Lang; onLang: (l: Lang) => void }) {
  const room = useRoomContext();
  const switchTo = async (l: Lang) => {
    onLang(l);
    await room.localParticipant.sendText(l, { topic: LANG_TOPIC });
  };
  return (
    <div className="flex items-center gap-1.5">
      {LANGS.map((l) => (
        <button
          key={l}
          onClick={() => void switchTo(l)}
          className={`rounded-full px-3 py-1.5 text-sm font-medium ${l === lang ? "bg-violet-600 text-white" : "bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"}`}
        >
          {LANG_LABEL[l]}
        </button>
      ))}
      <button
        onClick={() => void room.disconnect()}
        className="ml-1 rounded-full bg-rose-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-rose-700"
      >
        End call
      </button>
    </div>
  );
}

/** Backup channel: talk to the same agent from the browser (no phone, no telephony minutes). */
export function BrowserCall() {
  const [conn, setConn] = useState<{ serverUrl: string; token: string } | null>(null);
  const [lang, setLang] = useState<Lang>("hi");
  const [status, setStatus] = useState<"idle" | "connecting" | "error">("idle");

  const start = async () => {
    setStatus("connecting");
    try {
      const res = await fetch("/api/token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lang }) });
      if (!res.ok) throw new Error(String(res.status));
      setConn(await res.json());
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  };

  if (conn) {
    return (
      <LiveKitRoom
        serverUrl={conn.serverUrl}
        token={conn.token}
        connect
        audio
        video={false}
        onDisconnected={() => setConn(null)}
        onError={() => {
          setConn(null);
          setStatus("error");
        }}
      >
        <RoomAudioRenderer />
        <InCallControls lang={lang} onLang={setLang} />
      </LiveKitRoom>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={lang}
        onChange={(e) => setLang(e.target.value as Lang)}
        className="rounded-full bg-white px-3 py-1.5 text-sm text-slate-700 ring-1 ring-slate-300"
        aria-label="Call language"
      >
        {LANGS.map((l) => (
          <option key={l} value={l}>
            {LANG_LABEL[l]}
          </option>
        ))}
      </select>
      <button
        onClick={() => void start()}
        disabled={status === "connecting"}
        className="rounded-full bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
      >
        {status === "connecting" ? "Connecting…" : "🎙 Call from browser"}
      </button>
      {status === "error" && <span className="text-sm text-rose-700">Couldn&apos;t start the call</span>}
    </div>
  );
}
