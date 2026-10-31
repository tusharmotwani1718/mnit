"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { describeRule, FACT_LABELS, formatFact, personName, t } from "@/lib/i18n";
import { useLang } from "@/lib/lang";
import type { Band, CatalogScheme, Lang, Leaf, Readiness } from "@/lib/types";
import { useCatalog, useMe } from "@/lib/useAccount";
import { FactInput, type FactValue } from "./FactInput";
import { SiteHeader } from "./SiteHeader";

const GUEST_DOCS_KEY = "yd_docs";
const BAND_STYLE: Record<Band, { ring: string; text: string; bg: string }> = {
  ready: { ring: "#059669", text: "text-emerald-800", bg: "bg-emerald-50" },
  almost: { ring: "#d97706", text: "text-amber-800", bg: "bg-amber-50" },
  missing_info: { ring: "#64748b", text: "text-slate-800", bg: "bg-slate-100" },
  not_eligible: { ring: "#e11d48", text: "text-rose-800", bg: "bg-rose-50" },
};

/** Facts from this tab's chat (guests, or users who don't save answers). */
function chatFacts(): Record<string, FactValue> {
  try {
    const chat = JSON.parse(sessionStorage.getItem("yd_chat") ?? "null") as { trace?: { facts?: Record<string, FactValue> } } | null;
    return chat?.trace?.facts ?? {};
  } catch {
    return {};
  }
}

function guestDocs(): string[] | null {
  try {
    return JSON.parse(sessionStorage.getItem(GUEST_DOCS_KEY) ?? "null") as string[] | null;
  } catch {
    return null;
  }
}

function Gauge({ score, band }: { score: number; band: Band }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 120 120" className="h-36 w-36 shrink-0" role="img" aria-label={`${score} / 100`}>
      <circle cx="60" cy="60" r={r} fill="none" stroke="#e2e8f0" strokeWidth="12" />
      <circle
        cx="60"
        cy="60"
        r={r}
        fill="none"
        stroke={BAND_STYLE[band].ring}
        strokeWidth="12"
        strokeLinecap="round"
        strokeDasharray={`${(score / 100) * c} ${c}`}
        transform="rotate(-90 60 60)"
        style={{ transition: "stroke-dasharray 400ms ease" }}
      />
      <text x="60" y="58" textAnchor="middle" className="fill-slate-900 text-[30px] font-bold">
        {score}
      </text>
      <text x="60" y="80" textAnchor="middle" className="fill-slate-500 text-[12px]">
        / 100
      </text>
    </svg>
  );
}

function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="text-slate-700">{label}</span>
        <span className="font-semibold text-slate-900">
          {value}/{max}
        </span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-slate-100">
        <div className="h-2 rounded-full bg-emerald-600 transition-all" style={{ width: `${(value / max) * 100}%` }} />
      </div>
    </div>
  );
}

function leafText(leaf: Leaf, lang: Lang) {
  return "fact" in leaf ? describeRule(leaf.fact, leaf.op, leaf.expected, lang) : t("checkedAtOffice", lang);
}

const factsOf = (options: Leaf[][]) => [...new Set(options.flat().flatMap((l) => ("fact" in l ? [l.fact] : [])))];

function Values({ facts, values, lang }: { facts: string[]; values: Record<string, FactValue>; lang: Lang }) {
  if (!facts.length) return <span className="text-slate-500">{t("checkedAtOffice", lang)}</span>;
  const shown = facts.filter((f) => f in values);
  if (!shown.length) return <span className="text-slate-400">?</span>;
  return (
    <>
      {shown.map((f) => (
        <div key={f}>
          {facts.length > 1 && <span className="text-slate-500">{FACT_LABELS[f]?.[lang] ?? f}: </span>}
          {formatFact(f, values[f], lang)}
        </div>
      ))}
    </>
  );
}

function docName(scheme: CatalogScheme | undefined, en: string, lang: Lang) {
  return scheme?.documents.find((d) => d.en === en)?.[lang] ?? en;
}

export function ReadinessPage() {
  const { id } = useParams<{ id: string }>();
  return <Readiness key={id} schemeId={id} />;
}

function Readiness({ schemeId }: { schemeId: string }) {
  const { lang } = useLang();
  const router = useRouter();
  const catalog = useCatalog();
  const { me } = useMe();
  const [edits, setEdits] = useState<Record<string, FactValue | null>>({});
  const [docs, setDocs] = useState<string[] | null>(null);
  const [result, setResult] = useState<Readiness | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const scheme = catalog?.schemes.find((s) => s.id === schemeId);
  const usesProfile = !!me?.consent;

  // Recalculate whenever an answer or document changes (debounced; no LLM involved, so it's instant).
  useEffect(() => {
    if (me === undefined) return;
    const id = setTimeout(() => {
      setBusy(true);
      const facts: Record<string, FactValue | null> = usesProfile ? edits : { ...chatFacts(), ...edits };
      const documents = docs ?? (usesProfile ? undefined : (guestDocs() ?? undefined));
      fetch(`/api/schemes/${schemeId}/readiness`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ facts, documents }),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(String(res.status));
          setResult((await res.json()) as Readiness);
          setFailed(false);
        })
        .catch(() => setFailed(true))
        .finally(() => setBusy(false));
    }, 250);
    return () => clearTimeout(id);
  }, [schemeId, me, usesProfile, edits, docs]);

  const haveDocs = useMemo(() => new Set(docs ?? result?.documentsHave ?? []), [docs, result]);

  const toggleDoc = (name: string) => {
    const next = new Set(haveDocs);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    const list = [...next];
    setDocs(list);
    if (!usesProfile) {
      try {
        sessionStorage.setItem(GUEST_DOCS_KEY, JSON.stringify(list));
      } catch {}
    }
  };

  const known: Record<string, FactValue> = result?.known ?? {};
  const style = BAND_STYLE[result?.band ?? "missing_info"];

  return (
    <div className="min-h-dvh bg-slate-50">
      <SiteHeader me={me} />
      <main className="mx-auto max-w-5xl space-y-5 px-4 py-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Link href="/" className="text-sm text-emerald-700 hover:underline">
              {t("backToChat", lang)}
            </Link>
            <h1 className="mt-1 text-2xl font-bold text-slate-900">{t("readinessTitle", lang)}</h1>
            <p className="text-sm text-slate-600">{t("readinessIntro", lang)}</p>
          </div>
          <label className="text-sm">
            <span className="mr-2 text-slate-700">{t("chooseScheme", lang)}</span>
            <select
              value={schemeId}
              onChange={(e) => router.push(`/schemes/${e.target.value}`)}
              className="max-w-[16rem] rounded-lg border border-slate-300 bg-white px-3 py-2"
            >
              {catalog?.schemes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name[lang]}
                </option>
              ))}
            </select>
          </label>
        </div>

        {failed && !result && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{t("chatError", lang)}</p>}
        {!result && !failed && <p className="text-slate-600">{t("loading", lang)}</p>}

        {result && (
          <>
            {/* Score */}
            <section className={`flex flex-col gap-5 rounded-2xl border border-slate-200 p-5 shadow-sm sm:flex-row sm:items-center ${style.bg}`}>
              <Gauge score={result.score} band={result.band} />
              <div className="flex-1 space-y-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{scheme?.name[lang]}</h2>
                  <p className={`text-xl font-bold ${style.text}`}>{t(`band_${result.band}`, lang)}</p>
                  {busy && <p className="text-xs text-slate-500">{t("updating", lang)}</p>}
                </div>
                <Bar label={t("conditionsPart", lang)} value={result.points.conditions} max={60} />
                <Bar label={t("documentsPart", lang)} value={result.points.documents} max={30} />
                <Bar label={t("bankPart", lang)} value={result.points.bank} max={10} />
              </div>
            </section>

            {result.band === "not_eligible" && <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{t("notEligibleHelp", lang)}</p>}

            <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              {/* Comparison */}
              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <h2 className="border-b border-slate-200 px-4 py-3 font-semibold text-slate-900">{t("compareTitle", lang)}</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-2">{t("requirement", lang)}</th>
                        <th className="px-3 py-2">{personName(result.ideal.name, lang)}</th>
                        <th className="px-3 py-2">{t("you", lang)}</th>
                        <th className="px-3 py-2">{t("whatToDo", lang)}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 align-top">
                      {result.rows.map((row, i) => {
                        const facts = factsOf(row.options);
                        const [icon, action, tone] =
                          row.result === false
                            ? ["✗", t("doNotMet", lang), "text-rose-700"]
                            : row.result === true && !row.partial
                              ? ["✓", t("doMet", lang), "text-emerald-700"]
                              : row.partial
                                ? ["✓", t("doConfirm", lang), "text-amber-700"]
                                : ["?", t("doAnswer", lang), "text-slate-600"];
                        return (
                          <tr key={i}>
                            <td className="px-4 py-2.5 text-slate-800">
                              {row.options.length > 1 ? (
                                <>
                                  <div className="text-xs text-slate-500">{t("anyOneOf", lang)}</div>
                                  <ul className="list-inside list-disc">
                                    {row.options.map((opt, j) => (
                                      <li key={j}>{opt.map((l) => leafText(l, lang)).join(" + ")}</li>
                                    ))}
                                  </ul>
                                </>
                              ) : (
                                row.options[0]!.map((l, j) => <div key={j}>{leafText(l, lang)}</div>)
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-slate-700">
                              <Values facts={facts} values={result.ideal.facts} lang={lang} />
                            </td>
                            <td className="px-3 py-2.5 text-slate-900">
                              <Values facts={facts} values={known} lang={lang} />
                            </td>
                            <td className={`px-3 py-2.5 font-medium ${tone}`}>
                              {icon} {action}
                            </td>
                          </tr>
                        );
                      })}
                      <tr>
                        <td className="px-4 py-2.5 text-slate-800">{t("bankPart", lang)}</td>
                        <td className="px-3 py-2.5 text-slate-700">{t("yes", lang)}</td>
                        <td className="px-3 py-2.5 text-slate-900">{result.bank === "unknown" ? "?" : t(result.bank ? "yes" : "no", lang)}</td>
                        <td className={`px-3 py-2.5 font-medium ${result.bank === true ? "text-emerald-700" : "text-slate-600"}`}>
                          {result.bank === true ? `✓ ${t("doMet", lang)}` : `? ${t("doAnswer", lang)}`}
                        </td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5 text-slate-800">{t("documentsPart", lang)}</td>
                        <td className="px-3 py-2.5 text-slate-700">
                          {result.documents.length}/{result.documents.length}
                        </td>
                        <td className="px-3 py-2.5 text-slate-900">
                          {result.documents.filter((d) => d.have).length}/{result.documents.length}
                        </td>
                        <td className="px-3 py-2.5 font-medium text-slate-600">
                          {result.documents.every((d) => d.have) ? `✓ ${t("doMet", lang)}` : `☐ ${t("getDocument", lang)}`}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Ideal applicant */}
              <aside className="space-y-3 rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm">
                <h2 className="font-semibold text-slate-900">⭐ {t("idealApplicant", lang)}</h2>
                <div className="flex items-center gap-3">
                  <span aria-hidden className="grid h-12 w-12 place-items-center rounded-full bg-emerald-100 text-2xl">
                    {result.ideal.gender === "female" ? "👩" : "👨"}
                  </span>
                  <div>
                    <p className="text-lg font-semibold text-slate-900">{personName(result.ideal.name, lang)}</p>
                    <p className="text-sm text-slate-600">
                      {t("readinessTitle", lang)}: <span className="font-semibold text-emerald-700">{result.ideal.score}/100</span>
                    </p>
                  </div>
                </div>
                <p className="text-sm text-slate-600">{t("idealIntro", lang)}</p>
                <ul className="space-y-1 text-sm">
                  {Object.entries(result.ideal.facts).map(([f, v]) => (
                    <li key={f} className="flex justify-between gap-3 border-b border-slate-100 pb-1">
                      <span className="text-slate-600">{FACT_LABELS[f]?.[lang] ?? f}</span>
                      <span className="text-right font-medium text-slate-900">{formatFact(f, v, lang)}</span>
                    </li>
                  ))}
                  <li className="flex justify-between gap-3">
                    <span className="text-slate-600">{t("documentsPart", lang)}</span>
                    <span className="font-medium text-slate-900">✓ {t("allDocumentsReady", lang)}</span>
                  </li>
                </ul>
              </aside>
            </div>

            {/* Form + documents */}
            <div className="grid gap-5 lg:grid-cols-2">
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="font-semibold text-slate-900">{t("yourDetails", lang)}</h2>
                <p className="mt-1 text-xs text-slate-500">
                  {usesProfile ? t("savedToProfile", lang) : me ? t("turnOnSaving", lang) : t("notSavedGuest", lang)}
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {[...result.facts, ...(result.facts.includes("hasBankAccount") ? [] : ["hasBankAccount"])].map((f) => {
                    const def = catalog?.facts[f];
                    if (!def) return null;
                    const value = f in edits ? (edits[f] ?? undefined) : known[f];
                    return (
                      <label key={f} className="block text-sm">
                        <span className="text-slate-700">{FACT_LABELS[f]?.[lang] ?? f}</span>
                        <div className="mt-1">
                          <FactInput name={f} def={def} lang={lang} value={value} onChange={(v) => setEdits((e) => ({ ...e, [f]: v }))} />
                        </div>
                      </label>
                    );
                  })}
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="font-semibold text-slate-900">{t("documentsYouHave", lang)}</h2>
                <ul className="mt-3 space-y-2">
                  {result.documents.map((d) => (
                    <li key={d.name}>
                      <label className="flex items-start gap-3 text-sm">
                        <input type="checkbox" checked={haveDocs.has(d.name)} onChange={() => toggleDoc(d.name)} className="mt-0.5 h-5 w-5 accent-emerald-600" />
                        <span className={haveDocs.has(d.name) ? "text-slate-900" : "text-slate-700"}>{docName(scheme, d.name, lang)}</span>
                      </label>
                    </li>
                  ))}
                </ul>
                {scheme && (
                  <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
                    <p className="font-medium text-slate-900">{t("whereToApply", lang)}</p>
                    <p className="text-slate-700">{scheme.applyAtSpoken[lang]}</p>
                    <a href={scheme.source} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-emerald-700 hover:underline">
                      {t("officialSource", lang)} ↗
                    </a>
                  </div>
                )}
              </section>
            </div>

            <p className="text-xs text-slate-500">ⓘ {t("readinessDisclaimer", lang)}</p>
          </>
        )}
      </main>
    </div>
  );
}

