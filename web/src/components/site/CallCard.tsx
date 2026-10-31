"use client";

import { LiveKitRoom, RoomAudioRenderer, useRoomContext } from "@livekit/components-react";
import { useEffect, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import { useLang } from "@/lib/lang";

// Public on purpose: it's the number printed on the page.
const CALL_NUMBER = process.env.NEXT_PUBLIC_CALL_NUMBER ?? "";
const LANG_TOPIC = "yojana.lang"; // voice/agent.py listens on this text-stream topic

function InCall({ onEnd }: { onEnd: () => void }) {
  const room = useRoomContext();
  const { lang } = useLang();
  // Switching the site language mid-call switches the agent's language too.
  const started = useRef(lang);
  useEffect(() => {
    if (lang === started.current) return;
    started.current = lang;
    void room.localParticipant.sendText(lang, { topic: LANG_TOPIC }).catch(() => {});
  }, [lang, room]);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="flex items-center gap-2 text-sm font-medium text-emerald-900">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-500" />
        {t("inCall", lang)}
      </span>
      <button
        onClick={() => {
          void room.disconnect();
          onEnd();
        }}
        className="rounded-full bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700"
      >
        {t("endCall", lang)}
      </button>
    </div>
  );
}

/** "Call our agent": the phone number, plus a browser call to the same voice agent as a backup. */
export function CallCard() {
  const { lang } = useLang();
  const [conn, setConn] = useState<{ serverUrl: string; token: string } | null>(null);
  const [status, setStatus] = useState<"idle" | "connecting" | "error">("idle");

  const startBrowserCall = async () => {
    setStatus("connecting");
    try {
      const res = await fetch("/api/token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lang }) });
      if (!res.ok) throw new Error(String(res.status));
      setConn((await res.json()) as { serverUrl: string; token: string });
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  };

  return (
    <section className="rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-700 p-5 text-white shadow-sm">
      <h2 className="text-lg font-semibold">📞 {t("callTitle", lang)}</h2>
      <p className="mt-1 text-sm text-emerald-50">{t("callBody", lang)}</p>
      {CALL_NUMBER ? (
        <a href={`tel:${CALL_NUMBER.replace(/[^\d+]/g, "")}`} className="mt-3 block text-2xl font-bold tracking-wide underline-offset-4 hover:underline">
          {CALL_NUMBER}
        </a>
      ) : (
        <p className="mt-3 text-lg font-semibold">{t("callNumberMissing", lang)}</p>
      )}
      <p className="mt-1 text-xs text-emerald-100">{t("callNote", lang)}</p>

      <div className="mt-4 rounded-xl bg-white/95 p-3 text-slate-900">
        {conn ? (
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
            <InCall onEnd={() => setConn(null)} />
          </LiveKitRoom>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => void startBrowserCall()}
              disabled={status === "connecting"}
              className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              🎙 {status === "connecting" ? t("connecting", lang) : t("callFromBrowser", lang)}
            </button>
            {status === "error" && <span className="text-sm text-rose-700">{t("callFailed", lang)}</span>}
          </div>
        )}
      </div>
    </section>
  );
}
