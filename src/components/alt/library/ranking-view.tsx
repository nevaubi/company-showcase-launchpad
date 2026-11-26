import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { RANK_STACKED_ROW } from "@/components/alt/library/boards/ranked-layout";
import { TILE_CHART_HEIGHT, TileChart } from "@/components/alt/library/boards/tile-chart";
import { StateGrid } from "@/components/alt/library/charts/state-grid";
import { Segmented } from "@/components/app/segmented";
import { getLookCross, type LookCrossRead } from "@/lib/sources/boards/board.functions";
import { computeRankTile, type TileContext } from "@/lib/sources/boards/compute";
import { computeMapTile } from "@/lib/sources/boards/compute-forms";
import type { TileResult } from "@/lib/sources/boards/types";
import { recordHref } from "@/lib/sources/links";
import { cadenceOf, type MeasureSpec, type Profile } from "@/lib/sources/profiles";
import type { SourceSnapshot } from "@/lib/sources/schema";
import { cn } from "@/lib/utils";
import { count } from "./dataset-model";
import { mapSpec, rankSpec, snapshotHasPeriod, tileContext } from "./first-look-model";
import { PointTable, rowOf } from "./series-view";
import { PANEL, QuietLine } from "./ui/primitives";

/** The table page's read of one period, cached per snapshot like the boards' reads. */
export const lookCrossQuery = (input: { datasetId: string; snapshotId: string; field: string; by: "entity_id" | "entity_name" | "geo_code" | "geo_name"; period: string }) => ({
  queryKey: ["source-look-cross", input.datasetId, input.snapshotId, input.field, input.by, input.period] as const,
  queryFn: () => getLookCross({ data: input }) as Promise<LookCrossRead>,
  staleTime: Infinity,
  retry: false,
});

/**
 * The latest period across entities or places, ranked by the measure, bars from zero: the greatest period of the
 * profile's declared format (a publisher's footer stored as a record is passed over and counted), read in up to five
 * pages and ranked only when whole; a table without periods is read whole (up to 5,000 records) and dated by its
 * retrieval. A place stored by its state code alone is named from the code. With `map`, places that are US states are
 * also drawn on the state grid beside the bars.
 */
export function RankingView({
  datasetId,
  collection,
  snapshot,
  profile,
  measure,
  top,
  setTop,
  view,
  onOpen,
  map = false,
}: {
  /** Places: the state grid beside the bars when the places are US states by one rule. */
  map?: boolean;
  datasetId: string;
  collection: string;
  snapshot: SourceSnapshot;
  profile: Profile;
  measure: MeasureSpec;
  top: 15 | 40;
  setTop: (n: 15 | 40) => void;
  view: "chart" | "table";
  onOpen: (row: number) => void;
}) {
  const by = profile.addressing.by ?? "entity_id";
  const periodic = snapshotHasPeriod(snapshot.ingest);
  const query = useQuery(lookCrossQuery({ datasetId, snapshotId: snapshot.id, field: measure.field, by, period: periodic ? "latest" : "table" }));
  const read = query.data;
  const plural = profile.entityNoun?.many ?? (by.startsWith("geo") ? "places" : "entities");
  const computed: { rank: TileResult; map: TileResult | null; context: TileContext } | { failed: string } | null = useMemo(() => {
    if (!read) return null;
    if (!read.ok) return { failed: read.reason };
    const ctx = tileContext(profile, measure, datasetId, snapshot.id, snapshot.columns);
    if (!ctx.ok) return { failed: ctx.reason };
    const format = read.data.format ?? ctx.context.format;
    const composedCadence = format === "quarter" ? "quarter" : format === "year" ? "year" : cadenceOf(profile);
    const context: TileContext = { ...ctx.context, format, cadence: read.data.format && read.data.format !== ctx.context.format ? composedCadence : ctx.context.cadence };
    const unit = ctx.unit ?? read.data.cells.find((c) => c.unit)?.unit ?? "";
    const table = read.data.table ? { retrieved: read.data.retrieved ?? "an unknown day" } : undefined;
    const rank = computeRankTile(rankSpec(datasetId, collection, measure, by, unit, top, plural), context, read.data.cells, table);
    const mapResult = map ? computeMapTile(mapSpec(datasetId, collection, measure, by, unit, plural), context, read.data.cells, null, table) : null;
    return { rank, map: mapResult && mapResult.ok ? mapResult : null, context };
  }, [read, profile, measure, datasetId, snapshot.id, snapshot.columns, collection, by, top, plural, map]);

  if (query.isError) return <QuietLine>The last period could not be read.</QuietLine>;
  if (!computed) return <span className="block h-[22rem] animate-pulse rounded-md bg-muted/60 motion-reduce:animate-none" aria-label="Reading the last period" />;
  if ("failed" in computed) return <QuietLine>{computed.failed}</QuietLine>;
  const result = computed.rank;
  if (!result.ok) return <QuietLine>{result.reason}</QuietLine>;
  const grid = computed.map && computed.map.ok && computed.map.shape?.kind === "map" ? computed.map : null;
  const skipped = read && read.ok ? read.data.skipped : [];
  const records = read && read.ok ? read.data.cells.length : 0;
  return (
    <div className={cn(PANEL, "@container min-w-0 px-4 py-3")} data-section="Ranking">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium leading-5">{result.headline}</p>
          <p className="text-[11px] leading-4 text-muted-foreground">
            {measure.label}, {result.unit}, {result.asOf}. The {Math.min(top, result.points.length)} {result.headline.includes("smallest") ? "smallest" : "largest"} of {count(records)} {plural} in the period
            {result.gaps.count ? `; ${count(result.gaps.count)} without a figure are left out` : ""}.
            {skipped.length ? ` ${skipped.map((s) => `${s.atLeast ? "At least " : ""}${count(s.records)} ${s.records === 1 ? "record" : "records"} whose period reads "${s.period.slice(0, 60)}" ${s.records === 1 ? "is" : "are"} not a period of the declared format and left out.`).join(" ")}` : ""}
            {result.sourceNote ? ` ${result.sourceNote}` : ""}
          </p>
        </div>
        <Segmented
          label="Bars shown"
          size="xs"
          value={String(top) as "15" | "40"}
          onChange={(v) => setTop(v === "40" ? 40 : 15)}
          options={[
            { v: "15", l: "Top 15" },
            { v: "40", l: "Top 40" },
          ]}
        />
      </div>
      <div className={cn("mt-2 grid min-w-0 grid-cols-1 gap-4", grid && view === "chart" && "@4xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]")}>
        {grid && view === "chart" && grid.shape?.kind === "map" && (
          <div className="min-w-0" data-section="State grid">
            <StateGrid
              places={grid.shape.places}
              territories={grid.shape.territories}
              scale="sequential"
              domain={grid.shape.domain}
              rangeLabels={[
                grid.points[grid.points.length - 1]?.display ?? "–",
                grid.points[0]?.display ?? "–",
              ]}
              unit={grid.plotUnit}
              period={grid.asOf}
              label={`${measure.label} by state, ${grid.asOf}`}
              onOpen={(p) => (p.row !== null ? onOpen(p.row) : undefined)}
            />
            {grid.shape.missing.length > 0 && (
              <p className="mt-1 text-[11px] text-muted-foreground">No figure: {grid.shape.missing.map((m) => m.name).join(", ")}.</p>
            )}
          </div>
        )}
        {view === "chart" ? (
          <TileChart
            form="ranked-bars"
            points={result.points}
            // a row a bar, as many as the ranking shows (15 or 40), never squeezed into a board tile's height
            height={Math.max(TILE_CHART_HEIGHT, RANK_STACKED_ROW * result.points.length)}
            unit={result.plotUnit}
            label={`${measure.label}, ${result.plotUnit}, ${result.asOf}`}
            recordHref={(row) => recordHref(datasetId, snapshot.id, row)}
            onOpen={(href) => {
              const row = rowOf(href);
              if (row !== null) onOpen(row);
            }}
          />
        ) : (
          <PointTable points={result.points} unit={result.plotUnit} onOpen={onOpen} first="Name" />
        )}
      </div>
    </div>
  );
}
