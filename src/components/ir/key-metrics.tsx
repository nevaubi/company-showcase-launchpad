import { useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { IrPanel } from "@/components/ir/panel";
import { IR } from "@/components/ir/typography";
import { Segmented } from "@/components/app/segmented";
import { useSource } from "@/components/source/source-context";
import { openIrCell } from "@/components/ir/breakdowns";
import { useUnitScale } from "@/hooks/use-preference";
import { fmtIr, shownLabel, unitCaption } from "@/lib/ir/display";
import { formatKpiChange, biggestMoves, keyLines, type KeyLine } from "@/lib/ir/highlights";
import type { IrPayload } from "@/lib/ir/payload";
import { fiscalCalendar, fiscalLabel, periodGrids } from "@/lib/ir/periods";
import { cn } from "@/lib/utils";


/** Costs and credit losses improve when they fall. */
const inverted = (l: KeyLine) => l.s.cat === "cost" || l.s.met === "cost" || l.s.met === "expense" || /charge-?off|provision|non-?performing|delinquen|efficiency ratio/i.test(l.s.label);
const toneOf = (v: number | null, l: KeyLine) => (v == null || Math.abs(v) < 0.05 ? "" : (v > 0) !== inverted(l) ? "text-positive" : "text-negative");

/** Eight quarters as small bars; the latest is drawn in ink, gaps stay empty. */
function TrendBars({ values }: { values: (number | null)[] }) {
  const vs = values.filter((v): v is number => v != null);
  if (vs.length < 2) return null;
  const hi = Math.max(0, ...vs);
  const lo = Math.min(0, ...vs);
  const span = hi - lo || 1;
  const w = 100 / values.length;
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="h-5 w-24 opacity-90" aria-hidden>
      {values.map((v, i) => {
        if (v == null) return null;
        const y0 = 24 - ((0 - lo) / span) * 24;
        const y1 = 24 - ((v - lo) / span) * 24;
        return <rect key={i} x={i * w + w * 0.15} width={w * 0.7} y={Math.min(y0, y1)} height={Math.max(1, Math.abs(y1 - y0))} className={i === values.length - 1 ? "fill-foreground" : "fill-muted-foreground"} />;
      })}
    </svg>
  );
}

export function IrKeyMetrics({ ticker, payload }: { ticker: string; payload: IrPayload }) {
  const [view, setView] = useState<"key" | "moves">("key");
  const [scale] = useUnitScale();
  const { open } = useSource();
  const quarters = periodGrids(payload).q;
  const lines = useMemo(() => keyLines(payload, quarters, 12), [payload, quarters]);
  const moves = useMemo(() => biggestMoves(payload, quarters, 6), [payload, quarters]);
  if (!lines.length) return null;
  const end = lines[0].end;
  const head = fiscalLabel(end, "q", fiscalCalendar(payload));
  const trendN = Math.max(...lines.map((l) => l.trend.length));
  const openLine = (l: KeyLine) => openIrCell(open, ticker, payload, l.s, l.end, "q", l.cell);
  const unitOf = (l: KeyLine) => (l.s.unit === "usd" ? (scale === "full" ? "$" : `$${scale}`) : l.s.unit === "pct" ? "%" : unitCaption(l.s.unit, scale));

  const value = (l: KeyLine) => (
    <button type="button" onClick={() => openLine(l)} className={cn("num rounded px-1 tabular-nums transition-colors duration-150 hover:bg-highlight-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none", IR.strong, l.cell.f && IR.derived)} title={l.cell.f ? `Calculated: ${l.cell.f.formula}` : "Open the source"}>
      {fmtIr(l.cell.v, l.s.unit, scale)}
    </button>
  );

  return (
    <IrPanel
      section="Key metrics"
      title="Key metrics"
      subtitle={`${head.short} · lines with the fullest recent history, largest first · click a value for its source`}
      actions={<Segmented label="Key metrics view" size="xs" value={view} onChange={setView} options={[{ v: "key", l: "Key lines" }, { v: "moves", l: "Biggest moves" }]} />}
    >
      <div>
        {view === "key" ? (
          <div className="overflow-x-auto scrollbar-thin">
            <table className={cn("w-full min-w-[640px] table-fixed", IR.row)}>
              <colgroup>
                <col />
                <col className="w-32" />
                <col className="w-32" />
                <col className="w-32" />
                <col className="w-36" />
              </colgroup>
              <thead>
                <tr className={cn("text-left", IR.caption)}>
                  <th scope="col" className="px-4 py-1.5 font-normal">Line</th>
                  <th scope="col" className="px-2 py-1.5 text-right font-normal" title={`Quarter ended ${end}`}>
                    <span className="num block font-medium text-foreground">{head.main}</span>
                    {head.sub && head.sub !== head.main && <span className="num block">{head.sub}</span>}
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-normal">vs prior quarter</th>
                  <th scope="col" className="px-2 py-1.5 text-right font-normal">vs a year ago</th>
                  <th scope="col" className="px-4 py-1.5 text-right font-normal">Last {trendN} quarters</th>
                </tr>
              </thead>
              <tbody className="divide-y border-t">
                {lines.map((l) => (
                  <tr key={l.s.k} className="transition-colors duration-150 hover:bg-secondary/60 motion-reduce:transition-none">
                    <th scope="row" className="px-4 py-1.5 text-left font-normal">
                      <div className={cn("truncate", IR.row, IR.strong)} title={shownLabel(l.s.label)}>{shownLabel(l.s.label)}</div>
                      <div className={cn("truncate", IR.caption)} title={l.groupTitle}>
                        {l.groupTitle} · {unitOf(l)}
                      </div>
                    </th>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right">{value(l)}</td>
                    <td className={cn("num whitespace-nowrap px-2 py-1.5 text-right tabular-nums", toneOf(l.qoq, l))}>{formatKpiChange(l.qoq, l.s.unit)}</td>
                    <td className={cn("num whitespace-nowrap px-2 py-1.5 text-right font-medium tabular-nums", toneOf(l.yoy, l))}>{formatKpiChange(l.yoy, l.s.unit)}</td>
                    <td className="px-4 py-1.5">
                      <div className="flex justify-end">
                        <TrendBars values={l.trend} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid grid-cols-1 divide-y md:grid-cols-2 md:divide-x md:divide-y-0">
            {([
              ["Up most vs a year ago", moves.up, ArrowUpRight],
              ["Down most vs a year ago", moves.down, ArrowDownRight],
            ] as const).map(([title, list, Icon]) => (
              <div key={title} className="min-w-0">
                <p className={cn("flex items-center gap-1 px-4 pb-1 pt-2", IR.caption)}>
                  <Icon className="size-3.5" /> {title}
                </p>
                {list.length ? (
                  <ul className="divide-y border-t">
                    {list.map((l) => (
                      <li key={l.s.k} className={cn("flex items-center gap-3 px-4 py-1.5", IR.row)}>
                        <div className="min-w-0 flex-1">
                          <div className="truncate" title={shownLabel(l.s.label)}>{shownLabel(l.s.label)}</div>
                          <div className={cn("truncate", IR.caption)}>{l.groupTitle} · {unitOf(l)}</div>
                        </div>
                        {value(l)}
                        <span className={cn("num w-16 text-right font-medium tabular-nums", toneOf(l.yoy, l))}>{formatKpiChange(l.yoy, l.s.unit)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={cn("border-t px-4 py-3", IR.caption)}>No sizeable line moved this way.</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </IrPanel>
  );
}
