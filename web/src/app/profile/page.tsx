"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { LanguagePicker, SiteHeader } from "@/components/site/SiteHeader";
import { FACT_LABELS, HECTARES_PER_ACRE, t, VALUE_LABELS } from "@/lib/i18n";
import { useLang } from "@/lib/lang";
import type { CatalogFact, Lang, Profile } from "@/lib/types";
import { api, useCatalog, useMe } from "@/lib/useAccount";

type FactValue = string | number | boolean;

/** One answer: yes/no, a choice, or a number (land in acres, stored in hectares). */
function FactInput({
  name,
  def,
  value,
  onChange,
  lang,
}: {
  name: string;
  def: CatalogFact;
  value: FactValue | undefined;
  onChange: (v: FactValue | null) => void;
  lang: Lang;
}) {
  const cls = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500";
  if (def.type === "boolean") {
    return (
      <select
        className={cls}
        value={value === undefined ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value === "true")}
      >
        <option value="">{t("notSet", lang)}</option>
        <option value="true">{t("yes", lang)}</option>
        <option value="false">{t("no", lang)}</option>
      </select>
    );
  }
  if (def.type === "enum") {
    return (
      <select className={cls} value={value === undefined ? "" : String(value)} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{t("notSet", lang)}</option>
        {(def.values ?? []).map((v) => (
          <option key={v} value={v}>
            {VALUE_LABELS[name]?.[v]?.[lang] ?? v}
          </option>
        ))}
      </select>
    );
  }
  if (def.type === "number") {
    const isLand = name === "landHectares";
    const shown = typeof value === "number" ? (isLand ? Math.round((value / HECTARES_PER_ACRE) * 100) / 100 : value) : "";
    return (
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          step={isLand ? 0.25 : 1}
          inputMode="decimal"
          className={cls}
          value={shown}
          onChange={(e) => {
            const n = e.target.value === "" ? null : Number(e.target.value);
            onChange(n === null || Number.isNaN(n) ? null : isLand ? Math.round(n * HECTARES_PER_ACRE * 10000) / 10000 : n);
          }}
        />
        {isLand && <span className="text-sm text-slate-500">{t("acres", lang)}</span>}
      </div>
    );
  }
  return <input className={cls} maxLength={40} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value || null)} />;
}

export default function ProfilePage() {
  const { lang, setLang } = useLang();
  const { me, setMe } = useMe();

  // The profile's language becomes the site language when the page opens.
  useEffect(() => {
    if (me?.lang) setLang(me.lang);
  }, [me?.lang, setLang]);

  return (
    <div className="min-h-dvh bg-slate-50">
      <SiteHeader me={me} />
      <main className="mx-auto max-w-2xl px-4 py-6">
        <Link href="/" className="text-sm text-emerald-700 hover:underline">
          {t("backToChat", lang)}
        </Link>
        {me === undefined && <p className="mt-4 text-slate-600">{t("loading", lang)}</p>}
        {me === null && (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-6">
            <p className="text-slate-700">{t("needLogin", lang)}</p>
            <Link href="/login" className="mt-3 inline-block rounded-full bg-emerald-600 px-5 py-2 font-semibold text-white">
              {t("login", lang)}
            </Link>
          </div>
        )}
        {me && <ProfileForm key={me.phone} me={me} onSaved={setMe} />}
      </main>
    </div>
  );
}

/** Edits a copy of the profile; Save sends it to core. */
function ProfileForm({ me, onSaved }: { me: Profile; onSaved: (p: Profile) => void }) {
  const { lang } = useLang();
  const router = useRouter();
  const catalog = useCatalog();
  const [draft, setDraft] = useState<Profile>(me);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const save = async () => {
    setStatus("saving");
    // Send every known fact plus nulls for the ones the user cleared.
    const facts: Record<string, FactValue | null> = { ...draft.facts };
    for (const k of Object.keys(me.facts)) if (!(k in draft.facts)) facts[k] = null;
    const r = await api<Profile>("/api/me", "PUT", { name: draft.name, lang: draft.lang, consent: draft.consent, facts });
    if (!r.ok) return setStatus("error");
    onSaved(r.data);
    setDraft(r.data);
    setStatus("saved");
  };

  const logout = async () => {
    await api("/api/auth/logout", "POST");
    clearChat();
    router.push("/");
  };

  const remove = async () => {
    if (!window.confirm(t("deleteConfirm", lang))) return;
    const r = await api("/api/me", "DELETE");
    if (r.ok) {
      clearChat();
      router.push("/");
    }
  };

  const facts = catalog ? Object.entries(catalog.facts).filter(([k, d]) => d.askable && FACT_LABELS[k]) : [];

  return (
    <form
      className="mt-4 space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h1 className="text-xl font-bold text-slate-900">{t("profileTitle", lang)}</h1>
        <p className="mt-1 text-sm text-slate-600">📱 {draft.phone}</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="font-medium text-slate-800">{t("name", lang)}</span>
            <input
              maxLength={80}
              value={draft.name ?? ""}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-emerald-500"
            />
          </label>
          <div className="text-sm">
            <span className="font-medium text-slate-800">{t("preferredLanguage", lang)}</span>
            <div className="mt-1">
              <LanguagePicker onPick={(l) => setDraft((d) => ({ ...d, lang: l }))} />
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={draft.consent}
            onChange={(e) => setDraft({ ...draft, consent: e.target.checked, facts: e.target.checked ? draft.facts : {} })}
            className="mt-1 h-5 w-5 accent-emerald-600"
          />
          <span>
            <span className="font-semibold text-slate-900">{t("consentLabel", lang)}</span>
            <span className="mt-1 block text-sm text-slate-600">{t("consentHelp", lang)}</span>
          </span>
        </label>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-semibold text-slate-900">{t("yourAnswers", lang)}</h2>
        {!draft.consent ? (
          <p className="mt-2 text-sm text-slate-600">{t("answersOff", lang)}</p>
        ) : !catalog ? (
          <p className="mt-2 text-sm text-slate-600">{t("loading", lang)}</p>
        ) : (
          <div className="mt-3 grid gap-x-4 gap-y-3 sm:grid-cols-2">
            {facts.map(([key, def]) => (
              <label key={key} className="block text-sm">
                <span className="text-slate-700">{FACT_LABELS[key]![lang]}</span>
                <div className="mt-1">
                  <FactInput
                    name={key}
                    def={def}
                    lang={lang}
                    value={draft.facts[key]}
                    onChange={(v) => {
                      const next = { ...draft.facts };
                      if (v === null) delete next[key];
                      else next[key] = v;
                      setDraft({ ...draft, facts: next });
                    }}
                  />
                </div>
              </label>
            ))}
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={status === "saving"}
          className="rounded-full bg-emerald-600 px-6 py-2.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {status === "saving" ? t("saving", lang) : t("save", lang)}
        </button>
        {status === "saved" && <span className="text-sm text-emerald-700">✓ {t("saved", lang)}</span>}
        {status === "error" && <span className="text-sm text-rose-700">{t("saveFailed", lang)}</span>}
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => void logout()}
          className="rounded-full px-4 py-2 text-sm text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
        >
          {t("logout", lang)}
        </button>
      </div>

      <button type="button" onClick={() => void remove()} className="text-sm text-rose-700 hover:underline">
        {t("deleteProfile", lang)}
      </button>
    </form>
  );
}

/** A new login means a new chat: drop the one kept in this tab. */
function clearChat() {
  try {
    sessionStorage.removeItem("yd_chat");
  } catch {}
}
