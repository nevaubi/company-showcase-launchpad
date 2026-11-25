import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { TileChart } from "@/components/alt/library/boards/tile-chart";
import { Segmented } from "@/components/app/segmented";
import { computeRankTile } from "@/lib/sources/boards/compute";
import type { TileResult } from "@/lib/sources/boards/types";
import { recordHref } from "@/lib/sources/links";
import { locateField, type MeasureSpec, type Profile } from "@/lib/sources/profiles";
import { sourceQueries } from "@/lib/sources/queries";
import type { SourceSnapshot } from "@/lib/sources/schema";
import { cn } from "@/lib/utils";
import { AWAITS_UPDATE } from "./coverage-view";
import { count } from "./dataset-model";
import { readData } from "./dataset-queries";
import { rankCells, rankSpec, tileContext } from "./first-look-model";
import { PointTable, rowOf } from "./series-view";
import { PANEL, QuietLine } from "./ui/primitives";
import { UsTileMap } from "@/components/alt/us-tile-map";

/** Codes the tile map draws: the states, DC and Puerto Rico. */
const STATE_CODES = new Set(
  "AK AL AR AZ CA CO CT DC DE FL GA HI IA ID IL IN KS KY LA MA MD ME MI MN MO MS MT NC ND NE NH NJ NM NV NY OH OK OR PA PR RI SC SD TN TX UT VA VT WA WI WV WY".split(" "),
);

/**
 * The latest period across entities or places, ranked by the measure, bars from zero. Only a whole period is
 * ranked: a period with more records than one read returns is refused, never ranked as a part.
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
  /** Places: a state tile map beside the bars when every key is a US state or territory code. */
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
  const field = locateField(snapshot.columns, measure.field);
  const by = profile.addressing.by ?? "entity_id";
  const query = useQuery({
    ...sourceQueries.crossSection({ datasetId, snapshotId: snapshot.id, field: field.ok ? field.index : 0 }),
    enabled: field.ok,
  });
  const read = readData(query.data);
  const result: TileResult | null = useMemo(() => {
    if (!field.ok) return { ok: false, reason: `The field ${measure.field} is not in this version as the profile expects.` };
    if (!read.data) return null;
    if (!read.data.complete) return { ok: false, reason: "The last period has more than 1,000 records; a part is never ranked as the whole." };
    const ctx = tileContext(profile, measure, datasetId, snapshot.id, snapshot.columns);
    if (!ctx.ok) return { ok: false, reason: ctx.reason };
    const unit = ctx.unit ?? "";
    const plural = profile.entityNoun?.many ?? (by.startsWith("geo") ? "places" : "entities");
    return computeRankTile(rankSpec(datasetId, collection, measure, by, unit, top, plural), ctx.context, rankCells(read.data, by));
  }, [field, read.data, profile, measure, datasetId, snapshot.id, snapshot.columns, collection, by, top]);

  if (query.isError || read.reason) return <QuietLine>{read.reason === "unavailable" ? AWAITS_UPDATE : "The last period could not be read."}</QuietLine>;
  if (!result) return <span className="block h-[22rem] animate-pulse rounded-md bg-muted/60" aria-label="Reading the last period" />;
  if (!result.ok) return <QuietLine>{result.reason}</QuietLine>;
  const noun = profile.entityNoun?.many ?? (by.startsWith("geo") ? "places" : "entities");
  const states = result.points.length > 0 && result.points.every((p) => STATE_CODES.has(p.key));
  return (
    <div className={cn(PANEL, "min-w-0 px-4 py-3")} data-section="Ranking">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium leading-5">{result.headline}</p>
          <p className="text-[11px] leading-4 text-muted-foreground">
            {measure.label}, {result.unit}, {result.asOf}. The {Math.min(top, result.points.length)} largest of {count(read.data?.rows.length ?? 0)} {noun} in the period
            {result.gaps.count ? `; ${count(result.gaps.count)} without a figure are left out` : ""}.
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
      <div className={cn("mt-2 grid min-w-0 grid-cols-1 gap-4", map && states && "@5xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]")}>
        {map && states && view === "chart" && (
          <UsTileMap
            values={Object.fromEntries(result.points.flatMap((p) => (p.value === null ? [] : [[p.key, p.value] as const])))}
            scale="linear"
            title={(st) => {
              const p = result.points.find((x) => x.key === st);
              return p ? `${p.label}: ${p.text} ${result.plotUnit}, ${result.asOf}` : `${st}: not among the ${top} shown`;
            }}
            onSelect={(st) => {
              const p = result.points.find((x) => x.key === st);
              if (p) onOpen(p.row);
            }}
          />
        )}
        {view === "chart" ? (
          <TileChart
            form="ranked-bars"
            points={result.points}
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
