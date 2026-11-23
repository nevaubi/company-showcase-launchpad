import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { IrPanel } from "@/components/ir/panel";
import { IR } from "@/components/ir/typography";
import { Button } from "@/components/ui/button";
import { useSource } from "@/components/source/source-context";
import { supabase } from "@/integrations/supabase/client";
import type { Filing } from "@/lib/financials/types";
import { filingInsightsQuery, type FilingInsight } from "@/lib/insights/filing";
import { fmtDate, fmtRelative } from "@/lib/format";
import { REDLINE_VERSION, type SectionStats } from "@/lib/redline/core";
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

interface RedlineRow {
  form: string;
  from_accn: string;
  to_accn: string;
  to_filed: string;
  high: number;
  medium: number;
  stats: SectionStats[] | null;
}

/** The newest stored comparison of two filings of the same form: counts only, never the full text. */
const latestRedlineQuery = (ticker: string) => ({
  queryKey: ["filing-redline-latest", ticker],
  staleTime: 30 * 60_000,
  retry: 1,
  queryFn: async (): Promise<RedlineRow | null> => {
    const { data, error } = await supabase.from("filing_redlines").select("form, from_accn, to_accn, to_filed, high, medium, stats").eq("ticker", ticker).eq("version", REDLINE_VERSION).order("to_filed", { ascending: false }).limit(1);
    if (error) throw new Error(error.message);
    return ((data ?? [])[0] as unknown as RedlineRow | undefined) ?? null;
  },
});

/** How much the latest 10-K or 10-Q changed against the one before: rule-rated paragraph changes, by section. */
function ChangeScore({ ticker, row, filings }: { ticker: string; row: RedlineRow; filings: Filing[] }) {
  const before = filings.find((f) => f.accn === row.from_accn);
  const sections = (row.stats ?? [])
    .filter((x) => x.high + x.medium > 0)
    .sort((a, b) => b.high - a.high || b.medium - a.medium)
    .slice(0, 4);
  const words = (row.stats ?? []).reduce((t, x) => ({ added: t.added + x.wordsAdded, removed: t.removed + x.wordsRemoved }), { added: 0, removed: 0 });
  const search = { form: row.form as "10-K" | "10-Q", to: row.to_accn, from: row.from_accn };
  return (
    <div data-section="Filing change score" className="grid grid-cols-1 gap-x-6 gap-y-2 px-4 py-3 md:grid-cols-[auto_minmax(0,1fr)]">
      <div>
        <p className={IR.caption}>Filing change score</p>
        <p className="mt-0.5 flex items-baseline gap-3">
          <span>
            <span className={IR.stat}>{row.high}</span> <span className={IR.caption}>high</span>
          </span>
          <span>
            <span className={IR.stat}>{row.medium}</span> <span className={IR.caption}>medium</span>
          </span>
        </p>
        <p className={IR.caption}>
          rated changes · {words.added.toLocaleString("en-US")} words added, {words.removed.toLocaleString("en-US")} removed
        </p>
      </div>
      <div className="min-w-0">
        <p className="text-[13px] leading-5">
          {row.form} filed {fmtDate(row.to_filed)} against the {row.form}
          {before ? ` filed ${fmtDate(before.filed)}` : " before it"}. Each changed paragraph is rated by fixed rules (what was added or removed, where, and which terms it touches); no model rates it.
        </p>
        {sections.length > 0 && (
          <p className={cn("mt-1 flex flex-wrap gap-x-4 gap-y-0.5", IR.caption)}>
            Most rated changes:
            {sections.map((x) => (
              <Link key={x.key} to="/app/companies/$ticker/redline" params={{ ticker }} search={{ ...search, section: x.key }} className="text-link hover:underline">
                {x.title} ({x.high} high, {x.medium} medium)
              </Link>
            ))}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * What changed in the latest filings: the change score of the newest stored comparison, then the ranked, verified
 * insights from the latest 10-K or 10-Q, each opening the filing at its quote. All of it is on the page.
 */
export function FilingChangesPanel({ ticker, filings }: { ticker: string; filings: Filing[] }) {
  const q = useQuery(filingInsightsQuery(ticker));
  const redline = useQuery(latestRedlineQuery(ticker));
  const { open } = useSource();
  const f = q.data && q.data.insights.length ? q.data : null;
  const row = redline.data ?? null;
  if (!f && !row) return null;
  const openIt = (i: FilingInsight) => {
    if (!f) return;
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
    <IrPanel
      section="Filing changes"
      title="What changed in the filings"
      subtitle={row ? `Newest comparison: ${row.form} filed ${fmtDate(row.to_filed)}` : f ? `${f.filing.form} filed ${fmtDate(f.filing.filed)}` : undefined}
      bodyClassName="p-0"
      actions={
        <Button size="xs" variant="ghost" asChild>
          <Link to="/app/companies/$ticker/redline" params={{ ticker }} search={row ? { form: row.form as "10-K" | "10-Q", to: row.to_accn, from: row.from_accn } : {}}>
            Open the redline
          </Link>
        </Button>
      }
    >
      {row && <ChangeScore ticker={ticker} row={row} filings={filings} />}
      {f && (
        <>
          <p className={cn("border-t px-4 py-2", IR.caption)}>
            Ranked insights from the {f.filing.form} filed {fmtDate(f.filing.filed)} against the {f.compared_to.form} filed {fmtDate(f.compared_to.filed)} · {f.label}, {fmtRelative(f.generated)}
          </p>
          <ol className="divide-y divide-border/60 border-t border-border/60">
            {f.insights.map((i) => (
              <li key={i.id} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2 px-4 py-2">
                <span className="num pt-0.5 text-[11px] text-muted-foreground">{i.rank}</span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button type="button" onClick={() => openIt(i)} className="text-left text-[13px] font-medium hover:underline">
                      {i.title}
                    </button>
                    <span className="rounded bg-secondary px-1.5 py-px text-[11px] text-muted-foreground">{TYPE_LABEL[i.type] ?? i.type}</span>
                    <span
                      className={cn(
                        "rounded px-1.5 py-px text-[11px]",
                        i.direction === "positive" && "bg-positive/10 text-positive",
                        i.direction === "negative" && "bg-negative/10 text-negative",
                        (i.direction === "mixed" || i.direction === "neutral") && "bg-secondary text-muted-foreground",
                      )}
                    >
                      {i.direction}
                    </span>
                    <span className="text-[11px] text-muted-foreground">{i.novelty === "new" ? "new disclosure" : i.novelty === "removed" ? "removed" : "reworded"}</span>
                    {fmtStake(i.stake) && <span className="num text-[11px] font-medium">{fmtStake(i.stake)}</span>}
                  </div>
                  <p className="mt-0.5 text-[13px] leading-5 text-foreground/90">{i.text}</p>
                  <button type="button" onClick={() => openIt(i)} className="mt-1 block w-full border-l-2 pl-2 text-left text-[11px] leading-4 text-muted-foreground italic hover:border-foreground/40 hover:text-foreground">
                    “{i.quote}”<span className="ml-1 not-italic">· {i.section}</span>
                  </button>
                  <p className="mt-0.5 text-[11px] text-muted-foreground" title={i.check?.reason}>
                    Score {i.score.toFixed(0)}:{" "}
                    {Object.entries(i.score_parts)
                      .map(([k, v]) => `${PART_LABEL[k] ?? k} ${v}`)
                      .join(", ")}
                  </p>
                </div>
              </li>
            ))}
          </ol>
          <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">
            {f.proposed} proposed, {f.insights.length} kept. Rejected:{" "}
            {Object.entries(f.rejected)
              .filter(([, v]) => v)
              .map(([k, v]) => `${v} ${k}`)
              .join(", ") || "none"}
            . {f.method} Drafted by one model and{" "}
            <span title={`Drafted by ${f.models.draft}; checked by ${f.models.check}`} className="underline decoration-dotted underline-offset-2">
              checked by a second
            </span>
            .
          </p>
        </>
      )}
    </IrPanel>
  );
}
