import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { TileChart } from "@/components/alt/library/boards/tile-chart";
import { CompareChart } from "@/components/alt/library/charts/compare-chart";
import { computeSeriesTile } from "@/lib/sources/boards/compute";
import { computeCompareTile, type LineInput } from "@/lib/sources/boards/compute-forms";
import type { CompareTileSpec, TileResult } from "@/lib/sources/boards/types";
import { recordHref } from "@/lib/sources/links";
import { addressMatches, type CompareSeries, type MeasureSpec, type Profile, type SeriesAddress } from "@/lib/sources/profiles";
import { sourceQueries } from "@/lib/sources/queries";
import { SERIES_SURE_LIMIT, type SourcePoint } from "@/lib/sources/read-types";
import type { SourceSnapshot } from "@/lib/sources/schema";
import { cn } from "@/lib/utils";
import { holdsRange, lastYears, levelSpec, rowsFromEnd, seriesCells, seriesPlan, tileContext } from "./first-look-model";
import { count } from "./dataset-model";
import { AWAITS_UPDATE } from "./coverage-view";
import { PANEL, QuietLine } from "./ui/primitives";

/** Rows one series view reads at most (five selects of 1,000, one row kept to tell where the series ends). */
const SERIES_LIMIT = SERIES_SURE_LIMIT;

/** The row number a record address carries ("...&row=48517"). */
export const rowOf = (href: string): number | null => {
  const m = /[?&]row=(\d+)/.exec(href);
  return m ? Number(m[1]) : null;
};

/**
 * One measure over time for one series, drawn only from a reviewed profile: the unit as the profile establishes
 * it, periods by the profile's format and cadence, a gap never drawn as zero. Every point opens its record. A
 * series longer than one read holds is read from its end when its profile says so (its latest rows, in date
 * order): then only a range those rows hold whole is drawn, and the caption says how many of the records it read.
 */
export function SeriesView({
  datasetId,
  collection,
  snapshot,
  profile,
  measure,
  address,
  range,
  view,
  onOpen,
}: {
  datasetId: string;
  collection: string;
  snapshot: SourceSnapshot;
  profile: Profile;
  measure: MeasureSpec;
  address: SeriesAddress;
  range: "5y" | "10y" | "all";
  view: "chart" | "table";
  onOpen: (row: number) => void;
}) {
  const plan = useMemo(() => seriesPlan(profile, snapshot.columns, measure, address), [profile, snapshot.columns, measure, address]);
  const fromEnd = rowsFromEnd(profile, address);
  const reads = useQueries({
    queries: (plan.ok ? plan.positions : []).map((field) => ({
      ...sourceQueries.series({
        datasetId,
        snapshotId: snapshot.id,
        field,
        address: plan.ok ? plan.read : { whole: true },
        limit: fromEnd ?? SERIES_LIMIT,
        ...(fromEnd !== undefined ? { last: fromEnd } : {}),
      }),
    })),
  });
  const pending = reads.some((r) => r.isPending);
  const failed = reads.find((r) => r.isError || (r.data && !r.data.ok));
  const result: TileResult | null = useMemo(() => {
    if (!plan.ok) return { ok: false, reason: plan.reason };
    if (pending || failed) return null;
    const byPos = new Map<number, SourcePoint[]>();
    for (const [i, r] of reads.entries()) {
      const data = r.data && r.data.ok ? r.data.data : null;
      if (!data) return null;
      if (data.next !== null) return { ok: false, reason: `The series has more than ${count(SERIES_LIMIT)} records; the first look reads at most that many.` };
      byPos.set(plan.positions[i], data.points);
    }
    const ctx = tileContext(profile, measure, datasetId, snapshot.id, snapshot.columns);
    if (!ctx.ok) return { ok: false, reason: ctx.reason };
    const cells = seriesCells(profile, snapshot.columns, measure, plan, byPos);
    const read = byPos.get(plan.measureAt)?.length ?? 0;
    if (read > 0 && cells.length === 0 && plan.local.length) {
      // every record of the key failed a field the profile fixes: name it rather than say nothing matched
      const fixed = addressMatches(address).map((m) => `${m.field} "${m.value}"`).join(" and ");
      return { ok: false, reason: `None of the ${count(read)} records read for this ${"by" in address ? address.key : "series"} has ${fixed}, which the profile's unit needs.` };
    }
    const unit = ctx.unit ?? (cells.find((c) => c.unit)?.unit ?? "");
    return computeSeriesTile(levelSpec(datasetId, collection, measure, address, unit), ctx.context, cells);
  }, [plan, pending, failed, reads, profile, measure, datasetId, snapshot.id, snapshot.columns, collection, address]);

  if (failed) {
    const reason = failed.data && !failed.data.ok ? failed.data.reason : "error";
    return <QuietLine>{reason === "unavailable" ? AWAITS_UPDATE : "The series could not be read."}</QuietLine>;
  }
  if (!result) return <span className="block h-[17rem] animate-pulse rounded-md bg-muted/60" aria-label="Reading the series" />;
  if (!result.ok) return <QuietLine>{result.reason}</QuietLine>;

  // rows before the read were not read: "All" is not offered for such a series, and a range is drawn only whole
  const partial = fromEnd !== undefined && snapshot.loaded_rows > fromEnd;
  const shown = partial && range === "all" ? "10y" : range;
  if (partial && !holdsRange(result.points, shown))
    return (
      <QuietLine>
        The latest {count(result.points.length)} of {count(snapshot.loaded_rows)} records reach back to {result.points[0]?.label}, short of the{" "}
        {shown === "5y" ? "5" : "10"} years asked for. The records table holds every one.
      </QuietLine>
    );
  const points = lastYears(result.points, shown);
  const latest = result.points[result.points.length - 1];
  const gaps = result.gaps.count;
  return (
    <div className={cn(PANEL, "min-w-0 px-4 py-3")} data-section="Series">
      <p className="text-[13px] font-medium leading-5">{result.headline}</p>
      <p className="mb-2 text-[11px] leading-4 text-muted-foreground">
        {measure.label}, {result.plotUnit}.{" "}
        {partial ? `The latest ${count(result.points.length)} of ${count(snapshot.loaded_rows)} records, read from the end of the file` : `${count(result.points.length)} periods`},{" "}
        {result.points[0]?.label} to {result.asOf}
        {gaps ? `; ${count(gaps)} without a figure (${[result.gaps.markers ? `${count(result.gaps.markers)} marked` : null, result.gaps.empties ? `${count(result.gaps.empties)} empty` : null, result.gaps.texts ? `${count(result.gaps.texts)} as text` : null, result.gaps.nulls ? `${count(result.gaps.nulls)} missing` : null].filter(Boolean).join(", ")}), left out, never drawn as zero` : ""}.
      </p>
      {view === "chart" ? (
        <TileChart
          form="line"
          points={points}
          unit={result.plotUnit}
          label={`${measure.label}, ${result.plotUnit}`}
          recordHref={(row) => recordHref(datasetId, snapshot.id, row)}
          onOpen={(href) => {
            const row = rowOf(href);
            if (row !== null) onOpen(row);
          }}
        />
      ) : (
        <PointTable points={[...points].reverse()} unit={result.plotUnit} onOpen={onOpen} />
      )}
      {latest && (
        <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
          Latest: {latest.label}, record{" "}
          <button type="button" className="num underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onOpen(latest.row)}>
            {count(latest.row)}
          </button>
          . Every point opens the record behind it.
        </p>
      )}
    </div>
  );
}

/** The figures of a chart as a table, newest first, each row opening its record. */
export function PointTable({
  points,
  unit,
  onOpen,
  first = "Period",
}: {
  points: { key: string; label: string; text: string | null; display?: string; row: number }[];
  unit: string;
  onOpen: (row: number) => void;
  first?: string;
}) {
  return (
    <div className="max-h-none">
      <table className="w-full border-separate border-spacing-0 text-[13px]">
        <thead>
          <tr className="text-[11px] text-muted-foreground">
            <th scope="col" className="h-7 border-b px-1 text-left font-normal">
              {first}
            </th>
            <th scope="col" className="h-7 border-b px-1 text-right font-normal">
              {unit}
            </th>
            <th scope="col" className="h-7 border-b px-1 text-right font-normal">
              Record
            </th>
          </tr>
        </thead>
        <tbody>
          {points.slice(0, 60).map((p) => (
            <tr key={`${p.key}-${p.row}`} style={{ height: 29 }}>
              <td className="border-b px-1">{p.label}</td>
              <td className="num border-b px-1 text-right" title={p.text ?? "missing in the source"}>
                {p.display ?? p.text ?? "–"}
              </td>
              <td className="border-b px-1 text-right">
                <button type="button" onClick={() => onOpen(p.row)} className="num text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {count(p.row)}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {points.length > 60 && <QuietLine className="mt-1 text-[11px]">The latest 60 of {count(points.length)} periods; the records table holds every one.</QuietLine>}
    </div>
  );
}

/**
 * Several series of one table in one unit on one chart, as a profile lists them (`compareSeries`): each read and
 * checked as the series view reads one (the unit as the profile establishes it, periods by its format), drawn as a
 * board's compare tile, every point opening its record.
 */
export function CompareView({
  datasetId,
  collection,
  snapshot,
  profile,
  measure,
  series,
  range,
  view,
  onOpen,
}: {
  datasetId: string;
  collection: string;
  snapshot: SourceSnapshot;
  profile: Profile;
  measure: MeasureSpec;
  series: readonly CompareSeries[];
  range: "5y" | "10y" | "all";
  view: "chart" | "table";
  onOpen: (row: number) => void;
}) {
  const plans = useMemo(() => series.map((s) => seriesPlan(profile, snapshot.columns, measure, s.series)), [series, profile, snapshot.columns, measure]);
  const wanted = plans.flatMap((plan, k) => (plan.ok ? plan.positions.map((field) => ({ k, field, read: plan.read })) : []));
  const reads = useQueries({
    queries: wanted.map((w) => ({ ...sourceQueries.series({ datasetId, snapshotId: snapshot.id, field: w.field, address: w.read, limit: SERIES_LIMIT }) })),
  });
  const pending = reads.some((r) => r.isPending);
  const failed = reads.find((r) => r.isError || (r.data && !r.data.ok));
  const result: TileResult | null = useMemo(() => {
    const bad = plans.find((p) => !p.ok);
    if (bad && !bad.ok) return { ok: false, reason: bad.reason };
    if (pending || failed) return null;
    const ctx = tileContext(profile, measure, datasetId, snapshot.id, snapshot.columns);
    if (!ctx.ok) return { ok: false, reason: ctx.reason };
    const lines: LineInput[] = [];
    for (const [k, plan] of plans.entries()) {
      if (!plan.ok) return { ok: false, reason: plan.reason };
      const byPos = new Map<number, SourcePoint[]>();
      for (const [i, w] of wanted.entries()) {
        if (w.k !== k) continue;
        const data = reads[i].data && reads[i].data!.ok ? reads[i].data!.data : null;
        if (!data) return null;
        if (data.next !== null) return { ok: false, reason: `${series[k].label}: the series has more than ${count(SERIES_LIMIT)} records; the first look reads at most that many.` };
        byPos.set(w.field, data.points);
      }
      lines.push({ context: ctx.context, cells: seriesCells(profile, snapshot.columns, measure, plan, byPos) });
    }
    const unit = ctx.unit ?? lines.flatMap((l) => l.cells).find((c) => c.unit)?.unit ?? "";
    const spec: CompareTileSpec = {
      id: `look-compare:${datasetId}`,
      collection,
      datasetId,
      measure: measure.field,
      title: measure.label,
      subject: series[0].label,
      unit,
      decimals: 0,
      form: "compare",
      transform: "level",
      headline: "level",
      window: 100_000,
      lines: series.map((s) => ({ label: s.label, series: s.series })),
    };
    // printed as stored: no decimals are imposed on a table page
    return computeCompareTile({ ...spec, decimals: undefined as unknown as number }, lines);
  }, [plans, wanted, pending, failed, reads, profile, measure, datasetId, snapshot.id, snapshot.columns, series, collection]);

  if (failed) {
    const reason = failed.data && !failed.data.ok ? failed.data.reason : "error";
    return <QuietLine>{reason === "unavailable" ? AWAITS_UPDATE : "The series could not be read."}</QuietLine>;
  }
  if (!result) return <span className="block h-[17rem] animate-pulse rounded-md bg-muted/60 motion-reduce:animate-none" aria-label="Reading the series" />;
  if (!result.ok) return <QuietLine>{result.reason}</QuietLine>;
  if (result.shape?.kind !== "compare") return null;
  const lines = result.shape.lines.map((l) => ({ ...l, points: lastYears(l.points, range) }));
  return (
    <div className={cn(PANEL, "min-w-0 px-4 py-3")} data-section="Series compared">
      <p className="text-[13px] font-medium leading-5">{result.headline}</p>
      <p className="mb-2 text-[11px] leading-4 text-muted-foreground">
        {measure.label}, {result.plotUnit}. {series.length} series of this table, each read whole; a gap is never drawn as zero.
      </p>
      {view === "chart" ? (
        <CompareChart
          lines={lines}
          layout={result.shape.layout}
          label={`${measure.label}, ${result.plotUnit}, ${series.map((s) => s.label).join(", ")}`}
          recordHref={(_line, row) => recordHref(datasetId, snapshot.id, row)}
          onOpen={(href) => {
            const row = rowOf(href);
            if (row !== null) onOpen(row);
          }}
          height={240}
        />
      ) : (
        <PointTable points={[...lines[0].points].reverse()} unit={`${lines[0].label}, ${result.plotUnit}`} onOpen={onOpen} />
      )}
    </div>
  );
}
