import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MISSING } from "./missing";
import { ChartColumnBig } from "lucide-react";
import { useSource } from "@/components/source/source-context";
import { Sparkline } from "@/components/charts/sparkline";
import type { Cell, Period, Row, Statement } from "@/lib/financials/types";
import { fmtCell, fmtDate, fmtValueLong, scaled, unitLabel, type Scale } from "@/lib/format";
import { rowLabel } from "./row-label";
import { cagr } from "@/lib/financials/metrics";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { isRatioLine, levelClass, splitMark, stripes, INDENT } from "@/components/ir/table-style";
import "@/components/ir/table.css";

export type StatementView = "values" | "yoy" | "common";

/**
 * Growth of a row's latest value: CAGR (annual) or YoY (quarterly). Only over a span whose first and last
 * periods both have values, and the last is the table's newest column: a row whose recent years are empty
 * shows no growth (p5-shots M7). `since` names the first period when the span is shorter than the table's.
 */
export function rowTrend(row: Row, periods: Period[], freq: "annual" | "quarterly"): { v: number; label: string; since: string | null } | null {
  if (row.unit === "pct" || row.unit === "ratio" || row.unit === "days") return null;
  const idx = row.cells.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
  if (idx.length < 2) return null;
  const last = idx.at(-1)!;
  if (last !== periods.length - 1) return null;
  const lv = row.cells[last]!.v;
  if (freq === "quarterly") {
    const p = periods[last];
    const j = periods.findIndex((q) => q.fy === p.fy - 1 && q.fq === p.fq);
    const prev = j >= 0 ? row.cells[j]?.v : undefined;
    if (prev == null || prev <= 0 || lv <= 0) return null;
    return { v: lv / prev - 1, label: `${p.label} vs ${periods[j].label}`, since: null };
  }
  const first = idx[0];
  const fv = row.cells[first]!.v;
  const years = periods[last].fy - periods[first].fy;
  const g = cagr(fv, lv, years);
  return g == null ? null : { v: g, label: `${periods[first].label}–${periods[last].label} (${years}y)`, since: first > 0 ? periods[first].label : null };
}

/**
 * Lines that close a statement, set as grand totals (double rule) as statements print them: net income,
 * total assets, total liabilities and equity. From the builder's row keys; a `total` flag on the row, when
 * the builder sets one (finding finstyle-01), wins.
 */
const GRAND_KEYS = new Set(["netIncome", "totalAssets", "liabilitiesAndEquity"]);

/**
 * How a standardized statement row is set, from its data (never its label):
 * grand  a statement's closing line: bold, firm rule above, double rule under the figures
 * sub    a bold reported line (a subtotal): semibold, hairline rule above the figures
 * emph   a bold per-share, ratio or calculated line (diluted EPS, free cash flow): semibold, no rule
 * line   any other line
 */
export type StatementRowKind = "line" | "sub" | "grand" | "emph";
export function statementRowKind(row: Row): StatementRowKind {
  const flag = (row as Row & { total?: "sub" | "grand" }).total;
  if (flag === "grand" || (flag == null && GRAND_KEYS.has(row.key))) return "grand";
  if (flag === "sub") return "sub";
  if (!row.bold) return "line";
  return row.kind === "kpi" || isUnitLine(row.unit) ? "emph" : "sub";
}

/** Per-share, percentage, ratio and day-count lines: set in the muted unit style. */
export const isUnitLine = (unit: Row["unit"]) => isRatioLine(unit === "days" ? "ratio" : unit, unit === "usdPerShare");

/** The unit mark set apart after a figure (12.5% → 12.5 and %). */
const MARK: Partial<Record<Row["unit"], string>> = { pct: "%", ratio: "×" };

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
  maxHeight,
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
  /** Kept for callers; the table no longer scrolls vertically inside the page (its head sticks to the page). */
  maxHeight?: string;
}) {
  void maxHeight;
  const { open, target } = useSource();
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const lastHead = useRef<HTMLTableCellElement>(null);
  const start = maxPeriods ? Math.max(0, statement.periods.length - maxPeriods) : 0;
  const periods = statement.periods.slice(start);
  // Rows with no value in the visible periods are left out (a bank's "Gross profit", a line a filer stopped tagging).
  const rows = useMemo(
    () => statement.rows.map((r) => ({ ...r, cells: r.cells.slice(start) })).filter((r) => r.cells.some(Boolean)),
    [statement, start],
  );
  // The unit most rows share is stated once in the head; rows in another unit say theirs.
  const tableUnit = useMemo(() => {
    const n = new Map<string, number>();
    for (const r of rows) n.set(r.unit, (n.get(r.unit) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] as Row["unit"] | undefined;
  }, [rows]);

  // When the table fits, it does not scroll sideways, so its head can stick to the page; otherwise it
  // scrolls inside its own wrapper and opens on the latest period (not on the trend columns).
  // The trend sparkline column is the first thing dropped when the periods do not fit (AAPL 10Y at
  // 1280 px), so the default view keeps its head pinned to the page; it returns when there is room.
  const [fits, setFits] = useState(true);
  // 0: every column; 1: no trend sparkline; 2: no trend and no CAGR/YoY column.
  const [drop, setDrop] = useState(0);
  const showTrend = drop === 0;
  const showGrowth = drop < 2;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const check = () => {
      const over = el.scrollWidth - el.clientWidth;
      if (over > 1 && drop < 2) return setDrop(drop + 1);
      if (drop > 0 && over <= 1 && el.clientWidth - el.scrollWidth >= (drop === 2 ? GROWTH_W : TREND_W)) return setDrop(drop - 1);
      setFits(over <= 1);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [rows, periods.length, drop]);
  useEffect(() => {
    const el = scroller.current;
    const th = lastHead.current;
    if (!el || fits) return;
    const id = requestAnimationFrame(() => {
      if (!th) return void (el.scrollLeft = el.scrollWidth);
      // Bring the latest period's right edge to the wrapper's right edge.
      el.scrollLeft += th.getBoundingClientRect().right - el.getBoundingClientRect().right;
    });
    return () => cancelAnimationFrame(id);
  }, [statement, maxPeriods, fits, periods.length]);

  // The filing behind each column: the accession most cells in that period came from.
  const columnFiling = useMemo(
    () =>
      periods.map((_, i) => {
        const counts = new Map<string, number>();
        for (const r of rows) {
          const a = r.cells[i]?.src?.accn;
          if (a) counts.set(a, (counts.get(a) ?? 0) + 1);
        }
        // A calculated column (a fourth quarter) is labelled by the filing of its positive parts (the 10-K).
        if (!counts.size)
          for (const r of rows)
            for (const p of r.cells[i]?.derived?.parts ?? []) if (p.sign === 1) counts.set(p.accn, (counts.get(p.accn) ?? 0) + 1);
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
  const banded = useMemo(() => stripes(rows.map(() => ({ kind: "line" as const }))), [rows]);
  const latest = periods.length - 1;

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
    <div ref={root} data-section="Financial statements" className="irt-root min-w-0 overflow-clip rounded-lg border bg-card shadow-paper">
      <div
        ref={scroller}
        onScroll={(e) => root.current?.toggleAttribute("data-scrolled", e.currentTarget.scrollLeft > 1)}
        className={cn("scrollbar-thin", fits ? "overflow-visible" : "overflow-x-auto overscroll-x-contain")}
      >
        <table className="w-max min-w-full border-separate border-spacing-0 text-[13px]">
          <thead className="irt-colhead">
            <tr>
              <th className={cn("irt-fc sticky left-0 z-30 w-44 min-w-44 px-3 py-2 text-left align-bottom sm:w-auto sm:min-w-60 sm:px-4", fits && "top-[var(--sticky-top,3.5rem)]")}>
                <span className="eyebrow">Line item</span>
                {tableUnit && <span className="num ml-2 text-[11px] font-normal text-muted-foreground">{unitLabel(tableUnit, scale)}</span>}
              </th>
              {periods.map((p, i) => {
                const f = columnFiling[i];
                const read = (p as Period & { readFrom?: { form: string; filed: string } }).readFrom;
                return (
                  <th
                    key={p.key}
                    ref={i === periods.length - 1 ? lastHead : undefined}
                    className={cn("z-20 px-2.5 py-2 text-right align-bottom font-normal", fits && "sticky top-[var(--sticky-top,3.5rem)]", i === latest && "irt-latest")}
                    style={read ? { background: "var(--highlight-soft)" } : undefined}
                  >
                    <span className="irt-period num block text-[11px]">{p.label}</span>
                    <span className="irt-date num block text-[11px]">{fmtDate(p.end, { month: "short", year: "2-digit" })}</span>
                    {read ? (
                      <Tooltip delayDuration={250}>
                        <TooltipTrigger asChild>
                          <span tabIndex={0} className="num block text-[10px] font-normal uppercase tracking-wide text-foreground/80 underline decoration-dotted underline-offset-2">
                            {read.form} · new
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-60 text-xs">
                          Read at view time from the {read.form} filed {fmtDate(read.filed)}. The scheduled rebuild has not added this period yet.
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="num block text-[10px] font-normal uppercase tracking-wide text-muted-foreground/70">{f?.form ?? "\u00a0"}</span>
                    )}
                  </th>
                );
              })}
              {showGrowth && (
                <th className={cn("z-20 border-l px-3 py-2 text-right align-bottom", fits && "sticky top-[var(--sticky-top,3.5rem)]")}>
                  <span className="eyebrow">{freq === "annual" ? "CAGR" : "YoY"}</span>
                </th>
              )}
              {showTrend && (
                <th className={cn("z-20 px-3 py-2 text-left align-bottom", fits && "sticky top-[var(--sticky-top,3.5rem)]")}>
                  <span className="eyebrow">Trend</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody className="irt-body">
            {rows.map((row, ri) => {
              const vals = row.cells.slice(-12).map((c) => c?.v ?? NaN);
              const trend = rowTrend(row, periods, freq);
              const isCharted = charted?.includes(row.key);
              const kind = statementRowKind(row);
              const unitLine = isUnitLine(row.unit);
              const calculated = row.kind === "kpi";
              const weight = kind === "emph" ? "font-semibold" : kind === "line" ? "font-normal" : undefined;
              return (
                <tr
                  key={row.key}
                  data-kind={kind}
                  className={cn(
                    "group irt-line",
                    levelClass(row.indent ?? 0),
                    banded[ri] && "irt-stripe",
                    (kind === "sub" || kind === "grand") && `irt-${kind}`,
                    unitLine && "irt-ratio",
                    isCharted && "irt-match",
                  )}
                >
                  <th scope="row" className={cn("irt-fc sticky left-0 z-10 max-w-44 px-2 py-1 text-left sm:max-w-none", weight)}>
                    <span className="flex items-center gap-1.5">
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
                      <span
                        className={cn("min-w-0 leading-4 [overflow-wrap:anywhere] sm:whitespace-nowrap", calculated && row.unit === "usd" && "italic")}
                        style={row.indent ? { paddingLeft: row.indent * INDENT } : undefined}
                      >
                        {rowLabel(row.label)}
                        {calculated && <span className="sr-only"> (calculated)</span>}
                      </span>
                      {row.unit !== tableUnit && <span className="num ml-auto whitespace-nowrap pl-2 text-[11px] font-normal text-muted-foreground">{unitLabel(row.unit, scale)}</span>}
                    </span>
                  </th>
                  {row.cells.map((cell, i) => {
                    const key = `${row.label}|${periods[i].label}`;
                    if (!cell)
                      return (
                        <td key={i} title="No figure filed for this period" className={cn("num irt-missing px-2.5 py-1 text-right", i === latest && "irt-latest")} style={MISSING}>
                          –
                        </td>
                      );
                    const filing = cell.src ? filingsByAccn.get(cell.src.accn) : undefined;
                    const s = sub(row, i, cell.v);
                    const heat = view === "yoy" && s?.g != null ? Math.min(1, Math.abs(s.g) / 0.4) * 22 : 0;
                    return (
                      <td
                        key={i}
                        className={cn("p-0", weight, i === latest && "irt-latest")}
                        style={heat ? { backgroundColor: `color-mix(in oklab, var(${s!.g! >= 0 ? "--positive" : "--negative"}) ${heat.toFixed(0)}%, transparent)` } : undefined}
                      >
                        <Tooltip delayDuration={350}>
                          <TooltipTrigger asChild>
                            <button
                              data-tour="fin-cell"
                              onClick={() => onCell(row, i, cell)}
                              className={cn(
                                "num relative block w-full px-2.5 py-1 text-right tabular-nums transition-colors hover:bg-highlight-soft focus-visible:bg-highlight-soft focus-visible:outline-none",
                                cell.v < 0 && row.unit !== "pct" && "text-negative",
                                cell.derived && "italic text-foreground/85",
                                activeKey === key && "bg-highlight text-highlight-foreground not-italic",
                              )}
                            >
                              {cell.approx && "≈"}
                              <Figure text={fmtCell(cell.v, row.unit, scale)} mark={MARK[row.unit] ?? ""} />
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
                              <p className="num mb-0.5">{fmtValueLong(cell.v, "usd")}</p>
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
                  {showGrowth && <td className="border-l px-3 py-1 text-right font-normal">
                    {trend ? (
                      <Tooltip delayDuration={300}>
                        <TooltipTrigger asChild>
                          <span className={cn("num text-xs", trend.v >= 0 ? "text-positive" : "text-negative")}>
                            {trend.v >= 0 ? "+" : "−"}
                            {Math.abs(trend.v * 100).toFixed(1)}%
                            {trend.since && <span className="block text-[10px] leading-3 text-muted-foreground">from {trend.since}</span>}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="text-xs">{freq === "annual" ? `Compound annual growth, ${trend.label}` : `Year over year, ${trend.label}`}</TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="text-muted-foreground/40">–</span>
                    )}
                  </td>}
                  {showTrend && (
                    <td className="px-3 py-1">
                      <Sparkline values={vals.filter((v) => Number.isFinite(v))} className="h-5 w-20" />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** A figure with its unit mark set muted. */
function Figure({ text, mark }: { text: string; mark: string }) {
  const [figure, unit] = splitMark(text, mark);
  return (
    <>
      {figure}
      {unit && <span className="irt-mark">{unit}</span>}
    </>
  );
}

/** Width of the trend column (80 px sparkline and 24 px padding). */
const TREND_W = 104;
/** Width of the CAGR/YoY column. */
const GROWTH_W = 68;

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
