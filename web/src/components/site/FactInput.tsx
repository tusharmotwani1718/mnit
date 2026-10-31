"use client";

import { HECTARES_PER_ACRE, t, VALUE_LABELS } from "@/lib/i18n";
import type { CatalogFact, Lang } from "@/lib/types";

export type FactValue = string | number | boolean;

/** One answer: yes/no, a choice, or a number (land in acres, stored in hectares). */
export function FactInput({
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
