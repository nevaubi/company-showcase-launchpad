import { useMemo } from "react";
import { ComboChart, type ComboSeries } from "@/components/charts/combo-chart";
import { Panel } from "@/components/app/page-header";
import { useSource } from "@/components/source/source-context";
import type { Cell, CompanyDataset, Statement } from "@/lib/financials/types";
import { restateShares } from "@/lib/financials/valuation";
import { fmtCompactUsd, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";

const USES = [
  { key: "capex", label: "Capex", color: "var(--chart-1)" },
  { key: "acquisitions", label: "Acquisitions", color: "var(--chart-4)" },
  { key: "buybacks", label: "Buybacks", color: "var(--chart-2)" },
  { key: "dividends", label: "Dividends", color: "var(--chart-3)" },
] as const;

const rowOf = (st: Statement, key: string) => st.rows.find((r) => r.key === key);

/** Where operating cash went each year — reinvestment vs. shareholder returns — with net debt alongside. */
export function CapitalAllocation({ data, ticker, years = 10, className }: { data: CompanyDataset; ticker: string; years?: number; className?: string }) {
  const { open } = useSource();
  const a = data.statements.annual;
  const model = useMemo(() => {
    const n = a.cashflow.periods.length;
    const start = Math.max(0, n - years);
    const periods = a.cashflow.periods.slice(start);
    const pick = (st: Statement, key: string) => (rowOf(st, key)?.cells ?? []).slice(start);
    const cfo = pick(a.cashflow, "cfo");
    const uses = USES.map((u) => ({ ...u, cells: pick(a.cashflow, u.key) })).filter((u) => u.cells.some((c) => c && c.v !== 0));
    // Balance-sheet periods can differ from cash-flow periods; align by period key.
    const bIdx = new Map(a.balance.periods.map((p, i) => [p.key, i]));
    const nd = rowOf(a.balance, "netDebt");
    const netDebt = periods.map((p) => {
      const i = bIdx.get(p.key);
      return i == null ? null : (nd?.cells[i] ?? null);
    });
    const sharesRaw = restateShares((rowOf(a.income, "sharesDiluted")?.cells ?? []).map((c) => c?.v ?? null));
    const iIdx = new Map(a.income.periods.map((p, i) => [p.key, i]));
    const shares = periods.map((p) => {
      const i = iIdx.get(p.key);
      return i == null ? null : sharesRaw[i];
    });
    const total = (cells: (Cell | null)[]) => cells.reduce((s, c) => s + Math.abs(c?.v ?? 0), 0);
    const cfoTotal = cfo.reduce((s, c) => s + (c?.v ?? 0), 0);
    const firstShares = shares.find((v) => v != null);
    const lastShares = [...shares].reverse().find((v) => v != null);
    return {
      periods,
      cfo,
      uses,
      netDebt,
      cfoTotal,
      totals: uses.map((u) => ({ ...u, total: total(u.cells) })),
      shareChange: firstShares && lastShares ? lastShares / firstShares - 1 : null,
    };
  }, [a, years]);

  if (!model.periods.length || !model.cfo.some(Boolean)) return null;

  const openCell = (label: string, i: number, cell: Cell | null | undefined) => {
    if (!cell) return;
    open({ ticker, label, periodLabel: model.periods[i].label, unit: "usd", value: cell.v, src: cell.src, alts: cell.alts, derived: cell.derived, approx: cell.approx });
  };

  const series: ComboSeries[] = [
    ...model.uses.map((u) => ({
      id: u.key,
      label: u.label,
      color: u.color,
      type: "bar" as const,
      values: u.cells.map((c) => (c ? Math.abs(c.v) : null)),
      format: (v: number) => fmtCompactUsd(v),
      onSelect: (i: number) => openCell(u.label, i, u.cells[i]),
    })),
    {
      id: "cfo",
      label: "Cash from operations",
      color: "var(--foreground)",
      type: "line",
      values: model.cfo.map((c) => c?.v ?? null),
      format: (v) => fmtCompactUsd(v),
      onSelect: (i) => openCell("Cash from operations", i, model.cfo[i]),
    },
    ...(model.netDebt.some(Boolean)
      ? [
          {
            id: "netDebt",
            label: "Net debt (cash)",
            color: "var(--chart-5)",
            type: "line" as const,
            dashed: true,
            values: model.netDebt.map((c) => c?.v ?? null),
            format: (v: number) => fmtCompactUsd(v),
            onSelect: (i: number) => openCell("Net debt (cash)", i, model.netDebt[i]),
          },
        ]
      : []),
  ];

  const returned = model.totals.filter((t) => t.key === "buybacks" || t.key === "dividends").reduce((s, t) => s + t.total, 0);
  const reinvested = model.totals.filter((t) => t.key === "capex" || t.key === "acquisitions").reduce((s, t) => s + t.total, 0);
  const span = `FY${model.periods[0].fy}–FY${model.periods.at(-1)!.fy}`;

  return (
    <Panel
      className={className}
      title="Capital allocation"
      subtitle={`Uses of cash each fiscal year, ${span} · click a bar or point for its SEC source`}
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="min-w-0">
          <ComboChart categories={model.periods.map((p) => `FY${String(p.fy).slice(2)}`)} series={series} stacked height={260} leftFormat={(v) => fmtCompactUsd(v, 0)} />
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            {series.map((s) => (
              <span key={s.id} className="flex items-center gap-1.5">
                <span className={cn("inline-block", s.type === "bar" ? "size-2 rounded-sm" : "h-0.5 w-3")} style={{ background: s.color }} />
                {s.label}
              </span>
            ))}
          </div>
        </div>
        <dl className="grid grid-cols-2 content-start gap-x-4 gap-y-3 text-[12px] lg:grid-cols-1">
          <div>
            <dt className="text-muted-foreground">Operating cash, {model.periods.length} yrs</dt>
            <dd className="num text-lg font-medium">{fmtCompactUsd(model.cfoTotal)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Returned to shareholders</dt>
            <dd className="num text-lg font-medium">
              {fmtCompactUsd(returned)} <span className="text-xs text-muted-foreground">{model.cfoTotal > 0 ? fmtPct(returned / model.cfoTotal, 0) : ""} of CFO</span>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Reinvested (capex + M&A)</dt>
            <dd className="num text-lg font-medium">
              {fmtCompactUsd(reinvested)} <span className="text-xs text-muted-foreground">{model.cfoTotal > 0 ? fmtPct(reinvested / model.cfoTotal, 0) : ""} of CFO</span>
            </dd>
          </div>
          {model.shareChange != null && (
            <div>
              <dt className="text-muted-foreground">Diluted share count</dt>
              <dd className={cn("num text-lg font-medium", model.shareChange < 0 ? "text-positive" : model.shareChange > 0.02 ? "text-negative" : "")}>
                {fmtPct(model.shareChange, 1, true)} <span className="text-xs text-muted-foreground">split-adjusted</span>
              </dd>
            </div>
          )}
        </dl>
      </div>
    </Panel>
  );
}
