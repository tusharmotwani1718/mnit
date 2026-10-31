import { describeCondition, formatValue, humanize, STATUS } from "@/lib/format";
import type { Lang, LeafTrace, Meta, SchemeResult } from "@/lib/types";

type FactLeaf = Extract<LeafTrace, { fact: string }>;

const MARK = {
  true: { icon: "✓", cls: "text-emerald-700" },
  false: { icon: "✗", cls: "text-rose-700" },
  unknown: { icon: "?", cls: "text-sky-700" },
} as const;

function Condition({ leaf }: { leaf: FactLeaf }) {
  const mark = MARK[String(leaf.result) as keyof typeof MARK];
  return (
    <li className="flex items-baseline gap-2">
      <span className={`w-4 shrink-0 text-center font-bold ${mark.cls}`}>{mark.icon}</span>
      <span>
        {describeCondition(leaf)}
        {leaf.assumed ? (
          <span className="ml-1 text-xs text-amber-700">(assumed, caveat attached)</span>
        ) : leaf.actual !== undefined ? (
          <span className="ml-1 text-xs text-slate-500">({formatValue(leaf.actual)})</span>
        ) : null}
      </span>
    </li>
  );
}

export function SchemeCard({
  result,
  scheme,
  lang,
}: {
  result: SchemeResult;
  scheme: Meta["schemes"][number] | undefined;
  lang: Lang;
}) {
  const status = STATUS[result.status];
  const leaves = result.trace.filter((l): l is FactLeaf => "fact" in l);
  // Not eligible: only the conditions that failed explain the result.
  const shown = result.status === "not_eligible" ? leaves.filter((l) => l.result === false) : leaves;

  return (
    <article className={`flex flex-col gap-2 rounded-xl border p-3 text-sm ${status.card}`}>
      <header className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold leading-tight text-slate-900">{scheme?.name.en ?? result.schemeId}</h3>
          {scheme && lang !== "en" && <p className="text-xs text-slate-600">{scheme.name[lang]}</p>}
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${status.badge}`}>{status.label}</span>
      </header>

      {shown.length > 0 && <ul className="space-y-0.5 text-slate-800">{shown.map((l, i) => <Condition key={i} leaf={l} />)}</ul>}

      {result.status === "need_more_info" && result.missingFacts.length > 0 && (
        <p className="text-xs text-sky-800">Waiting for: {result.missingFacts.map(humanize).join(", ")}</p>
      )}

      {result.status !== "not_eligible" && result.manualChecks.length > 0 && (
        <p className="text-xs text-amber-800">
          <span className="font-medium">Checked at CSC:</span> {result.manualChecks[0]}
        </p>
      )}

      {result.caveats.length > 0 && (
        <ul className="list-disc pl-4 text-xs text-amber-800">
          {result.caveats.map((c, i) => (
            <li key={i}>{c.en}</li>
          ))}
        </ul>
      )}

      {scheme && (
        <footer className="mt-auto pt-1 text-xs text-slate-500">
          <a href={scheme.source} target="_blank" rel="noreferrer" className="underline hover:text-slate-700">
            Official source
          </a>
          {scheme.lastVerified && <> · rule verified {scheme.lastVerified}</>}
          {scheme.state && <> · {scheme.state} state scheme</>}
        </footer>
      )}
    </article>
  );
}
