// 2. The strip at the top of the IR tab: one tile per standardized KPI (the latest figure and its period, the change
// on a year and on the period before, twelve periods of trend) and the revenue or net revenue mix by segment.
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { decimalsOf, fmtChange, fmtValue } from "./format";
import { statOf } from "./model";
import { Spark, VizNote, useOpener } from "./parts";
import { SectionChart } from "./section-chart";
import type { SummaryStripProps, VizChange, VizStat } from "./types";

const toneOf = (c: VizChange | null, inverted: boolean) => {
  if (!c || Math.abs(c.value) < 0.05) return "text-muted-foreground";
  return c.value > 0 !== inverted ? "text-positive" : "text-negative";
};

function StatTile({
  stat,
  scale,
  onOpen,
}: {
  stat: VizStat;
  scale: SummaryStripProps["scale"];
  onOpen: () => void;
}) {
  const { series: s, latest, yoy, qoq, spark } = stat;
  const value = fmtValue(latest.value, s.unit, scale, s.printedUnit, decimalsOf(latest));
  const label = `${s.label}, ${latest.periodLabel}: ${value}${yoy ? `, ${fmtChange(yoy)} on a year` : ""}${qoq ? `, ${fmtChange(qoq)} on the quarter` : ""}. As filed ${latest.printed ?? "not printed as a cell"}.${latest.source ? " Opens the source." : ""}`;
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!latest.source}
      aria-label={label}
      title={latest.printed ? `As filed: ${latest.printed}` : undefined}
      className="group flex min-w-0 flex-col gap-1 rounded-md border bg-card px-3 py-2.5 text-left transition-colors duration-150 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default motion-reduce:transition-none"
    >
      <span className="line-clamp-2 min-h-8 text-[12px] leading-4 text-muted-foreground">
        {s.label}
      </span>
      <span className="num truncate text-lg font-medium leading-6 text-foreground">{value}</span>
      <Spark values={spark.map((p) => p?.value ?? null)} className="max-w-full" />
      <span className="flex flex-wrap items-baseline gap-x-2 text-[11px] leading-4">
        {yoy ? (
          <span className={cn("num", toneOf(yoy, stat.inverted))}>{fmtChange(yoy)} YoY</span>
        ) : (
          <span className="text-muted-foreground">No year-ago figure</span>
        )}
        {qoq && <span className="num text-muted-foreground">{fmtChange(qoq)} QoQ</span>}
      </span>
      <span className="text-[11px] leading-4 text-muted-foreground">{latest.short}</span>
    </button>
  );
}

export function SummaryStrip({ tiles, mix, scale, onOpen, className }: SummaryStripProps) {
  const open = useOpener(onOpen);
  const stats = useMemo(
    () =>
      tiles
        .slice(0, 8)
        .map((s) => statOf(s))
        .filter((s): s is VizStat => !!s),
    [tiles],
  );
  if (!stats.length && !mix)
    return (
      <VizNote className={className}>
        No standardized figures are printed for this company yet.
      </VizNote>
    );
  return (
    <div className={cn("@container min-w-0 space-y-4", className)}>
      {stats.length > 0 && (
        <div className="grid grid-cols-2 gap-2 @lg:grid-cols-3 @3xl:grid-cols-4">
          {stats.map((st) => (
            <StatTile key={st.series.key} stat={st} scale={scale} onOpen={() => open(st.latest)} />
          ))}
        </div>
      )}
      {mix ? (
        <section aria-label={mix.label} className="min-w-0">
          <h3 className="mb-1 text-[13px] font-medium leading-5">{mix.label}</h3>
          <SectionChart
            title={mix.label}
            series={mix.parts}
            parts={mix}
            view="share"
            scale={scale}
            onOpen={onOpen}
            height={170}
          />
        </section>
      ) : (
        <VizNote>No revenue breakdown adds up to the printed total, so no mix is drawn.</VizNote>
      )}
    </div>
  );
}
