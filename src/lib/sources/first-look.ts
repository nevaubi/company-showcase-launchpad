/**
 * Tier 1 of a table's first look: the pictures every published table can have without
 * parsing a single cell (DESIGN.md, ux.md Screen 4 "Coverage"). Pure: it plans which views a
 * table gets from its shape and declared dimensions and which read draws each one, and it
 * shapes the answers into bars and lists. Tier 2 (a measure over time, a ranking, a map) needs
 * a reviewed profile and lives in `profiles/` and `boards/` (unit `boards`).
 *
 * What is counted here is records (rows of the snapshot), never the values inside them, so a
 * sum of records per period over a year is a count of records in that year and nothing more.
 * Facet counts need migration 0069; until it is applied each view names a simpler read that
 * works today, and the screen shows that form or one quiet line.
 */
import { comparePeriods, formatPeriod, parsePeriod, type PeriodFormat } from "./periods";
import { fieldCompleteness, type SourceEntitiesQueryInput, type SourceFacetDimension, type SourceFacetValue, type SourceFacetsQueryInput, type SourceFieldFill } from "./read-types";
import { declaredDims, shapeOf, type SourceShape } from "./shape";
import { fieldRoles } from "./fields";
import type { SourceSnapshot } from "./schema";

/** A read of `queries.ts`: `read` names the `sourceQueries` factory (facets and entities take `args`, periodRange and completeness take its dataset and snapshot ids). */
export type FirstLookRead =
  | { read: "facets"; args: SourceFacetsQueryInput }
  | { read: "periodRange"; args: { datasetId: string; snapshotId: string } }
  | { read: "entities"; args: SourceEntitiesQueryInput }
  | { read: "completeness"; args: { datasetId: string; snapshotId: string } };

export type FirstLookKind = "records-per-period" | "entities" | "places" | "fields";

export type FirstLookView = {
  kind: FirstLookKind;
  title: string;
  /** The read that draws the full view. */
  read: FirstLookRead;
  /** The simpler form when `read` answers `unavailable` (0069 not applied), or null when `read` works today. */
  fallback: FirstLookRead | null;
  /** For "fields": the positions whose filled share is shown, in order. */
  positions?: number[];
};

export type FirstLookPlan = {
  shape: SourceShape;
  /** In reading order. Every table has at least the fields view. */
  views: FirstLookView[];
  /** The one-line "Records per period" strip a tier 2 form shows under itself; null without a period. */
  strip: FirstLookView | null;
  /** Fields the dictionary alone types as quantities (a numeric native type and a quantity unit). */
  dictionaryQuantities: number;
  /** One quiet line for under the views, true for this table. */
  note: string;
};

/** Facet values asked for per view. The read allows 1 to 1,000; more continue with `nextAfter`. */
export const FIRST_LOOK_FACET_LIMIT = 1000;
/** Bars of "Records per period" before they are grouped by year. */
export const MAX_PERIOD_BARS = 60;
/** Entries of the "Entities" and "Places" lists. */
export const TOP_ENTRIES = 10;

type SnapshotFacts = Pick<SourceSnapshot, "id" | "loaded_rows" | "columns" | "ingest">;

export function firstLook(input: {
  datasetId: string;
  snapshot: SnapshotFacts;
  /** Distinct counts when known (snapshot statistics); absent means not counted. */
  entities?: number | null;
  periods?: number | null;
  geographies?: number | null;
  /** The fields the records table opens on (`defaultFields`); the fields view shows these. */
  fields?: readonly number[];
}): FirstLookPlan {
  const { datasetId, snapshot } = input;
  const pinned = { datasetId, snapshotId: snapshot.id };
  const has = (name: keyof SourceSnapshot["ingest"]["dimensions"]) => typeof snapshot.ingest.dimensions?.[name] === "number";
  const dims = declaredDims(snapshot.ingest);
  const shape = shapeOf({ dims, rows: snapshot.loaded_rows, entities: input.entities, periods: input.periods, geographies: input.geographies });
  const facets = (dimension: SourceFacetDimension): FirstLookRead => ({
    read: "facets",
    args: { ...pinned, dimension, limit: FIRST_LOOK_FACET_LIMIT },
  });

  const perPeriod: FirstLookView | null = dims.period
    ? { kind: "records-per-period", title: "Records per period", read: facets("period"), fallback: { read: "periodRange", args: pinned } }
    : null;
  const entities: FirstLookView | null = dims.entity
    ? {
        kind: "entities",
        title: "Entities by records",
        read: facets(has("entity_id") ? "entity_id" : "entity_name"),
        fallback: { read: "entities", args: { ...pinned, dimension: "entity" } },
      }
    : null;
  const places: FirstLookView | null = dims.geography
    ? {
        kind: "places",
        title: "Places by records",
        read: facets(has("geo_code") ? "geo_code" : "geo_name"),
        fallback: { read: "entities", args: { ...pinned, dimension: "geo" } },
      }
    : null;
  const positions = (input.fields ?? snapshot.columns.map((_, i) => i).slice(0, 8)).filter(
    (p) => Number.isInteger(p) && p >= 0 && p < snapshot.columns.length,
  );
  const fields: FirstLookView = {
    kind: "fields",
    title: "Filled share per field",
    read: { read: "completeness", args: pinned },
    fallback: null,
    positions,
  };

  // What varies leads: a panel opens on its entities, a place table on its places, a series on its periods.
  // A dimension a count shows holds one value gets no view: one bar or one entry says nothing.
  const periodVaries = !!perPeriod && !(input.periods != null && input.periods <= 1);
  const placesVary = !!places && !(input.geographies != null && input.geographies <= 1);
  const views: FirstLookView[] = [];
  if (shape === "panel" && entities) views.push(entities);
  if ((shape === "panel" || shape === "places") && places && placesVary) views.push(places);
  if (shape !== "table" && perPeriod && periodVaries) views.push(perPeriod);
  views.push(fields);

  const dictionaryQuantities = fieldRoles(snapshot.columns, snapshot.ingest).filter((role) => role === "quantity").length;
  const note =
    snapshot.loaded_rows === 0
      ? "This snapshot holds no records."
      : dictionaryQuantities === 0
        ? "No field of this table states a numeric type and unit, so values are shown as published."
        : "No reviewed profile names a measure of this table yet, so values are shown as published.";
  return { shape, views, strip: periodVaries ? perPeriod : null, dictionaryQuantities, note };
}

export type PeriodBar = {
  /** As a reader says it ("Oct 2026", "Q3 2026", "2026"), or the stored text. */
  label: string;
  /** The stored period text when the label differs from it. */
  title?: string;
  /** Records of the period, or of every period of the year. */
  rows: number;
  /** False when a count is a floor (the facet read stopped at its scan limit). */
  exact: boolean;
  /** The stored period strings the bar counts, oldest first. */
  periods: string[];
};

/**
 * "Records per period" from the period facet: one bar per period, oldest first, when there
 * are at most `maxBars`; otherwise one bar per calendar year when the declared or detected
 * format reads the periods as dates; otherwise no bars (the screen states how many periods
 * there are instead of drawing an unreadable strip). Text that does not parse under the
 * format is never placed on the time axis: it is counted in `unplaced`.
 */
export function recordsPerPeriod(
  values: readonly SourceFacetValue[],
  format: PeriodFormat,
  options?: { maxBars?: number },
): { bars: PeriodBar[]; grouping: "period" | "year" | "none"; unplaced: number } {
  const maxBars = options?.maxBars ?? MAX_PERIOD_BARS;
  const sorted = [...values].sort((a, b) => comparePeriods(a.value, b.value, format));
  if (sorted.length <= maxBars)
    return {
      bars: sorted.map((v) => {
        const shown = formatPeriod(v.value, format);
        return { label: shown.text, ...(shown.title ? { title: shown.title } : {}), rows: v.rows, exact: v.exact, periods: [v.value] };
      }),
      grouping: "period",
      unplaced: 0,
    };
  if (format === "text") return { bars: [], grouping: "none", unplaced: 0 };
  const years = new Map<string, PeriodBar>();
  let unplaced = 0;
  for (const v of sorted) {
    const parsed = parsePeriod(v.value, format);
    if (!parsed) {
      unplaced++;
      continue;
    }
    const year = parsed.start.slice(0, 4);
    const bar = years.get(year) ?? { label: year, rows: 0, exact: true, periods: [] };
    bar.rows += v.rows;
    bar.exact = bar.exact && v.exact;
    bar.periods.push(v.value);
    years.set(year, bar);
  }
  return { bars: [...years.values()], grouping: "year", unplaced };
}

/**
 * The entities or places with the most records, most first; ties in code-point order of the
 * stored value, so every reader sees one order. A count that is a floor stays marked.
 */
export function topByRecords(values: readonly SourceFacetValue[], n = TOP_ENTRIES): SourceFacetValue[] {
  return [...values]
    .sort((a, b) => b.rows - a.rows || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0))
    .slice(0, Math.max(0, n));
}

/**
 * Filled share of the given fields, from the snapshot's own blank counts
 * (`quality.blank_counts_by_column`, on every live snapshot): no records are read. Null when
 * the counts are missing or do not match the dictionary.
 */
export function filledShares(
  snapshot: Pick<SourceSnapshot, "columns" | "loaded_rows" | "quality">,
  positions: readonly number[],
): SourceFieldFill[] | null {
  const all = fieldCompleteness(snapshot);
  if (!all) return null;
  return positions.filter((p) => p >= 0 && p < all.length).map((p) => all[p]);
}
