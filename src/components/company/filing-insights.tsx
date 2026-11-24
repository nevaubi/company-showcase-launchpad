import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Panel } from "@/components/app/page-header";
import { useSource } from "@/components/source/source-context";
import { filingInsightsQuery, type FilingInsight } from "@/lib/insights/filing";
import { fmtDate, fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

const TYPE_LABEL: Record<string, string> = {
  guidance: "Guidance",
  risk: "Risk",
  customer_supplier: "Customers & suppliers",
  accounting: "Accounting",
  litigation: "Litigation",
  capital_allocation: "Capital allocation",
  kpi: "KPI",
  regulation: "Regulation",
  operations: "Operations",
  other: "Other",
};
const PART_LABEL: Record<string, string> = {
  impact: "model impact",
  type: "type",
  novelty: "novelty",
  size: "size vs revenue",
  redline: "extent of the change",
  section: "key section",
};

const fmtStake = (s: FilingInsight["stake"]) => {
  if (!s || s.value == null) return null;
  if (s.unit === "percent") return `${s.value}%`;
  const a = Math.abs(s.value);
  return a >= 1e9
    ? `$${(s.value / 1e9).toFixed(2)}B`
    : a >= 1e6
      ? `$${(s.value / 1e6).toFixed(0)}M`
      : `$${s.value.toLocaleString()}`;
};

/** Ranked, verified insights from what changed in the latest 10-K or 10-Q; each opens the filing at its quote. */
export function FilingInsightsPanel({ ticker }: { ticker: string }) {
  const q = useQuery(filingInsightsQuery(ticker));
  const { open } = useSource();
  const [all, setAll] = useState(false);
  const f = q.data;
  if (!f || !f.insights.length) return null;
  const shown = all ? f.insights : f.insights.slice(0, 5);
  const openIt = (i: FilingInsight) => {
    const ref = i.doc === "old" ? f.compared_to : f.filing;
    open({
      ticker,
      label: i.title,
      periodLabel: `${ref.form} filed ${ref.filed}`,
      unit: i.stake?.unit === "percent" ? "pct" : "USD",
      value: i.stake?.value ?? 0,
      doc: {
        accn: ref.accn,
        doc: ref.doc,
        form: ref.form,
        filed: ref.filed,
        title: `${ref.form} filed ${fmtDate(ref.filed)}${i.doc === "old" ? " (the earlier filing; this passage was removed)" : ""}`,
        search: i.quote.split(/\s+/).slice(0, 12).join(" "),
      },
    });
  };
  return (
    <Panel
      title={`What changed in the ${f.filing.form}`}
      subtitle={`${f.filing.form} filed ${fmtDate(f.filing.filed)} against the ${f.compared_to.form} filed ${fmtDate(f.compared_to.filed)} · ranked by materiality · ${f.label}, ${fmtRelative(f.generated)}`}
      collapse={false}
      bodyClassName="p-0"
    >
      <ol className="divide-y">
        {shown.map((i) => (
          <li key={i.id} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2 px-3.5 py-2.5">
            <span className="num pt-0.5 text-[11px] text-muted-foreground">{i.rank}</span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => openIt(i)}
                  className="text-left text-[13px] font-medium hover:underline"
                >
                  {i.title}
                </button>
                <span className="rounded bg-secondary px-1.5 py-px text-[10.5px] text-muted-foreground">
                  {TYPE_LABEL[i.type] ?? i.type}
                </span>
                <span
                  className={cn(
                    "rounded px-1.5 py-px text-[10.5px]",
                    i.direction === "positive" && "bg-positive/10 text-positive",
                    i.direction === "negative" && "bg-negative/10 text-negative",
                    (i.direction === "mixed" || i.direction === "neutral") &&
                      "bg-secondary text-muted-foreground",
                  )}
                >
                  {i.direction}
                </span>
                <span className="text-[10.5px] text-muted-foreground">
                  {i.novelty === "new"
                    ? "new disclosure"
                    : i.novelty === "removed"
                      ? "removed"
                      : "reworded"}
                </span>
                {fmtStake(i.stake) && (
                  <span className="num text-[11px] font-medium">{fmtStake(i.stake)}</span>
                )}
              </div>
              <p className="mt-0.5 text-[12.5px] text-foreground/90">{i.text}</p>
              <button
                type="button"
                onClick={() => openIt(i)}
                className="mt-1 block w-full border-l-2 pl-2 text-left text-[11.5px] text-muted-foreground italic hover:border-foreground/40 hover:text-foreground"
              >
                “{i.quote}”<span className="ml-1 not-italic">· {i.section}</span>
              </button>
              <p className="mt-0.5 text-[10.5px] text-muted-foreground" title={i.check?.reason}>
                Score {i.score.toFixed(0)}:{" "}
                {Object.entries(i.score_parts)
                  .map(([k, v]) => `${PART_LABEL[k] ?? k} ${v}`)
                  .join(", ")}
              </p>
            </div>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-3 border-t px-3.5 py-2 text-[11px] text-muted-foreground">
        {f.insights.length > 5 && (
          <button
            type="button"
            className="text-link hover:underline"
            onClick={() => setAll((v) => !v)}
          >
            {all ? "Show top 5" : `Show all ${f.insights.length}`}
          </button>
        )}
        <span>
          {f.proposed} proposed, {f.insights.length} kept. Rejected:{" "}
          {Object.entries(f.rejected)
            .filter(([, v]) => v)
            .map(([k, v]) => `${v} ${k}`)
            .join(", ") || "none"}
          . {f.method} Drafted by one model and{" "}
          <span title={`Drafted by ${f.models.draft}; checked by ${f.models.check}`} className="underline decoration-dotted underline-offset-2">checked by a second</span>.
        </span>
      </div>
    </Panel>
  );
}
