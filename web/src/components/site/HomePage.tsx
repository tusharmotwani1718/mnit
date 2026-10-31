"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { t } from "@/lib/i18n";
import { useLang } from "@/lib/lang";
import type { Trace } from "@/lib/types";
import { useCatalog, useMe } from "@/lib/useAccount";
import { CallCard } from "./CallCard";
// The chat lives in this tab's sessionStorage, so it renders in the browser only.
const Chat = dynamic(() => import("./Chat").then((m) => m.Chat), {
  ssr: false,
  loading: () => <div className="h-[70vh] min-h-[28rem] animate-pulse rounded-2xl border border-slate-200 bg-white lg:h-[calc(100dvh-9rem)]" />,
});
import { SchemeResults } from "./SchemeResults";
import { SiteHeader } from "./SiteHeader";

export function HomePage() {
  const { lang } = useLang();
  const catalog = useCatalog();
  const { me } = useMe();
  const [trace, setTrace] = useState<Trace | null>(null);

  return (
    <div className="min-h-dvh bg-slate-50">
      <SiteHeader me={me} />
      <main className="mx-auto max-w-6xl px-4 py-5">
        <div className="mb-4">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{t("tagline", lang)}</h1>
          <p className="mt-1 text-sm text-slate-600">🔒 {t("trust", lang)}</p>
        </div>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <Chat catalog={catalog} me={me} onTrace={setTrace} />
          <div className="space-y-5 lg:max-h-[calc(100dvh-9rem)] lg:overflow-y-auto lg:pr-1">
            <CallCard />
            <SchemeResults results={trace?.results ?? null} catalog={catalog} />
          </div>
        </div>
      </main>
    </div>
  );
}
