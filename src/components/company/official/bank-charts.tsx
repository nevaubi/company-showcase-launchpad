import { useMemo, useState } from "react";
import { Segmented } from "@/components/app/segmented";
import { BASIS_TEXT, FDIC_LINES, TREND_FIELDS } from "@/lib/sources/company/fdic-fields";
import { ratioStats, readerOf, trendCharts, trendTitle, valueAxis, type RatioStat } from "@/lib/sources/company/charts";
import { historySeries, quarterLabel, showCell, unitLabel } from "@/lib/sources/company/present";
import type { BankHistory, OfficialBank } from "@/lib/sources/company/types";
import { cn } from "@/lib/utils";
import { FigureHead, SourceLine } from "./chart-parts";
import { QuarterChart, type QuarterPoint } from "./quarter-chart";
import { RecordLink } from "./record-link";
import { GapSparkline } from "./small-charts";

/** The cohort caveat every FDIC chart states (the stored tables are not the whole industry). */
export const COHORT_NOTE = "FDIC 500 cohort: insured institutions chosen by assets on 30 Jun 2026, as each reported to the FDIC.";

const sourceNameOf = (h: BankHistory) => (p: QuarterPoint) => (p.ref.dataset === h.sources[0]?.dataset ? "FDIC quarterly history" : "FDIC latest quarter");
const spanOf = (h: BankHistory) => (h.points.length ? `${quarterLabel(h.points[0].period)} to ${quarterLabel(h.points[h.points.length - 1].period)}` : "");

/** The selected charter's assets, deposits and quarterly net income since 2000, one chart each, side by side. */
export function TrendCharts({ bank, history }: { bank: OfficialBank; history: BankHistory }) {
  const charts = trendCharts(history);
  if (!charts.length) return <p className="px-3.5 py-2 text-[13px] text-muted-foreground">The history table states no unit for assets, deposits or net income.</p>;
  const gaps = charts.reduce((n, c) => n + c.gaps, 0);
  return (
    <div data-section="Bank trends" className="min-w-0 px-3.5 pb-2 pt-2.5">
      <div className="grid grid-cols-1 gap-x-5 gap-y-3 md:grid-cols-3">
        {charts.map(c => {
          const values = c.points.filter(p => p.value != null).map(p => p.value!);
          const axis = valueAxis(values, c.unit, { reader: c.reader, asFiled: unitLabel(c.unit) });
          return (
            <div key={c.field} className="min-w-0">
              <FigureHead title={trendTitle(c)} reader={c.reader} cell={c.latest?.cell ?? null} unit={c.unit} period={c.latest?.period ?? null} at={c.latest?.ref ?? null} />
              <p className="mb-0.5 mt-1 text-[11px] text-muted-foreground">{axis.title}</p>
              <QuarterChart points={c.points} unit={c.unit} axis={axis} label={`${bank.name}: ${trendTitle(c)}, ${spanOf(history)}`} sourceName={sourceNameOf(history)} height={140} />
            </div>
          );
        })}
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        {spanOf(history)} by quarter. {gaps > 0 && `${gaps} stored ${gaps === 1 ? "cell is" : "cells are"} not a figure and ${gaps === 1 ? "is" : "are"} left as a gap. `}Net income is the FDIC's quarterly figure (NETINCQ). {COHORT_NOTE} Quarters before the company held the bank may be included.
      </p>
    </div>
  );
}

/** One stat tile: the latest ratio, the change on the same quarter a year earlier, a 24-quarter sparkline. */
function RatioTile({ s }: { s: RatioStat }) {
  const shown = showCell(s.latest!.cell, s.unit);
  const basis = BASIS_TEXT[s.basis];
  return (
    <div className="flex min-w-0 flex-col rounded-[4px] border px-3 py-2">
      <p className="text-[11px] leading-snug text-muted-foreground">{s.label}</p>
      <p className="mt-0.5">
        <RecordLink at={s.latest!.ref} title={shown.title} className="text-[18px] font-semibold leading-tight text-foreground">
          {shown.text}%
        </RecordLink>
      </p>
      <p className="text-[11px] text-muted-foreground">
        {quarterLabel(s.latest!.period)}
        {basis && `, ${basis}`}
      </p>
      <p className="text-[11px] text-muted-foreground" title={s.change?.formula}>
        {s.change ? (
          <>
            <span className="num text-foreground">{s.change.text}</span> pts from {quarterLabel(s.yearEarlier!.period)}
          </>
        ) : (
          "No figure a year earlier"
        )}
      </p>
      <GapSparkline values={s.spark} className="mt-auto pt-1" />
    </div>
  );
}

/** The latest quarter's ratios as the FDIC publishes them, each one a stat tile. */
export function RatioTiles({ history }: { history: BankHistory }) {
  const stats = ratioStats(history);
  if (!stats.length) return null;
  const notReported = stats.reduce((n, s) => n + s.notReported, 0);
  return (
    <div data-section="Bank ratios" className="min-w-0 px-3.5 pb-2.5">
      <h4 className="mb-1.5 text-[11px] font-medium text-muted-foreground">Ratios as the FDIC publishes them, latest quarter</h4>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {stats.map(s => (
          <RatioTile key={s.field} s={s} />
        ))}
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        Percentages rounded to two decimals; hover a figure for the digits as stored. The change is the latest quarter less the same quarter a year earlier, in percentage points. Sparklines run {stats[0].spark.length} quarters to the latest.
        {notReported > 0 && " Quarters the FDIC stores as 0 before a ratio was reported are not drawn."}
      </p>
    </div>
  );
}

/** Every quarter of the three trend measures, latest first, each cell opening its record (the charts' table view). */
export function TrendTable({ history }: { history: BankHistory }) {
  const series = TREND_FIELDS.filter(f => history.measures.some(m => m.field === f)).map(f => ({ field: f, def: FDIC_LINES.find(l => l.field === f)!, ...historySeries(history, f) }));
  if (!series.length) return null;
  const sourceName = sourceNameOf(history);
  const rows = history.points.map((_, i) => i).reverse();
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[560px] text-[13px]">
        <caption className="sr-only">Quarterly history, {spanOf(history)}</caption>
        <thead>
          <tr className="h-7 border-b text-left text-[11px] text-muted-foreground">
            <th className="pl-3.5 font-normal">Quarter</th>
            {series.map(s => (
              <th key={s.field} className="text-right font-normal">
                {trendTitle(s.def)} ({unitLabel(s.unit)})
              </th>
            ))}
            <th className="pl-3 pr-3.5 font-normal">Stored record</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(i => {
            const first = series[0].points[i];
            return (
              <tr key={first.period} className="h-7 border-b last:border-0">
                <td className="num pl-3.5 text-[11px]">{quarterLabel(first.period)}</td>
                {series.map(s => {
                  const p = s.points[i];
                  const shown = showCell(p.cell, s.unit);
                  return (
                    <td key={s.field} className="num text-right" title={shown.title}>
                      {shown.text || <span className="text-muted-foreground">empty</span>}
                    </td>
                  );
                })}
                <td className="pl-3 pr-3.5 text-[11px] text-muted-foreground">
                  <RecordLink at={first.ref}>
                    {sourceName(first)}, row {first.ref.row.toLocaleString("en-US")}
                  </RecordLink>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Every proven cohort charter of the company, one small chart each for the chosen measure: a shared time axis, each
 * chart on its own value axis (charters differ in size by orders of magnitude), each figure the charter's own; never
 * summed. A charter's name selects it for the detail below.
 */
export function ChartersCompared({ trends, banks, selected, onSelect }: { trends: BankHistory[]; banks: OfficialBank[]; selected: string | null; onSelect: (cert: string) => void }) {
  const fields = TREND_FIELDS.filter(f => trends.some(t => t.measures.some(m => m.field === f)));
  const [field, setField] = useState(fields[0] ?? "ASSET");
  const pick = fields.includes(field) ? field : fields[0];
  const span = useMemo((): [string, string] => {
    const firsts = trends.map(t => t.points[0]?.period).filter(Boolean).sort();
    const lasts = trends.map(t => t.points[t.points.length - 1]?.period).filter(Boolean).sort();
    return [firsts[0] ?? "2000-03-31", lasts[lasts.length - 1] ?? "2026-09-30"];
  }, [trends]);
  if (trends.length < 2 || !pick) return null;
  const def = FDIC_LINES.find(l => l.field === pick)!;
  const nameOf = (cert: string) => banks.find(b => b.cert === cert)?.name ?? `Certificate ${cert}`;
  return (
    <div data-section="Charters compared" className="min-w-0 border-t px-3.5 pb-2.5 pt-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-[13px] font-semibold">Charters compared</h3>
        <Segmented label="Measure" size="xs" value={pick} onChange={setField} options={fields.map(f => ({ v: f, l: trendTitle(FDIC_LINES.find(l => l.field === f)!) }))} />
      </div>
      <div className="mt-2 grid grid-cols-1 gap-x-5 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
        {trends.map(t => {
          const s = historySeries(t, pick);
          const drawn = s.points.filter(p => p.value != null);
          const latest = drawn[drawn.length - 1] ?? null;
          const reader = latest ? readerOf(s.unit, latest.cell) : null;
          const axis = valueAxis(drawn.map(p => p.value!), s.unit, { reader, asFiled: unitLabel(s.unit) });
          const on = t.cert === selected;
          return (
            <div key={t.cert} className="min-w-0">
              <button
                type="button"
                aria-pressed={on}
                onClick={() => onSelect(t.cert)}
                className={cn("max-w-full truncate rounded-[3px] text-left text-[13px] transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", on && "font-medium")}
              >
                {nameOf(t.cert)}
              </button>
              {drawn.length > 1 ? (
                <>
                  <p className="flex items-baseline gap-1.5 text-[11px] text-muted-foreground">
                    {latest && (
                      <RecordLink at={latest.ref} className="text-[13px] font-medium text-foreground" title={showCell(latest.cell, s.unit).title}>
                        {reader ? reader.figure : `${showCell(latest.cell, s.unit).text} ${unitLabel(s.unit)}`}
                      </RecordLink>
                    )}
                    <span>{latest ? quarterLabel(latest.period) : ""}</span>
                    <span className="ml-auto">{axis.title}</span>
                  </p>
                  <QuarterChart points={s.points} unit={s.unit} axis={axis} label={`${nameOf(t.cert)}: ${trendTitle(def)}`} sourceName={sourceNameOf(t)} height={104} span={span} compact />
                </>
              ) : (
                <p className="py-2 text-[11px] text-muted-foreground">Fewer than two quarters with a figure are stored.</p>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">Each chart has its own value axis; charters are never added together. {COHORT_NOTE}</p>
      <SourceLine source={trends[0].sources[0] ?? null} table="Open history table">
        FDIC quarterly reports, {quarterLabel(span[0])} to {quarterLabel(span[1])}
      </SourceLine>
    </div>
  );
}

