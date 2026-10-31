"use client";

import Link from "next/link";
import { t } from "@/lib/i18n";
import { useLang } from "@/lib/lang";
import type { Lang, Profile } from "@/lib/types";

const LANGS: { code: Lang; label: string }[] = [
  { code: "hi", label: "हिंदी" },
  { code: "mr", label: "मराठी" },
  { code: "en", label: "English" },
];

/** Switches the site language; `onPick` also gets the choice (e.g. to store it in the profile). */
export function LanguagePicker({ onPick }: { onPick?: (l: Lang) => void } = {}) {
  const { lang, setLang } = useLang();
  return (
    <div role="group" aria-label={t("language", lang)} className="flex rounded-full bg-slate-100 p-0.5">
      {LANGS.map((l) => (
        <button
          key={l.code}
          type="button"
          onClick={() => {
            setLang(l.code);
            onPick?.(l.code);
          }}
          aria-pressed={l.code === lang}
          className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
            l.code === lang ? "bg-white text-emerald-800 shadow-sm" : "text-slate-600 hover:text-slate-900"
          }`}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}

/** Brand, language switch, and login / profile link. `me` undefined = still loading. */
export function SiteHeader({ me }: { me?: Profile | null }) {
  const { lang } = useLang();
  return (
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <span aria-hidden className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-600 text-lg font-bold text-white">
            यो
          </span>
          <span className="text-lg font-bold tracking-tight text-slate-900">{t("appName", lang)}</span>
        </Link>
        <div className="flex items-center gap-2">
          <LanguagePicker />
          {me === undefined ? null : me ? (
            <Link href="/profile" className="rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-100">
              {me.name || t("profile", lang)}
            </Link>
          ) : (
            <Link href="/login" className="rounded-full bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700">
              {t("login", lang)}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
