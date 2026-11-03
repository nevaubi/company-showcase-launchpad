import { useEffect, useMemo, useRef } from "react";
import { useSource } from "@/components/source/source-context";
import { Sparkline } from "@/components/charts/sparkline";
import type { Cell, Row, Statement } from "@/lib/financials/types";
import { fmtCell, fmtDate, unitLabel, type Scale } from "@/lib/format";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function StatementTable({
  statement,
  ticker,
  scale = "M",
  maxPeriods,
  filingsByAccn,
}: {
  statement: Statement;
  ticker: string;
  scale?: Scale;
  maxPeriods?: number;
  filingsByAccn: Map<string, { form: string; filed: string }>;
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
    <div className="overflow-hidden rounded-lg border bg-card shadow-paper">
      <div ref={scroller} className="overflow-x-auto scrollbar-thin">
        <table className="w-max min-w-full border-separate border-spacing-0 text-[13px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 min-w-64 border-b border-r bg-card px-4 py-2 text-left align-bottom">
                <span className="eyebrow">Line item</span>
              </th>
              {periods.map((p) => (
                <th key={p.key} className="border-b px-3 py-2 text-right align-bottom">
                  <span className="num block text-[11px] font-semibold">{p.label}</span>
                  <span className="num block text-[10px] font-normal text-muted-foreground">{fmtDate(p.end, { month: "short", year: "2-digit" })}</span>
                </th>
              ))}
              <th className="border-b border-l px-3 py-2 text-left align-bottom">
                <span className="eyebrow">Trend</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const vals = row.cells.slice(-12).map((c) => c?.v ?? NaN);
              return (
                <tr key={row.key} className="group">
                  <th
                    scope="row"
                    className={cn(
                      "sticky left-0 z-10 border-b border-r bg-card px-4 py-1.5 text-left font-normal transition-colors group-hover:bg-secondary",
                      row.bold && "font-semibold",
                    )}
                  >
                    <span className={cn("flex items-center gap-2", row.indent && "pl-4 text-foreground/80")}>
                      {row.label}
                      <span className="num ml-auto text-[10px] font-normal text-muted-foreground">{unitLabel(row.unit, scale)}</span>
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
                    return (
                      <td key={i} className="border-b p-0 group-hover:bg-secondary/60">
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
                              {cell.derived && row.kind !== "kpi" && (
                                <span className="absolute right-0.5 top-1 size-1 rounded-full bg-chart-2" aria-label="derived" />
                              )}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs text-xs">
                            {cell.src ? (
                              <>
                                <p className="font-medium">
                                  {filing ? `${filing.form} · filed ${fmtDate(filing.filed)}` : cell.src.accn}
                                </p>
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
                  <td className="border-b border-l px-3 py-1 group-hover:bg-secondary/60">
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

export function statementToCsv(statement: Statement, scale: Scale) {
  const head = ["Line item", ...statement.periods.map((p) => `${p.label} (${p.end})`)];
  const lines = statement.rows.map((r) => [
    `${r.label} (${unitLabel(r.unit, scale)})`,
    ...r.cells.map((c) => (c ? fmtCell(c.v, r.unit, scale).replace(/[(),%×]/g, (m) => (m === "(" ? "-" : "")) : "")),
  ]);
  return [head, ...lines].map((l) => l.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(",")).join("\n");
}
