import { useMemo, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { Segmented } from "@/components/app/segmented";
import { Button } from "@/components/ui/button";
import type { PeriodFormat } from "@/lib/sources/periods";
import { ColumnChart, ColumnChartSkeleton, type ColumnMark } from "./column-chart";
import { CountPanel, CountTable } from "./panel";
import { isUniform, openingWindow, outerWindow, periodCaption, periodChart, periodTicks, windowLabel, type PeriodColumn, type PeriodWindow } from "./period-model";
import type { AllFacets } from "./queries";

const NAME = "Records per period";

const mark = (c: PeriodColumn): ColumnMark => ({
  key: c.key,
  value: c.rows,
  label: c.label,
  valueText: `${c.exact ? "" : "at least "}${c.rows.toLocaleString("en-US")} ${c.rows === 1 ? "record" : "records"}`,
  lines: c.action ? [c.action.kind === "filter" ? "Opens its records" : `${c.periods.length.toLocaleString("en-US")} periods; opens them`] : c.rows ? [] : ["No records"],
  title: c.title,
  actionable: c.action !== null,
});

/**
 * Records per period as columns: the last ten calendar years by default, every period under "All", years when more
 * than 60 periods are in view. A period column opens its records (the records table's period filter); a year opens
 * its periods (and a crowded year its months), with a way back.
 */
export function PeriodPanel({
  facets,
  format,
  total,
  view,
  onPeriod,
}: {
  facets: AllFacets;
  format: PeriodFormat;
  /** Records in the snapshot (its own count). */
  total: number;
  view: "chart" | "table";
  onPeriod: (period: string) => void;
}) {
  // null until the reader picks: the opening window follows the format, which can arrive after the counts
  const [picked, setBase] = useState<"recent" | "all" | null>(null);
  const opening = useMemo(() => openingWindow(facets.values, format), [facets.values, format]);
  const base = picked ?? opening;
  const [zoom, setZoom] = useState<PeriodWindow | null>(null);
  const chart = useMemo(() => periodChart(facets.values, format, zoom ?? { kind: base }), [facets.values, format, zoom, base]);
  const caption = useMemo(() => periodCaption(facets.values, format, total, facets.complete), [facets.values, format, total, facets.complete]);
  const zoomed = chart.window.kind === "year" || chart.window.kind === "month";
  const marks = chart.columns.map(mark);
  const longest = Math.max(4, ...chart.columns.map((c) => (chart.grain === "period" && !chart.dated ? Math.min(14, c.label.length) : 7)));
  const actions = zoomed ? (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-muted-foreground">{windowLabel(chart.window)}</span>
      <Button size="xs" variant="outline" onClick={() => setZoom(chart.window.kind === "month" ? outerWindow(chart.window) : null)}>
        <ChevronLeft aria-hidden />
        {chart.window.kind === "month" ? `Back to ${chart.window.month.slice(0, 4)}` : "Back to years"}
      </Button>
    </div>
  ) : chart.windowed ? (
    <Segmented
      size="xs"
      label="Periods shown"
      value={chart.window.kind === "all" ? "all" : "recent"}
      onChange={(v) => setBase(v === "all" ? "all" : "recent")}
      options={[
        { v: "recent", l: chart.dated ? "10 years" : "Last 60" },
        { v: "all", l: "All" },
      ]}
    />
  ) : null;
  return (
    <CountPanel name={NAME} title={NAME} caption={caption} actions={actions}>
      {view === "chart" ? (
        <ColumnChart
          columns={marks}
          ticks={(room) => periodTicks(chart, room)}
          roomFor={longest * 6.6 + 14}
          plotHeight={isUniform(chart) ? 56 : undefined}
          label={NAME}
          onSelect={(i) => {
            const action = chart.columns[i]?.action;
            if (!action) return;
            if (action.kind === "filter") onPeriod(action.period);
            else setZoom(action.window);
          }}
        />
      ) : (
        <CountTable
          head={[chart.grain === "year" ? "Year" : chart.grain === "month" ? "Month" : "Period", "Records"]}
          rows={chart.columns.map((c) => ({ key: c.key, label: c.label, sub: c.periods.length === 1 && c.periods[0] !== c.label ? c.periods[0] : undefined, text: `${c.exact ? "" : "≥ "}${c.rows.toLocaleString("en-US")}` }))}
        />
      )}
    </CountPanel>
  );
}

export function PeriodPanelSkeleton() {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-2 rounded-md border bg-card px-4 py-3 shadow-paper" data-section={NAME} aria-busy="true">
      <h3 className="text-[13px] font-semibold">{NAME}</h3>
      <span className="block h-3 w-1/2 animate-pulse rounded bg-muted" />
      <ColumnChartSkeleton />
    </div>
  );
}
