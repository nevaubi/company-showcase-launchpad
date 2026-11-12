import { useFeatureGate } from "@/hooks/use-plan";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { z } from "zod";
import { Download, FileSpreadsheet, Info, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { StatementTable, statementToCsv, type StatementView } from "@/components/financials/statement-table";
import { StatementChart } from "@/components/financials/statement-chart";
import { AsReported } from "@/components/financials/as-reported";
import { IndustryTemplate } from "@/components/financials/industry-template";
import { AdjustedView } from "@/components/financials/adjusted-view";
import { ScaleToggle } from "@/components/financials/scale-toggle";
import { Segmented } from "@/components/app/segmented";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCompany } from "@/lib/data";
import { useUnitScale } from "@/hooks/use-preference";
import { scaleCaption } from "@/lib/format";
import { hasSplitRestatement } from "@/lib/financials/splits";
import type { StatementKey } from "@/lib/financials/types";
import { cn } from "@/lib/utils";
import wordmark from "@/assets/brand/wordmark.png.asset.json";

const pageSearch = z.object({
  basis: z.enum(["normalized", "reported", "template", "adjusted"]).default("normalized"),
  statement: z.enum(["income", "balance", "cashflow", "kpis"]).default("income"),
  freq: z.enum(["annual", "quarterly"]).default("annual"),
  span: z.enum(["10", "20", "all"]).default("10"),
  view: z.enum(["values", "yoy", "common"]).default("values"),
});

export const Route = createFileRoute("/_authenticated/app/companies/$ticker/financials")({
  head: ({ params }) => ({ meta: [
    { title: `${params.ticker.toUpperCase()} Financial statements — Filed Under` },
    { name: "description", content: `Annual and quarterly SEC income statements, balance sheets, cash flows and ratios with exact filing sources. Company: ${params.ticker.toUpperCase()}.` },
    { property: "og:title", content: `${params.ticker.toUpperCase()} Financial statements — Filed Under` },
    { property: "og:description", content: "Annual and quarterly SEC income statements, balance sheets, cash flows and ratios with exact filing sources." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  validateSearch: pageSearch,
  component: Financials,
});

const STATEMENTS: { key: StatementKey; label: string }[] = [
  { key: "income", label: "Income statement" },
  { key: "balance", label: "Balance sheet" },
  { key: "cashflow", label: "Cash flow" },
  { key: "kpis", label: "Ratios & KPIs" },
];

const DEFAULT_CHART: Record<StatementKey, string[]> = {
  income: ["revenue", "operatingIncome", "netIncome"],
  balance: ["totalAssets", "totalLiabilities", "equity"],
  cashflow: ["cfo", "capex", "fcf"],
  kpis: ["grossMargin", "operatingMargin", "netMargin"],
};

function Financials() {
  const { ticker: raw } = Route.useParams();
  const ticker = raw.toUpperCase();
  const s = Route.useSearch();
  const navigate = Route.useNavigate();
  const company = useCompany(ticker);
  const [scale] = useUnitScale();
  const [charted, setCharted] = useState<Partial<Record<StatementKey, string[]>>>({});
  const [chartOpen, setChartOpen] = useState(true);
  const [exporting, setExporting] = useState(false);
  const gate = useFeatureGate();
  const set = (patch: Partial<z.infer<typeof pageSearch>>) => navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });

  const filingsByAccn = useMemo(() => new Map((company.data?.filings ?? []).map((f) => [f.accn, f])), [company.data]);

  const basisBar = (
    <Segmented
      label="Statement basis"
      value={s.basis}
      onChange={(v) => set({ basis: v })}
      options={[
        { v: "normalized", l: "Normalized", title: "One consistent set of lines across years, every value sourced to its filing" },
        { v: "reported", l: "As reported", title: "Each filing's statements exactly as filed: its labels, order, signs and rounding" },
        { v: "template", l: "Industry template", title: "Filings mapped onto industrial, bank, insurer, REIT or utility templates" },
        { v: "adjusted", l: "Adjusted", title: "The company's non-GAAP measures beside GAAP" },
      ]}
    />
  );
  if (s.basis !== "normalized")
    return (
      <div className="grid grid-cols-1 gap-4">
        <div className="flex flex-wrap items-center gap-2">{basisBar}</div>
        {s.basis === "reported" ? <AsReported ticker={ticker} /> : s.basis === "template" ? <IndustryTemplate ticker={ticker} /> : <AdjustedView ticker={ticker} />}
      </div>
    );

  if (company.isError)
    return <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">Could not load {ticker}'s statements. Refresh to try again.</p>;
  if (!company.data) return <Skeleton className="h-[600px]" />;
  const st = company.data.statements[s.freq][s.statement];
  const span = s.span === "all" ? undefined : Math.round(s.freq === "quarterly" ? Number(s.span) * 1.2 : Number(s.span));
  const available = new Set(st.rows.map((r) => r.key));
  const keys = (charted[s.statement] ?? DEFAULT_CHART[s.statement]).filter((k) => available.has(k));
  const toggle = (key: string) => {
    const cur = keys;
    const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key].slice(-4);
    setCharted((c) => ({ ...c, [s.statement]: next }));
    setChartOpen(true);
  };

  const download = () => {
    if (!gate("exports")) return;
    const blob = new Blob([statementToCsv(st, scale)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${ticker}-${s.statement}-${s.freq}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const workbook = async () => {
    setExporting(true);
    try {
      const { exportWorkbook } = await import("@/lib/export/xlsx");
      await exportWorkbook(company.data!, s.freq, scale, span, wordmark.url);
      toast.success("Excel model downloaded", { description: "Cover sheet, four styled statements with live formulas, and a Sources sheet linking every number to SEC.gov." });
    } catch (e) {
      console.error(e);
      toast.error("Could not build the workbook", { description: (e as Error).message });
    } finally {
      setExporting(false);
    }
  };

  const derivedCount = st.rows.reduce((n, r) => n + r.cells.filter((c) => c?.derived).length, 0);
  const view: StatementView = s.statement === "kpis" ? "values" : s.view;

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-center gap-2">{basisBar}</div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1 scrollbar-thin">
          {STATEMENTS.map((x) => (
            <button
              key={x.key}
              onClick={() => set({ statement: x.key })}
              className={cn(
                "shrink-0 rounded-md px-3 py-1.5 text-sm transition-colors",
                s.statement === x.key ? "bg-ink text-ink-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              {x.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
          <Segmented label="Frequency" value={s.freq} onChange={(v) => set({ freq: v })} options={[{ v: "annual", l: "Annual" }, { v: "quarterly", l: "Quarterly" }]} />
          <Segmented
            label="Periods"
            value={s.span}
            onChange={(v) => set({ span: v })}
            options={[
              { v: "10", l: s.freq === "annual" ? "10Y" : "12Q" },
              { v: "20", l: s.freq === "annual" ? "20Y" : "24Q" },
              { v: "all", l: "All" },
            ]}
          />
          {s.statement !== "kpis" && (
            <Segmented
              label="View"
              value={s.view}
              onChange={(v) => set({ view: v })}
              options={[
                { v: "values", l: "Values" },
                { v: "yoy", l: "YoY %", title: "Year-over-year change under each value, shaded by size" },
                { v: "common", l: s.statement === "balance" ? "% assets" : "% revenue", title: "Common-size: each line as a share of the base line" },
              ]}
            />
          )}
          <ScaleToggle />
          <Button size="sm" variant="outline" onClick={download}>
            <Download /> CSV
          </Button>
          <Button size="sm" variant="ink" onClick={workbook} disabled={exporting}>
            {exporting ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />} Excel model
          </Button>
        </div>
      </div>

      {keys.length > 0 && chartOpen ? (
        <StatementChart statement={st} keys={keys} ticker={ticker} scale={scale} maxPeriods={span} onRemove={toggle} />
      ) : (
        <button onClick={() => setChartOpen(true)} className="rounded-lg border border-dashed bg-card/60 px-4 py-3 text-left text-xs text-muted-foreground hover:bg-card">
          Use the chart icon beside any line to plot it here.
        </button>
      )}

      <StatementTable
        statement={st}
        ticker={ticker}
        scale={scale}
        maxPeriods={span}
        filingsByAccn={filingsByAccn}
        view={view}
        lag={s.freq === "quarterly" ? 4 : 1}
        freq={s.freq}
        charted={keys}
        onToggleChart={toggle}
      />

      <div className="flex flex-wrap items-start gap-x-6 gap-y-2 text-xs text-muted-foreground">
        <p className="flex items-center gap-1.5">
          <Info className="size-3.5" /> Click any value to open the SEC filing it was reported in, scrolled to the tagged fact.
        </p>
        <p className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-chart-2" /> <em>Italic</em> values are calculated ({derivedCount} in this view) — e.g. fourth quarters
          (annual − nine-month YTD), EBITDA, total debt; the panel lists every component.
        </p>
        <p>
          Values in {scaleCaption(scale)}. Negatives in parentheses. Reported values use the latest filing that disclosed the period.
        </p>
        {hasSplitRestatement(st) && (
          <p>
            Per-share figures and share counts are restated to today's share basis for stock splits, so every year compares like for like. Click one to see the figure as filed.
          </p>
        )}
      </div>
    </div>
  );
}
