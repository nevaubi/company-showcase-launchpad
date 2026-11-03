import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { z } from "zod";
import { Download, Info } from "lucide-react";
import { StatementTable, statementToCsv } from "@/components/financials/statement-table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCompany } from "@/lib/data";
import type { StatementKey } from "@/lib/financials/types";
import { cn } from "@/lib/utils";

const search = z.object({
  statement: z.enum(["income", "balance", "cashflow", "kpis"]).default("income"),
  freq: z.enum(["annual", "quarterly"]).default("annual"),
  scale: z.enum(["M", "B"]).default("M"),
  span: z.enum(["10", "20", "all"]).default("10"),
  view: z.enum(["values", "yoy", "common"]).default("values"),
});

export const Route = createFileRoute("/_authenticated/app/companies/$ticker/financials")({
  validateSearch: search,
  component: Financials,
});

const STATEMENTS: { key: StatementKey; label: string }[] = [
  { key: "income", label: "Income statement" },
  { key: "balance", label: "Balance sheet" },
  { key: "cashflow", label: "Cash flow" },
  { key: "kpis", label: "Ratios & KPIs" },
];

function Seg<T extends string>({ value, options, onChange }: { value: T; options: { v: T; l: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-md border bg-secondary/50 p-0.5">
      {options.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={cn("rounded px-2.5 py-1 text-xs transition-colors", value === o.v ? "bg-card font-medium shadow-paper" : "text-muted-foreground hover:text-foreground")}
        >
          {o.l}
        </button>
      ))}
    </div>
  );
}

function Financials() {
  const { ticker: raw } = Route.useParams();
  const ticker = raw.toUpperCase();
  const s = Route.useSearch();
  const navigate = Route.useNavigate();
  const company = useCompany(ticker);
  const set = (patch: Partial<z.infer<typeof search>>) => navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });

  const filingsByAccn = useMemo(() => new Map((company.data?.filings ?? []).map((f) => [f.accn, f])), [company.data]);

  if (!company.data) return <Skeleton className="h-[600px]" />;
  const st = company.data.statements[s.freq][s.statement];
  const span = s.span === "all" ? undefined : s.freq === "quarterly" ? Number(s.span) * 1.2 : Number(s.span);

  const download = () => {
    const blob = new Blob([statementToCsv(st, s.scale)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${ticker}-${s.statement}-${s.freq}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const derivedCount = st.rows.reduce((n, r) => n + r.cells.filter((c) => c?.derived).length, 0);

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {STATEMENTS.map((x) => (
            <button
              key={x.key}
              onClick={() => set({ statement: x.key })}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition-colors",
                s.statement === x.key ? "bg-ink text-ink-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              {x.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Seg value={s.freq} onChange={(v) => set({ freq: v })} options={[{ v: "annual", l: "Annual" }, { v: "quarterly", l: "Quarterly" }]} />
          <Seg value={s.span} onChange={(v) => set({ span: v })} options={[{ v: "10", l: s.freq === "annual" ? "10Y" : "12Q" }, { v: "20", l: s.freq === "annual" ? "20Y" : "24Q" }, { v: "all", l: "All" }]} />
          {s.statement !== "kpis" && (
            <Seg value={s.view} onChange={(v) => set({ view: v })} options={[{ v: "values", l: "Values" }, { v: "yoy", l: "YoY %" }, { v: "common", l: s.statement === "balance" ? "% assets" : "% revenue" }]} />
          )}
          <Seg value={s.scale} onChange={(v) => set({ scale: v })} options={[{ v: "M", l: "$M" }, { v: "B", l: "$B" }]} />
          <Button size="sm" variant="outline" onClick={download}>
            <Download /> CSV
          </Button>
        </div>
      </div>

      <StatementTable statement={st} ticker={ticker} scale={s.scale} maxPeriods={span ? Math.round(span) : undefined} filingsByAccn={filingsByAccn} view={s.statement === "kpis" ? "values" : s.view} lag={s.freq === "quarterly" ? 4 : 1} />

      <div className="flex flex-wrap items-start gap-x-6 gap-y-2 text-xs text-muted-foreground">
        <p className="flex items-center gap-1.5">
          <Info className="size-3.5" /> Click any value to open the SEC filing it was reported in, scrolled to the tagged fact.
        </p>
        <p className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-chart-2" /> <em>Italic</em> values are calculated ({derivedCount} in this view) — e.g. fourth quarters
          (annual − nine-month YTD) and discrete quarterly cash flows; the panel lists every component.
        </p>
        <p>Negative values in parentheses. Reported values use the latest filing that disclosed the period.</p>
      </div>
    </div>
  );
}
