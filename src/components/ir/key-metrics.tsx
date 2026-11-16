import { useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Panel } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { useSource } from "@/components/source/source-context";
import { openIrCell } from "@/components/ir/breakdowns";
import { useUnitScale } from "@/hooks/use-preference";
import { fmtIr, periodLabel } from "@/lib/ir/display";
import { biggestMoves, keyLines, type KeyLine } from "@/lib/ir/highlights";
import type { IrPayload } from "@/lib/ir/payload";
import { periodGrids } from "@/lib/ir/periods";
import { cn } from "@/lib/utils";

const fmtChange = (v: number | null, unit: string) => {
  if (v == null) return "—";
  const pts = unit === "pct" || unit === "bps";
  const s = `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v) >= 100 && !pts ? Math.round(Math.abs(v)).toLocaleString() : Math.abs(v).toFixed(1)}`;
  return pts ? `${s} pts` : `${s}%`;
};

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
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="h-5 w-24" aria-hidden>
      {values.map((v, i) => {
        if (v == null) return null;
        const y0 = 24 - ((0 - lo) / span) * 24;
        const y1 = 24 - ((v - lo) / span) * 24;
        return <rect key={i} x={i * w + w * 0.15} width={w * 0.7} y={Math.min(y0, y1)} height={Math.max(1, Math.abs(y1 - y0))} className={i === values.length - 1 ? "fill-foreground" : "fill-muted-foreground/40"} />;
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
  const openLine = (l: KeyLine) => openIrCell(open, ticker, payload, l.s, l.end, "q", l.cell);

  const value = (l: KeyLine) => (
    <button type="button" onClick={() => openLine(l)} className="num rounded px-1 tabular-nums hover:bg-highlight-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" title="Open the source">
      {fmtIr(l.cell.v, l.s.unit, scale)}
      {l.s.unit === "usd" && <span className="ml-0.5 text-[10px] text-muted-foreground">{scale === "full" ? "" : scale}</span>}
    </button>
  );

  return (
    <Panel
      title="Key metrics"
      subtitle={`Quarter ended ${periodLabel(end, "q")} · picked from ${payload.series.length.toLocaleString()} tracked lines for complete recent history and size · click a value for its source`}
      actions={<Segmented label="Key metrics view" size="xs" value={view} onChange={setView} options={[{ v: "key", l: "Key lines" }, { v: "moves", l: "Biggest moves" }]} />}
      collapse={false}
    >
      <div data-section="Key metrics">
        {view === "key" ? (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[640px] table-fixed text-[13px]">
              <colgroup>
                <col />
                <col className="w-32" />
                <col className="w-32" />
                <col className="w-32" />
                <col className="w-36" />
              </colgroup>
              <thead>
                <tr className="text-left text-[11px] text-muted-foreground">
                  <th className="px-3.5 py-1.5 font-normal">Line</th>
                  <th className="px-2 py-1.5 text-right font-normal">{periodLabel(end, "q")}</th>
                  <th className="px-2 py-1.5 text-right font-normal">vs prior quarter</th>
                  <th className="px-2 py-1.5 text-right font-normal">vs a year ago</th>
                  <th className="px-3.5 py-1.5 text-right font-normal">Last 8 quarters</th>
                </tr>
              </thead>
              <tbody className="divide-y border-t">
                {lines.map((l) => (
                  <tr key={l.s.k} className="hover:bg-secondary/40">
                    <td className="px-3.5 py-1.5">
                      <div className="truncate font-medium" title={l.s.label}>{l.s.label}</div>
                      <div className="truncate text-[11px] text-muted-foreground" title={l.groupTitle}>{l.groupTitle}</div>
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right">{value(l)}</td>
                    <td className={cn("num whitespace-nowrap px-2 py-1.5 text-right tabular-nums", toneOf(l.qoq, l))}>{fmtChange(l.qoq, l.s.unit)}</td>
                    <td className={cn("num whitespace-nowrap px-2 py-1.5 text-right font-medium tabular-nums", toneOf(l.yoy, l))}>{fmtChange(l.yoy, l.s.unit)}</td>
                    <td className="px-3.5 py-1.5">
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
                <p className="flex items-center gap-1 px-3.5 pb-1 pt-2 text-[11px] text-muted-foreground">
                  <Icon className="size-3.5" /> {title}
                </p>
                {list.length ? (
                  <ul className="divide-y border-t">
                    {list.map((l) => (
                      <li key={l.s.k} className="flex items-center gap-3 px-3.5 py-1.5 text-[13px]">
                        <div className="min-w-0 flex-1">
                          <div className="truncate" title={l.s.label}>{l.s.label}</div>
                          <div className="truncate text-[11px] text-muted-foreground">{l.groupTitle}</div>
                        </div>
                        {value(l)}
                        <span className={cn("num w-16 text-right font-medium tabular-nums", toneOf(l.yoy, l))}>{fmtChange(l.yoy, l.s.unit)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="border-t px-3.5 py-3 text-xs text-muted-foreground">No sizeable line moved this way.</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}
