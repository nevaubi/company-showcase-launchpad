/**
 * Result shapes of the official-dataset reads (unit `reads`). Every read answers `SourceRead<T>`; a failure is
 * data, not an exception, so a screen can fall back ("unavailable" means the database does not have the
 * function yet, which is normal until migration 0069 is applied).
 *
 * Cells are the publisher's own strings, exactly as stored: '' is a blank cell, null is a declared null marker
 * (no published snapshot declares one today), and nothing in this layer parses, rescales or infers. Unit and
 * scale come from the snapshot's field dictionary and describe the strings; they are not an instruction.
 *
 * Row numbers are the 1-based `row_number` of the stored file. A snapshot is immutable once published, so
 * (dataset id, snapshot id, row, field position) addresses one cell for good.
 */
import { z } from "zod";
import type { SourceColumn, SourceDimension, SourceRecord } from "./schema";

export type SourceReadFailure = "unavailable" | "not-found" | "invalid" | "timeout" | "error";
/**
 * - `unavailable`: the database function does not exist yet (PostgREST `PGRST202` or Postgres `42883`). Normal before 0069.
 * - `not-found`: no published dataset, snapshot or row by that address (or the snapshot is not the dataset's).
 * - `invalid`: the request is well formed but not allowed on this snapshot (a field that is not in the dictionary,
 *   a cell filter on a snapshot over 50,000 rows). The message says which.
 * - `timeout`: the database cut the statement (member calls stop at 8 s).
 * - `error`: anything else; the message is the database's.
 */
export type SourceRead<T> = { ok: true; data: T } | { ok: false; reason: SourceReadFailure; message: string };

export const readOk = <T>(data: T): SourceRead<T> => ({ ok: true, data });
export const readFail = <T = never>(reason: SourceReadFailure, message: string): SourceRead<T> => ({ ok: false, reason, message });

/** The bounds every direct read keeps (COMMON4b section 2). */
export const READ_LIMITS = {
  /** Rows per select. */
  page: 1000,
  /** Selects per server call. */
  pages: 5,
  /** Snapshots above this many rows refuse a filter on a cell inside `values`. */
  cellFilterRows: 50_000,
  /** Cell filters per call. */
  cellFilters: 4,
} as const;

/** The snapshot a read used. Immutable once published, so every figure traces to it. */
export type SourceSnapshotRef = {
  datasetId: string;
  snapshotId: string;
  /** When this snapshot became the published copy (ISO 8601). */
  publishedAt: string | null;
  /** When the file was retrieved from the publisher (ISO 8601). Not when the publisher last revised the data. Null on 11 early snapshots. */
  retrievedAt: string | null;
  /** SHA-256 of the stored source file. */
  fileSha256: string;
  /** Rows in the snapshot, exact. */
  rows: number;
  /** Fields in the snapshot's dictionary, exact. */
  fields: number;
};

/** A field of the dictionary with its zero-based position in `values`. */
export type SourceFieldInfo = SourceColumn & { position: number };

/** A filter on one cell: exact string equality with the stored text ('' matches a blank cell). */
export type SourceCellMatch = { field: number | string; value: string };
/** The same filter after the field was checked against the dictionary. */
export type SourceResolvedMatch = { position: number; key: string; value: string };

export type SourceSeriesKey = "entity_id" | "entity_name" | "geo_code" | "geo_name";
/**
 * How one series is picked out of a snapshot:
 * - `{ by, key }`: the rows whose dimension equals the key (indexed); `where` narrows further (snapshots of at most 50,000 rows).
 * - `{ whole: true }`: the snapshot is one series; rows in file order.
 * - `{ where }`: rows whose cells equal the given strings; only on snapshots of at most 50,000 rows.
 */
export type SourceSeriesAddress =
  | { by: SourceSeriesKey; key: string; where?: SourceCellMatch[] }
  | { whole: true }
  | { where: SourceCellMatch[] };

// ---------------------------------------------------------------- getSourceRecord

export type SourceRecordQueryInput = { datasetId: string; snapshotId?: string; row: number };
/** One whole record with every field and the snapshot's dictionary (same order as `record.values`). */
export type SourceRecordRead = { snapshot: SourceSnapshotRef; columns: SourceColumn[]; record: SourceRecord };

// ---------------------------------------------------------------- getSourceSeries

export type SourceSeriesQueryInput = {
  datasetId: string;
  snapshotId?: string;
  /** Position in `values` or the field's key; checked against the dictionary at read time. */
  field: number | string;
  address: SourceSeriesAddress;
  /** Continue after this row number (the previous answer's `next`). */
  after?: number;
  /** Points wanted, 1 to 5,000 (default 1,000). */
  limit?: number;
};
/** One observation: the cell of the measured field on one row, with that row's period dimension. */
export type SourcePoint = { row: number; period: string | null; text: string | null };
export type SourceSeries = {
  snapshot: SourceSnapshotRef;
  field: SourceFieldInfo;
  /** The address as read, with cell filters resolved to positions. */
  address: { by: SourceSeriesKey; key: string } | { whole: true } | null;
  where: SourceResolvedMatch[];
  /** In file order (row number), not sorted by period: periods are strings and only `periods.ts` may order them. */
  points: SourcePoint[];
  /** Null when the series ended in this answer; otherwise the row to pass as `after` (the next answer can be empty when the series ends exactly at a page boundary). */
  next: number | null;
};

// ---------------------------------------------------------------- getSourceCrossSection

export type SourceCrossSectionQueryInput = {
  datasetId: string;
  snapshotId?: string;
  field: number | string;
  /** Exact period string; when absent the greatest period string of the snapshot is used. */
  period?: string;
  /** Only on snapshots of at most 50,000 rows. */
  where?: SourceCellMatch[];
};
export type SourceCrossRow = {
  row: number;
  entityId: string | null;
  entityName: string | null;
  geoCode: string | null;
  geoName: string | null;
  text: string | null;
};
/**
 * - `given`: the caller's period.
 * - `greatest`: the greatest period string in the snapshot (string order). Not always the latest date: in SEC standard
 *   facts the greatest string has 2 rows. Prefer a period chosen from facet counts when 0069 is present.
 * - `none`: the snapshot has no period dimension; rows are the snapshot's first rows in file order.
 */
export type SourcePeriodRule = "given" | "greatest" | "none";
export type SourceCrossSection = {
  snapshot: SourceSnapshotRef;
  field: SourceFieldInfo;
  period: string | null;
  periodRule: SourcePeriodRule;
  where: SourceResolvedMatch[];
  /** In file order, at most 1,000. Ranking is the caller's, through `numbers.ts`, and only for a declared quantity. */
  rows: SourceCrossRow[];
  /** True when these are all rows of the selection; false when there were more than 1,000 (never rank a part as the whole). */
  complete: boolean;
};

// ---------------------------------------------------------------- getSourcePeriodRange

export type SourcePeriodRangeQueryInput = { datasetId: string; snapshotId?: string };
/** An end of the period range: the period string and a row that carries it (for `first` its first row in file order, for `last` its last). */
export type SourcePeriodEnd = { period: string; row: number };
export type SourcePeriodRange = {
  snapshot: SourceSnapshotRef;
  /** Least and greatest period strings (string order, two index probes). Null when the snapshot has no period. */
  range: { first: SourcePeriodEnd; last: SourcePeriodEnd } | null;
};

// ---------------------------------------------------------------- getSourceEntities

export type SourceEntitiesQueryInput = {
  datasetId: string;
  snapshotId?: string;
  /** Exact period string; when absent the greatest period string is used (if the snapshot has periods). */
  period?: string;
  /** `entity` (entity id and name, the default) or `geo` (place code and name). */
  dimension?: "entity" | "geo";
};
/** One entity or place: its id (or code) and name as stored, and the first row read that carries it. */
export type SourceEntity = { id: string | null; name: string | null; row: number };
export type SourceEntities = {
  snapshot: SourceSnapshotRef;
  dimension: "entity" | "geo";
  period: string | null;
  periodRule: SourcePeriodRule;
  /** Distinct (id, name) pairs in the order first met, at most 1,000. Blank ids are kept as '' (not the same as null). */
  entities: SourceEntity[];
  /** Rows read to find them (at most 5,000). */
  rowsRead: number;
  /** True when every row of the selection was read; false means more entities may exist. */
  complete: boolean;
};

// ---------------------------------------------------------------- getFieldCompleteness

export type SourceFieldCompletenessQueryInput = { datasetId: string; snapshotId?: string };
/** Filled means a non-empty string: a disclosure marker ("NM", ".") counts as filled; it is not a number. */
export type SourceFieldFill = { position: number; key: string; label: string; filled: number; blank: number; share: number };
export type SourceFieldCompleteness = {
  snapshot: SourceSnapshotRef;
  /** From `quality.blank_counts_by_column` and `loaded_rows`; no records are read. Null when the snapshot has no counts. */
  fields: SourceFieldFill[] | null;
};

/**
 * Filled share per field, pure: `filled = rows - blank`, `share = filled / rows` (0 for an empty snapshot).
 * Returns null when the counts are missing or do not match the dictionary's width.
 */
export function fieldCompleteness(snapshot: {
  columns: SourceColumn[];
  loaded_rows: number;
  quality: Record<string, unknown> | null | undefined;
}): SourceFieldFill[] | null {
  const counts = snapshot.quality?.blank_counts_by_column;
  if (!Array.isArray(counts) || counts.length !== snapshot.columns.length) return null;
  const rows = snapshot.loaded_rows;
  const out: SourceFieldFill[] = [];
  for (const [position, column] of snapshot.columns.entries()) {
    const blank = counts[position];
    if (typeof blank !== "number" || !Number.isInteger(blank) || blank < 0 || blank > rows) return null;
    const filled = rows - blank;
    out.push({ position, key: column.key, label: column.label, filled, blank, share: rows === 0 ? 0 : filled / rows });
  }
  return out;
}

// ---------------------------------------------------------------- reads that need migration 0069

export type SourceFacetDimension = "entity_id" | "entity_name" | "period" | "geo_code" | "geo_name";
export type SourceFacetsQueryInput = {
  datasetId: string;
  snapshotId?: string;
  dimension: SourceFacetDimension;
  /** Continue after this value (the previous answer's `nextAfter`). */
  after?: string;
  /** Keep values that contain this text (case-insensitive). */
  contains?: string;
  /** Values wanted, 1 to 1,000 (default 200). */
  limit?: number;
};
export type SourceFacetValue = {
  value: string;
  /** For ids: the name on the first row with that id. */
  label: string | null;
  /** Rows with this value; exact when `exact`, otherwise a floor (the scan limit). */
  rows: number;
  exact: boolean;
};
export type SourceFacets = {
  snapshot: SourceSnapshotRef;
  dimension: SourceFacetDimension;
  values: SourceFacetValue[];
  /** True when every distinct value of the dimension is in this answer. */
  complete: boolean;
  nextAfter: string | null;
};

export type SourceFindQueryInput = { q: string; limit?: number };
/** A catalogue hit: every word of the query occurs in the name, description, publisher, source id, grain or a field label. */
export type SourceFindHit = {
  datasetId: string;
  name: string;
  sector: string;
  agency: string;
  rows: number;
  /** Where the words were found, best first: "name", "source_id", "agency", "grain", "description", "field". */
  matched: string[];
  /** Up to three field labels that matched. */
  fields: string[];
  rank: number;
};
export type SourceFind = { q: string; hits: SourceFindHit[] };

export type SourceSnapshotStatsQueryInput = { datasetId: string; snapshotId?: string };
/** Computed by the worker from the dimension indexes. Null counts mean "not computed" (too large for one bounded pass). */
export type SourceSnapshotStats = {
  snapshot: SourceSnapshotRef;
  periodMin: string | null;
  periodMax: string | null;
  periods: number | null;
  entities: number | null;
  geographies: number | null;
  computedAt: string | null;
};

// ---------------------------------------------------------------- getLibrary

/** Dimensions a snapshot fills, from `ingest.dimensions`, `ingest.constants` and `ingest.composites`. */
export type SourceDimensionSet = SourceDimension[];
/** One slim row per published dataset, for the landing and client-side search. */
export type SourceLibraryRow = {
  id: string;
  /** Reader-facing title from the catalogue. */
  title: string;
  /** The publisher's own table or series code, when the catalogue knows it. */
  code: string | null;
  /** The stored name when it differs from the title. */
  storedName: string | null;
  publisherId: string;
  collectionId: string;
  kind: "native" | "projection" | "derived" | "reference" | "internal";
  parentId: string | null;
  /** Native strings of the dataset row. */
  sector: string;
  agency: string;
  sourceId: string | null;
  grain: string;
  units: string;
  snapshotId: string;
  rows: number;
  fields: number;
  publishedAt: string | null;
  retrievedAt: string | null;
  dimensions: SourceDimensionSet;
  /** Published snapshots of this dataset (1 = never replaced). */
  versions: number;
  /** Refresh adapter family when a refresh has run for it (`coverage.refresh_provenance.family`), else null. */
  refreshFamily: string | null;
  hidden: boolean;
};
export type SourceLibraryCount = {
  id: string;
  name: string;
  datasets: number;
  rows: number;
  fields: number;
  newestPublication: string | null;
};
/** Publication events grouped by hour, publisher and kind (ux.md Screen 2, region 5). */
export type SourceLibraryChange = {
  /** First and last publication time in the group (ISO 8601). */
  from: string;
  to: string;
  publisherId: string;
  publisherName: string;
  /** `first`: a dataset's first published snapshot; `version`: a snapshot that replaced an earlier one. */
  kind: "first" | "version";
  datasets: number;
  /** Up to 20 dataset ids of the group, newest first. */
  datasetIds: string[];
  /** For a group of one: the dataset, its rows now and before (null for a first publication), both snapshot ids. */
  single: { datasetId: string; title: string; rows: number; previousRows: number | null; snapshotId: string; previousSnapshotId: string | null } | null;
};
export type SourceLibrary = {
  totals: { datasets: number; publishers: number; rows: number; fields: number; newestPublication: string | null; refreshable: number };
  collections: SourceLibraryCount[];
  publishers: SourceLibraryCount[];
  /** Newest first, at most 10 groups built from the last 40 replacing publications and the first publications. */
  changes: SourceLibraryChange[];
  datasets: SourceLibraryRow[];
  /** Which path built it: the 0069 function or direct selects on the two small tables. */
  via: "source_library" | "direct";
  /** When this server process built it (ISO 8601); the cache holds it ten minutes, keyed by the newest publication. */
  builtAt: string;
};

// ---------------------------------------------------------------- inputs (zod), the bounds the server keeps

const hash = z.string().regex(/^[0-9a-f]{64}$/, "Expected a lowercase SHA-256");
const datasetId = z.string().min(1).max(1024);
const nativeText = z.string().min(1).max(512);
const fieldRef = z.union([z.number().int().min(0).max(16383), z.string().min(1).max(200)]);
const rowNumber = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const cellMatch = z.object({ field: fieldRef, value: z.string().max(512) }).strict();
const cellMatches = z.array(cellMatch).min(1).max(READ_LIMITS.cellFilters);
const pinned = { datasetId, snapshotId: hash.optional() };

export const recordReadInput = z.object({ ...pinned, row: rowNumber }).strict();
export const seriesReadInput = z.object({
  ...pinned, field: fieldRef,
  address: z.union([
    z.object({ by: z.enum(["entity_id", "entity_name", "geo_code", "geo_name"]), key: nativeText, where: cellMatches.optional() }).strict(),
    z.object({ whole: z.literal(true) }).strict(),
    z.object({ where: cellMatches }).strict(),
  ]),
  after: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  limit: z.number().int().min(1).max(READ_LIMITS.page * READ_LIMITS.pages).optional(),
}).strict();
export const crossSectionReadInput = z.object({ ...pinned, field: fieldRef, period: nativeText.optional(), where: cellMatches.optional() }).strict();
export const periodRangeReadInput = z.object(pinned).strict();
export const entitiesReadInput = z.object({ ...pinned, period: nativeText.optional(), dimension: z.enum(["entity", "geo"]).optional() }).strict();
export const completenessReadInput = z.object(pinned).strict();
export const facetsReadInput = z.object({
  ...pinned, dimension: z.enum(["entity_id", "entity_name", "period", "geo_code", "geo_name"]),
  after: z.string().max(512).optional(), contains: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
}).strict();
export const findReadInput = z.object({ q: z.string().trim().min(1).max(200), limit: z.number().int().min(1).max(200).optional() }).strict();
export const statsReadInput = z.object(pinned).strict();
