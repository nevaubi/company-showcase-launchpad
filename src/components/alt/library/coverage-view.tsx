import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { fieldRoles } from "@/lib/sources/fields";
import type { PeriodFormat } from "@/lib/sources/periods";
import { sourceQueries } from "@/lib/sources/queries";
import type { SourceEntities, SourceFacetDimension, SourceFieldFill } from "@/lib/sources/read-types";
import type { SourceSnapshot } from "@/lib/sources/schema";
import { cn } from "@/lib/utils";
import { CATEGORY_READ_ROWS, categoryCandidates, categoryCharts } from "./counts/category-model";
import { basisLine, cappedLine } from "./counts/stored-counts";
import { EntityListPanel, EntityPanel, PlacePanel } from "./counts/dimension-panels";
import { PanelNote, PanelSkeleton } from "./counts/panel";
import { PeriodPanel, PeriodPanelSkeleton } from "./counts/period-panel";
import { countQueries } from "./counts/queries";
import { CategoryPanel, FillPanel } from "./counts/value-panels";
import { readData } from "./dataset-queries";
import { QuietLine } from "./ui/primitives";

/** The last chart of the grid takes the columns its row leaves free, so no row ends in an empty frame. */
function lastSpan(cells: number): string {
  const two = cells > 1 && cells % 2 === 1 ? "@3xl:col-span-2" : "";
  const three = cells > 2 ? (cells % 3 === 1 ? "@6xl:col-span-3" : cells % 3 === 2 ? "@6xl:col-span-2" : "@6xl:col-span-1") : "";
  return cn(two, three);
}

/** Shown wherever counts need the next database update (migration 0069). */
export const AWAITS_UPDATE = "Counts by period and by entity arrive with the next database update.";

const n = (v: number) => v.toLocaleString("en-US");
/** Height of a ranked list of ten bars and a remainder (29 px a bar with its gap), for the skeleton. */
const BARS_HEIGHT = 11 * 32;

/**
 * "What this table holds": the first look of a table no profile can chart, in charts that count records and need no
 * unit. Records per period (columns), records by place (the state grid where the place field holds states), records
 * per entity, records by category for the fields whose values repeat (from the field counts stored with the version
 * at any size, or counted on request on tables of up to 5,000 records; each chart says which), and how complete each
 * field is (a heat strip from the counts stored with the version). Nothing here reads a cell as a number; every mark
 * opens the records behind it.
 */
export function CoverageView({
  datasetId,
  snapshot,
  fills,
  format,
  entities,
  entityNoun,
  varies,
  view,
  onPeriod,
  onEntity,
  onGeography,
  onOpen,
}: {
  datasetId: string;
  snapshot: SourceSnapshot;
  fills: SourceFieldFill[] | null;
  /** The fields shown in the records table (kept for the caller; every field is in the strip). */
  columns: number[];
  format: PeriodFormat;
  entities: SourceEntities | null | undefined;
  entityNoun: { one: string; many: string } | null;
  varies: { entity: boolean; geo: boolean; period: boolean };
  view: "chart" | "table";
  onPeriod: (period: string) => void;
  onEntity: (entity: string) => void;
  /** Filters the records table to a place; without it the place marks open nothing. */
  onGeography?: (geography: string) => void;
  /** Opens one record; without it the category bars open nothing. */
  onOpen?: (row: number) => void;
}) {
  const dims = snapshot.ingest.dimensions ?? {};
  const entityDim: SourceFacetDimension | null = dims.entity_id !== undefined ? "entity_id" : dims.entity_name !== undefined ? "entity_name" : null;
  const placeDim: SourceFacetDimension | null = dims.geo_code !== undefined ? "geo_code" : dims.geo_name !== undefined ? "geo_name" : null;

  const periodQuery = useQuery({ ...countQueries.facets(datasetId, snapshot.id, "period"), enabled: varies.period });
  const entityQuery = useQuery({ ...countQueries.facets(datasetId, snapshot.id, entityDim ?? "entity_id"), enabled: entityDim !== null });
  const placeQuery = useQuery({ ...countQueries.facets(datasetId, snapshot.id, placeDim ?? "geo_code"), enabled: placeDim !== null });
  const statsQuery = useQuery({ ...sourceQueries.stats(datasetId, snapshot.id), enabled: entityDim !== null });

  const roles = useMemo(() => fieldRoles(snapshot.columns, snapshot.ingest), [snapshot.columns, snapshot.ingest]);
  const candidates = useMemo(() => categoryCandidates(snapshot.columns, snapshot.ingest, roles, fills), [snapshot.columns, snapshot.ingest, roles, fills]);
  const small = snapshot.loaded_rows <= CATEGORY_READ_ROWS;
  // at any size: the server answers from the counts stored with the version, or counts a small table's records
  const categoryQuery = useQuery({ ...countQueries.categories(datasetId, snapshot.id, candidates), enabled: candidates.length > 0 });

  const periods = readData(periodQuery.data);
  const ents = readData(entityQuery.data);
  const places = readData(placeQuery.data);
  const stats = readData(statsQuery.data);
  const counted = readData(categoryQuery.data);
  const charts = useMemo(() => {
    if (!counted.data) return [];
    // where the counts come from, on every chart (an answer without it was counted from the records)
    const line = basisLine(counted.data.counted ?? { from: "records", records: snapshot.loaded_rows });
    return categoryCharts(counted.data.fields, snapshot.columns).map((c) => ({ ...c, caption: `${c.caption} ${line}` }));
  }, [counted.data, snapshot.columns, snapshot.loaded_rows]);

  const notes: string[] = [];
  const constant = snapshot.ingest.constants?.period;
  if (!varies.period)
    notes.push(
      typeof constant === "string"
        ? `Every record is of one period, ${constant} as the source writes it, so the records are not counted by period.`
        : "No period field: the records are not counted by period.",
    );
  if (!small && candidates.length > 0 && counted.reason === "invalid")
    notes.push(
      `Values inside the fields are counted on tables of up to ${n(CATEGORY_READ_ROWS)} records and on larger ones whose counts are stored with the version; this one holds ${n(snapshot.loaded_rows)} and has none stored yet.`,
    );
  else if (candidates.length > 0 && (counted.reason || categoryQuery.isError)) notes.push("The values of this table's fields could not be counted.");
  else if (counted.data && !charts.length && candidates.length > 0)
    notes.push(`None of the ${n(candidates.length)} ${candidates.length === 1 ? "field" : "fields"} counted holds a few values that repeat, so no field is drawn by category.`);
  const capped = counted.data?.capped?.length ? cappedLine(counted.data.capped, candidates.length) : null;
  if (capped) notes.push(capped);

  const failed = (reason: string | null, what: string) => (reason === "unavailable" ? AWAITS_UPDATE : `${what} could not be counted.`);
  const gridCells: ReactNode[] = [];

  // a dimension that holds one value is said in a line, not drawn as one bar
  const only = (read: { data: { values: { value: string; label: string | null }[]; complete: boolean } | null }) =>
    read.data && read.data.complete && read.data.values.length === 1 ? read.data.values[0] : null;
  const onePlace = only(places);
  const oneEntity = only(ents);
  const named = (v: { value: string; label: string | null }) => (v.label && v.label !== v.value ? `${v.label} (${v.value})` : v.value);
  if (onePlace) notes.push(`Every record is of one place, ${named(onePlace)}.`);
  if (oneEntity) notes.push(`Every record is of one ${entityNoun?.one ?? "entity"}, ${named(oneEntity)}.`);

  if (placeDim && !onePlace) {
    if (placeQuery.isPending) gridCells.push(<PanelSkeleton key="place" name="Records by place" title="Records by place" height={BARS_HEIGHT} />);
    else if (places.data) gridCells.push(<PlacePanel key="place" facets={places.data} view={view} onGeography={onGeography} />);
    else gridCells.push(<PanelNote key="place" name="Records by place" title="Records by place">{failed(places.reason, "Records by place")}</PanelNote>);
  }
  if (entityDim && !oneEntity) {
    const title = `Records per ${entityNoun?.one ?? "entity"}`;
    if (entityQuery.isPending) gridCells.push(<PanelSkeleton key="entity" name="Records per entity" title={title} height={BARS_HEIGHT} />);
    else if (ents.data)
      gridCells.push(<EntityPanel key="entity" facets={ents.data} noun={entityNoun} total={stats.data?.entities ?? null} view={view} onEntity={onEntity} />);
    else if (entities) gridCells.push(<EntityListPanel key="entity" entities={entities} noun={entityNoun} onEntity={onEntity} />);
    else gridCells.push(<PanelNote key="entity" name="Records per entity" title={title}>{failed(ents.reason, title)}</PanelNote>);
  }
  // a placeholder only where charts will come (a small table is counted on request); a large table's stored counts
  // are one quick select that may find none, and a placeholder that then goes would move the page
  if (small && candidates.length > 0 && categoryQuery.isPending)
    gridCells.push(<PanelSkeleton key="cat-loading" name="Records by category" title="Records by category" height={BARS_HEIGHT} />);
  for (const chart of charts) gridCells.push(<CategoryPanel key={`cat-${chart.position}`} chart={chart} view={view} onOpen={onOpen} />);
  // a short dictionary's strip sits beside the other charts when they leave a cell free; a long one takes the width
  const fillInGrid = snapshot.columns.length <= 60 && gridCells.length % 2 === 1 && gridCells.length < 3;
  if (fillInGrid) gridCells.push(<FillPanel key="fill" fills={fills} columns={snapshot.columns} view={view} />);

  return (
    <div className="grid min-w-0 grid-cols-1 gap-3" data-section="What this table holds">
      {notes.length > 0 && <QuietLine>{notes.join(" ")}</QuietLine>}
      {varies.period &&
        (periodQuery.isPending ? (
          <PeriodPanelSkeleton />
        ) : periods.data ? (
          <PeriodPanel facets={periods.data} format={format} total={snapshot.loaded_rows} view={view} onPeriod={onPeriod} />
        ) : (
          <PanelNote name="Records per period" title="Records per period">{failed(periods.reason, "Records per period")}</PanelNote>
        ))}
      {gridCells.length > 0 && (
        <div className={cn("grid min-w-0 grid-cols-1 gap-3", gridCells.length > 1 && "@3xl:grid-cols-2", gridCells.length > 2 && "@6xl:grid-cols-3")}>
          {gridCells.map((cell, i) => (
            <div key={i} className={cn("grid min-w-0 grid-cols-1", i === gridCells.length - 1 && lastSpan(gridCells.length))}>
              {cell}
            </div>
          ))}
        </div>
      )}
      {!fillInGrid && <FillPanel fills={fills} columns={snapshot.columns} view={view} />}
    </div>
  );
}
