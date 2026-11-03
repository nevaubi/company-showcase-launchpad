import { useEffect, useMemo, useRef } from "react";
import { ChartColumnBig } from "lucide-react";
import { useSource } from "@/components/source/source-context";
import { Sparkline } from "@/components/charts/sparkline";
import type { Cell, Period, Row, Statement } from "@/lib/financials/types";
import { fmtCell, fmtDate, scaled, unitLabel, type Scale } from "@/lib/format";
import { cagr } from "@/lib/financials/metrics";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type StatementView = "values" | "yoy" | "common";

/** Growth of a row's latest value: CAGR across the visible span (annual) or YoY (quarterly). */
export function rowTrend(row: Row, periods: Period[], freq: "annual" | "quarterly"): { v: number; label: string } | null {
  if (row.unit === "pct" || row.unit === "ratio" || row.unit === "days") return null;
  const idx = row.cells.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
  if (idx.length < 2) return null;
  const last = idx.at(-1)!;
  const lv = row.cells[last]!.v;
  if (freq === "quarterly") {
    const p = periods[last];
    const j = periods.findIndex((q) => q.fy === p.fy - 1 && q.fq === p.fq);
    const prev = j >= 0 ? row.cells[j]?.v : undefined;
    if (prev == null || prev <= 0 || lv <= 0) return null;
    return { v: lv / prev - 1, label: `${p.label} vs ${periods[j].label}` };
  }
  const first = idx[0];
  const fv = row.cells[first]!.v;
  const years = periods[last].fy - periods[first].fy;
  const g = cagr(fv, lv, years);
  return g == null ? null : { v: g, label: `${periods[first].label}–${periods[last].label} (${years}y)` };
}

export function StatementTable({
  statement,
  ticker,
  scale = "M",
  maxPeriods,
  filingsByAccn,
  view = "values",
  lag = 1,
  freq = "annual",
  charted,
  onToggleChart,
  maxHeight = "72vh",
}: {
  statement: Statement;
  ticker: string;
  scale?: Scale;
  maxPeriods?: number;
  filingsByAccn: Map<string, { form: string; filed: string }>;
  /** Second line per cell: YoY change, or % of revenue / total assets (common size). */
  view?: StatementView;
  /** Periods back for YoY (1 annual, 4 quarterly). */
  lag?: number;
  freq?: "annual" | "quarterly";
  /** Row keys currently shown in the chart above the table */
  charted?: string[];
  onToggleChart?: (key: string) => void;
  maxHeight?: string;
}) {
  const { open, target } = useSource();
  const scroller = useRef<HTMLDivElement>(null);
  const start = maxPeriods ? Math.max(0, statement.periods.length - maxPeriods) : 0;
  const periods = statement.periods.slice(start);
  const rows = useMemo(() => statement.rows.map((r) => ({ ...r, cells: r.cells.slice(start) })), [statement, start]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [statement, maxPeriods]);

  // The filing behind each column: the accession most cells in that period came from.
  const columnFiling = useMemo(
    () =>
      periods.map((_, i) => {
        const counts = new Map<string, number>();
        for (const r of rows) {
          const a = r.cells[i]?.src?.accn;
          if (a) counts.set(a, (counts.get(a) ?? 0) + 1);
        }
        const accn = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        return accn ? filingsByAccn.get(accn) : undefined;
      }),
    [periods, rows, filingsByAccn],
  );

  const baseRow = rows.find((r) => r.key === "revenue") ?? rows.find((r) => r.key === "totalAssets");
  const sub = (row: Row, i: number, v: number): { text: string; g?: number } | null => {
    if (view === "values" || row.unit === "pct" || row.unit === "ratio" || row.unit === "days" || row.kind === "kpi" && row.unit !== "usd") return null;
    if (view === "yoy") {
      const prev = row.cells[i - lag]?.v;
      if (prev == null || prev === 0 || Math.sign(prev) !== Math.sign(v)) return null;
      const g = v / prev - 1;
      return { text: `${g >= 0 ? "+" : "−"}${Math.abs(g * 100).toFixed(1)}%`, g };
    }
    if (row.unit !== "usd") return null;
    const base = baseRow?.cells[i]?.v;
    return base ? { text: `${((v / base) * 100).toFixed(1)}%` } : null;
  };

  const activeKey = target ? `${target.label}|${target.periodLabel}` : "";

  const onCell = (row: Row, i: number, cell: Cell) => {
    open({
      ticker,
      label: row.label,
      periodLabel: periods[i].label,
      unit: row.unit,
      value: cell.v,
      src: cell.src,
      alts: cell.alts,
      derived: cell.derived,
      approx: cell.approx,
    });
  };

  return (
    <div className="min-w-0 overflow-hidden rounded-lg border bg-card shadow-paper">
      <div ref={scroller} className="overflow-auto scrollbar-thin" style={{ maxHeight }}>
        <table className="w-max min-w-full border-separate border-spacing-0 text-[13px]">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 min-w-56 border-b border-r bg-card px-4 py-2 text-left align-bottom sm:min-w-72">
                <span className="eyebrow">Line item</span>
              </th>
              {periods.map((p, i) => {
                const f = columnFiling[i];
                return (
                  <th key={p.key} className="sticky top-0 z-20 border-b bg-card px-3 py-2 text-right align-bottom">
                    <span className="num block text-[11px] font-semibold">{p.label}</span>
                    <span className="num block text-[10px] font-normal text-muted-foreground">{fmtDate(p.end, { month: "short", year: "2-digit" })}</span>
                    {f && <span className="num block text-[9px] font-normal uppercase tracking-wide text-muted-foreground/70">{f.form}</span>}
                  </th>
                );
              })}
              <th className="sticky top-0 z-20 border-b border-l bg-card px-3 py-2 text-right align-bottom">
                <span className="eyebrow">{freq === "annual" ? "CAGR" : "YoY"}</span>
              </th>
              <th className="sticky top-0 z-20 border-b bg-card px-3 py-2 text-left align-bottom">
                <span className="eyebrow">Trend</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const vals = row.cells.slice(-12).map((c) => c?.v ?? NaN);
              const trend = rowTrend(row, periods, freq);
              const isCharted = charted?.includes(row.key);
              return (
                <tr key={row.key} className="group">
                  <th
                    scope="row"
                    className={cn(
                      "sticky left-0 z-10 border-b border-r bg-card px-2 py-1.5 text-left font-normal transition-colors group-hover:bg-secondary",
                      row.bold && "font-semibold",
                      isCharted && "bg-highlight-soft",
                    )}
                  >
                    <span className={cn("flex items-center gap-1.5", row.indent && "pl-4 text-foreground/80")}>
                      {onToggleChart ? (
                        <button
                          type="button"
                          onClick={() => onToggleChart(row.key)}
                          aria-pressed={isCharted}
                          aria-label={`${isCharted ? "Remove" : "Chart"} ${row.label}`}
                          className={cn(
                            "grid size-5 shrink-0 place-items-center rounded transition-opacity hover:bg-card",
                            isCharted ? "text-foreground opacity-100" : "text-muted-foreground opacity-30 group-hover:opacity-100 focus-visible:opacity-100",
                          )}
                        >
                          <ChartColumnBig className="size-3.5" />
                        </button>
                      ) : (
                        <span className="w-2" />
                      )}
                      <span className={cn(row.kind === "kpi" && row.unit === "usd" && "italic")}>{row.label}</span>
                      <span className="num ml-auto pl-3 text-[10px] font-normal text-muted-foreground">{unitLabel(row.unit, scale)}</span>
                    </span>
                  </th>
                  {row.cells.map((cell, i) => {
                    const key = `${row.label}|${periods[i].label}`;
                    if (!cell)
                      return (
                        <td key={i} className="num border-b px-3 py-1.5 text-right text-muted-foreground/50 group-hover:bg-secondary/60">
                          —
                        </td>
                      );
                    const filing = cell.src ? filingsByAccn.get(cell.src.accn) : undefined;
                    const s = sub(row, i, cell.v);
                    const heat = view === "yoy" && s?.g != null ? Math.min(1, Math.abs(s.g) / 0.4) * 22 : 0;
                    return (
                      <td
                        key={i}
                        className="border-b p-0 group-hover:bg-secondary/60"
                        style={heat ? { backgroundColor: `color-mix(in oklab, var(${s!.g! >= 0 ? "--positive" : "--negative"}) ${heat.toFixed(0)}%, transparent)` } : undefined}
                      >
                        <Tooltip delayDuration={350}>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => onCell(row, i, cell)}
                              className={cn(
                                "num relative block w-full px-3 py-1.5 text-right tabular-nums transition-colors hover:bg-highlight-soft focus-visible:bg-highlight-soft focus-visible:outline-none",
                                row.bold && "font-medium",
                                cell.v < 0 && row.unit !== "pct" && "text-negative",
                                cell.derived && "italic text-foreground/85",
                                activeKey === key && "bg-highlight text-highlight-foreground not-italic",
                              )}
                            >
                              {cell.approx && "≈"}
                              {fmtCell(cell.v, row.unit, scale)}
                              {view !== "values" && (
                                <span
                                  className={cn(
                                    "block text-[10px] not-italic leading-tight",
                                    !s ? "text-transparent" : view === "yoy" ? (s.g! >= 0 ? "text-positive" : "text-negative") : "text-muted-foreground",
                                  )}
                                >
                                  {s?.text ?? "·"}
                                </span>
                              )}
                              {cell.derived && row.kind !== "kpi" && (
                                <span className="absolute right-0.5 top-1 size-1 rounded-full bg-chart-2" aria-label="derived" />
                              )}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs text-xs">
                            {scale === "full" || row.unit !== "usd" ? null : (
                              <p className="num mb-0.5">${Math.round(cell.v).toLocaleString("en-US")}</p>
                            )}
                            {cell.src ? (
                              <>
                                <p className="font-medium">{filing ? `${filing.form} · filed ${fmtDate(filing.filed)}` : cell.src.accn}</p>
                                <p className="num opacity-75">{cell.src.concept}</p>
                              </>
                            ) : (
                              <>
                                <p className="font-medium">Calculated</p>
                                <p className="opacity-75">{cell.derived?.formula}</p>
                              </>
                            )}
                          </TooltipContent>
                        </Tooltip>
                      </td>
                    );
                  })}
                  <td className="border-b border-l px-3 py-1.5 text-right group-hover:bg-secondary/60">
                    {trend ? (
                      <Tooltip delayDuration={300}>
                        <TooltipTrigger asChild>
                          <span className={cn("num text-xs", trend.v >= 0 ? "text-positive" : "text-negative")}>
                            {trend.v >= 0 ? "+" : "−"}
                            {Math.abs(trend.v * 100).toFixed(1)}%
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="text-xs">{freq === "annual" ? `Compound annual growth, ${trend.label}` : `Year over year, ${trend.label}`}</TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </td>
                  <td className="border-b px-3 py-1 group-hover:bg-secondary/60">
                    <Sparkline values={vals.filter((v) => Number.isFinite(v))} className="h-5 w-20" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Plain CSV: one column per period, numbers scaled to the chosen unit without separators. */
export function statementToCsv(statement: Statement, scale: Scale) {
  const head = ["Line item", "Unit", ...statement.periods.map((p) => `${p.label} (${p.end})`)];
  const lines = statement.rows.map((r) => [
    r.label,
    unitLabel(r.unit, scale),
    ...r.cells.map((c) => {
      if (!c) return "";
      const v = scaled(c.v, r.unit, scale);
      return r.unit === "pct" ? (v * 100).toFixed(2) : String(Math.round(v * 10000) / 10000);
    }),
  ]);
  return [head, ...lines].map((l) => l.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(",")).join("\n");
}
