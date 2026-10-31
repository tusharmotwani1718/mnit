"use client";

import { t } from "@/lib/i18n";
import { useLang } from "@/lib/lang";
import type { Catalog, SchemeResult } from "@/lib/types";

const ORDER = { eligible: 0, likely_eligible: 1 } as Record<string, number>;

/** One card per scheme the rules say the user qualifies for (or may qualify for), with what to do next. */
export function SchemeResults({ results, catalog }: { results: SchemeResult[] | null; catalog: Catalog | null }) {
  const { lang } = useLang();
  const matches = (results ?? []).filter((r) => r.status in ORDER).sort((a, b) => ORDER[a.status]! - ORDER[b.status]!);
  const pending = (results ?? []).filter((r) => r.status === "need_more_info").length;
  const byId = new Map(catalog?.schemes.map((s) => [s.id, s]));

  return (
    <section aria-labelledby="schemes-heading" className="space-y-3">
      <div>
        <h2 id="schemes-heading" className="text-lg font-semibold text-slate-900">
          {t("yourSchemes", lang)}
          {matches.length > 0 && <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-sm text-emerald-800">{matches.length}</span>}
        </h2>
        <p className="text-xs text-slate-500">{t("rulesNotAi", lang)}</p>
      </div>

      {matches.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-600">{t("schemesEmpty", lang)}</p>
      )}

      {matches.map((r) => {
        const s = byId.get(r.schemeId);
        if (!s) return null;
        const eligible = r.status === "eligible";
        return (
          <article key={r.schemeId} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="font-semibold leading-snug text-slate-900">{s.name[lang]}</h3>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${eligible ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}
              >
                {eligible ? `✓ ${t("eligible", lang)}` : t("likely", lang)}
              </span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-slate-700">{s.benefitSummary[lang]}</p>

            <dl className="mt-3 space-y-2 text-sm">
              <div>
                <dt className="font-medium text-slate-900">{t("documents", lang)}</dt>
                <dd>
                  <ul className="mt-1 list-inside list-disc text-slate-700">
                    {s.documents.map((d) => (
                      <li key={d.en}>{d[lang]}</li>
                    ))}
                  </ul>
                </dd>
              </div>
              <div>
                <dt className="font-medium text-slate-900">{t("whereToApply", lang)}</dt>
                <dd className="text-slate-700">{s.applyAtSpoken[lang]}</dd>
              </div>
              {s.helpline && (
                <div>
                  <dt className="font-medium text-slate-900">{t("helpline", lang)}</dt>
                  <dd className="text-slate-700">{s.helpline}</dd>
                </div>
              )}
            </dl>

            {r.caveats.length > 0 && (
              <div className="mt-3 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900">
                <span className="font-semibold">{t("note", lang)}: </span>
                {r.caveats.map((c) => c[lang]).join(" ")}
              </div>
            )}

            <p className="mt-3 text-xs text-slate-500">
              <a href={s.source} target="_blank" rel="noreferrer" className="font-medium text-emerald-700 hover:underline">
                {t("officialSource", lang)} ↗
              </a>
              {s.lastVerified && (
                <>
                  {" "}
                  · {t("verifiedOn", lang)} {s.lastVerified}
                </>
              )}
            </p>
          </article>
        );
      })}

      {pending > 0 && matches.length > 0 && (
        <p className="text-xs text-slate-500">
          +{pending} {t("stillChecking", lang)}
        </p>
      )}
    </section>
  );
}
