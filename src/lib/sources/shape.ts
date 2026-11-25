/**
 * What kind of table a snapshot is, from facts only: which search dimensions it declares and,
 * where they were counted, how many distinct values each holds. No name, label or publisher
 * is looked at.
 *
 * - "panel": rows belong to entities (a bank, a plant, a series code), usually over periods.
 * - "places": rows belong to places and no entity is declared.
 * - "series": the only dimension is the period.
 * - "table": nothing varies that the store indexes (reference lists, dictionaries, tables whose
 *   dimensions were not declared), or there are no rows.
 */
import type { SourceIngest } from "./schema";

export type SourceShape = "series" | "panel" | "places" | "table";

export type ShapeFacts = {
  dims: { entity: boolean; geography: boolean; period: boolean };
  rows: number;
  /** Distinct values where counted. Null or absent means not counted, which is not zero. */
  entities?: number | null;
  periods?: number | null;
  geographies?: number | null;
};

/** A declared dimension varies unless a count says it holds at most one value. */
const varies = (declared: boolean, count: number | null | undefined) =>
  declared && (count == null || count > 1);

export function shapeOf(facts: ShapeFacts): SourceShape {
  if (!(facts.rows > 0)) return "table";
  if (varies(facts.dims.entity, facts.entities)) return "panel";
  if (varies(facts.dims.geography, facts.geographies)) return "places";
  if (varies(facts.dims.period, facts.periods)) return "series";
  return "table";
}

/**
 * The dimensions a snapshot fills from its own fields. A dimension set by a constant (one
 * period for the whole file, one source address) is the same on every row and is not counted
 * as declared here: it cannot tell two records apart.
 */
export function declaredDims(
  ingest: Pick<SourceIngest, "dimensions" | "composites"> | null | undefined,
): ShapeFacts["dims"] {
  const has = (name: keyof SourceIngest["dimensions"]) => typeof ingest?.dimensions?.[name] === "number";
  return {
    entity: has("entity_id") || has("entity_name"),
    geography: has("geo_code") || has("geo_name"),
    period: has("period") || !!ingest?.composites?.period,
  };
}

/** Plural words for a shape, for filters and legends. */
export const SHAPE_LABEL: Record<SourceShape, string> = {
  series: "Series",
  panel: "Panels",
  places: "By place",
  table: "Reference",
};
