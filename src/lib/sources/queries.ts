/**
 * The one query layer of the Data library: TanStack Query option factories over the server
 * functions. Screens, company panels and the assistant's reader all take their reads from
 * here, so one cache serves them and one key names one answer.
 *
 * Rules the factories keep:
 * - A key is built from normalised arguments (absent, undefined and "" are the same), and the
 *   request is built from the same normalised arguments, so a key and its answer cannot differ.
 * - A read of a pinned snapshot is never stale: a published snapshot is immutable. A read of
 *   "the latest" is stale after five minutes.
 * - The query's AbortSignal goes to the server function, so leaving a screen or typing on
 *   cancels the request in flight.
 * - Reads that scan (records, a dataset that may not exist) are not retried: a second attempt
 *   repeats the scan and cannot find a snapshot that is not there.
 * - While the next page or filter loads, the page on screen stays (`isPlaceholderData` is
 *   true, so a screen can dim it), but only within one dataset and one snapshot: rows of
 *   another table are never shown as a placeholder for this one.
 * - The reads of `read.functions.ts` answer `SourceRead<T>`. A failure there is data, never a
 *   thrown error: `{ ok: false, reason: "unavailable" }` (migration 0069 not applied) is a
 *   normal answer a screen falls back from, it is cached like any answer and never retried.
 *   A timeout or an unexpected error goes stale at once, so the next visit asks again.
 */
import { keepPreviousData, queryOptions, type QueryClient } from "@tanstack/react-query";
import { getSourceDataset, listSources, querySourceRecords } from "./functions";
import {
  findSources,
  getFieldCompleteness,
  getSnapshotStats,
  getSourceCrossSection,
  getSourceEntities,
  getSourceFacets,
  getSourcePeriodRange,
  getSourceRecord,
  getSourceSeries,
  getLibraryWire,
} from "./read.functions";
import type {
  SourceCrossSection,
  SourceCrossSectionQueryInput,
  SourceEntities,
  SourceEntitiesQueryInput,
  SourceFacets,
  SourceFacetsQueryInput,
  SourceFieldCompleteness,
  SourceFind,
  SourceLibrary,
  SourcePeriodRange,
  SourceRead,
  SourceReadFailure,
  SourceRecordRead,
  SourceSeries,
  SourceSeriesQueryInput,
  SourceSnapshotStats,
} from "./read-types";
import { unpackLibrary } from "./read-types";
import type {
  SourceDatasetDetail,
  SourceDatasetList,
  SourceListFilters,
  SourceRecordPage,
  SourceRecordQuery,
} from "./schema";

const MINUTE = 60_000;
/** How long an answer about "the latest snapshot" is trusted before it is asked again. */
export const LATEST_STALE_MS = 5 * MINUTE;
/** Default page of records on screen. The SQL allows 1 to 100. */
export const RECORD_PAGE_SIZE = 25;
/** Default number of points of one series read (the server allows 1 to 5,000). */
export const SERIES_PAGE_SIZE = 1000;

const staleFor = (snapshotId: string | null | undefined) => (snapshotId ? Infinity : LATEST_STALE_MS);
const text = (value: string | null | undefined) => (value ? value : undefined);

/**
 * Stale time of a `SourceRead` answer: a failure that may pass (timeout, error) is stale at
 * once; every other answer, the failures that cannot change by asking again included
 * (unavailable, not-found, invalid), keeps the snapshot rule.
 */
function readStaleTime(snapshotId: string | null | undefined) {
  return (query: { state: { data: SourceRead<unknown> | undefined } }) => {
    const answer = query.state.data;
    if (answer && !answer.ok && (answer.reason === "timeout" || answer.reason === "error")) return 0;
    return staleFor(snapshotId);
  };
}

/** The list arguments as sent: empty strings dropped, the limit stated. */
export function normalizeListFilters(filters: SourceListFilters = {}): SourceListFilters {
  return {
    sector: text(filters.sector),
    agency: text(filters.agency),
    q: text(filters.q?.trim()),
    after: text(filters.after),
    limit: filters.limit ?? 1000,
  };
}

/** The record arguments as sent: empty strings dropped, cursor and page size stated. */
export function normalizeRecordQuery(query: SourceRecordQuery): SourceRecordQuery {
  return {
    datasetId: query.datasetId,
    snapshotId: text(query.snapshotId),
    entity: text(query.entity),
    geography: text(query.geography),
    period: text(query.period),
    q: text(query.q?.trim()),
    after: query.after ?? 0,
    limit: query.limit ?? RECORD_PAGE_SIZE,
    columns: query.columns?.length ? [...query.columns] : undefined,
  };
}

/** The series arguments as sent: cursor and point count stated. */
export function normalizeSeriesQuery(query: SourceSeriesQueryInput): SourceSeriesQueryInput {
  return {
    datasetId: query.datasetId,
    snapshotId: text(query.snapshotId),
    field: query.field,
    address: query.address,
    after: query.after ?? 0,
    limit: query.limit ?? SERIES_PAGE_SIZE,
  };
}

export function normalizeCrossSectionQuery(query: SourceCrossSectionQueryInput): SourceCrossSectionQueryInput {
  return {
    datasetId: query.datasetId,
    snapshotId: text(query.snapshotId),
    field: query.field,
    period: text(query.period),
    where: query.where?.length ? query.where : undefined,
  };
}

export function normalizeEntitiesQuery(query: SourceEntitiesQueryInput): SourceEntitiesQueryInput {
  return {
    datasetId: query.datasetId,
    snapshotId: text(query.snapshotId),
    period: text(query.period),
    dimension: query.dimension ?? "entity",
  };
}

export function normalizeFacetsQuery(query: SourceFacetsQueryInput): SourceFacetsQueryInput {
  return {
    datasetId: query.datasetId,
    snapshotId: text(query.snapshotId),
    dimension: query.dimension,
    after: text(query.after),
    contains: text(query.contains?.trim()),
    limit: query.limit ?? 200,
  };
}

/** `undefined` cannot live in a key that is compared after a JSON round trip; null can. */
const keyPart = <T extends object>(value: T) =>
  Object.fromEntries(Object.entries(value).map(([k, v]) => [k, v ?? null]));

/** A read of one snapshot: ["sources", read, dataset, snapshot or "latest", arguments]. */
const snapshotKey = <T extends { datasetId: string; snapshotId?: string }>(read: string, query: T) => {
  const { datasetId, snapshotId, ...rest } = query;
  return ["sources", read, datasetId, snapshotId ?? "latest", keyPart(rest)] as const;
};

export const sourceKeys = {
  all: ["sources"] as const,
  library: () => ["sources", "library"] as const,
  list: (filters: SourceListFilters = {}) =>
    ["sources", "list", keyPart(normalizeListFilters(filters))] as const,
  /** Every read of one dataset, whatever the snapshot: use it to drop a dataset from the cache. */
  datasetScope: (id: string) => ["sources", "dataset", id] as const,
  dataset: (id: string, snapshotId?: string | null) =>
    ["sources", "dataset", id, snapshotId || "latest"] as const,
  recordsScope: (datasetId: string) => ["sources", "records", datasetId] as const,
  records: (query: SourceRecordQuery) => snapshotKey("records", normalizeRecordQuery(query)),
  record: (datasetId: string, snapshotId: string | null | undefined, row: number) =>
    ["sources", "record", datasetId, snapshotId || "latest", row] as const,
  series: (query: SourceSeriesQueryInput) => snapshotKey("series", normalizeSeriesQuery(query)),
  crossSection: (query: SourceCrossSectionQueryInput) =>
    snapshotKey("cross-section", normalizeCrossSectionQuery(query)),
  periodRange: (datasetId: string, snapshotId?: string | null) =>
    ["sources", "period-range", datasetId, snapshotId || "latest"] as const,
  entities: (query: SourceEntitiesQueryInput) => snapshotKey("entities", normalizeEntitiesQuery(query)),
  completeness: (datasetId: string, snapshotId?: string | null) =>
    ["sources", "completeness", datasetId, snapshotId || "latest"] as const,
  facets: (query: SourceFacetsQueryInput) => snapshotKey("facets", normalizeFacetsQuery(query)),
  stats: (datasetId: string, snapshotId?: string | null) =>
    ["sources", "stats", datasetId, snapshotId || "latest"] as const,
  find: (q: string, limit?: number) => ["sources", "find", q.trim(), limit ?? null] as const,
};

const pinnedOnly = (datasetId: string, snapshotId?: string | null) => ({
  datasetId,
  snapshotId: text(snapshotId),
});

export const sourceQueries = {
  /**
   * The Data library landing in one call: totals, collections, publishers, what changed and one slim row per
   * dataset for client-side search. Works before 0069 (direct selects, cached ten minutes on the server).
   */
  library: () =>
    queryOptions({
      queryKey: sourceKeys.library(),
      queryFn: async ({ signal }): Promise<SourceRead<SourceLibrary>> => {
        const wire = await getLibraryWire({ signal });
        return wire.ok ? { ok: true, data: unpackLibrary(wire.data) } : wire;
      },
      staleTime: readStaleTime(null),
      refetchOnWindowFocus: false,
      retry: 1,
    }),

  /** The old catalogue read: every dataset row with its latest snapshot summary. Fallback mode. */
  list: (filters: SourceListFilters = {}) =>
    queryOptions({
      queryKey: sourceKeys.list(filters),
      queryFn: ({ signal }): Promise<SourceDatasetList> =>
        listSources({ data: normalizeListFilters(filters), signal }),
      staleTime: LATEST_STALE_MS,
      placeholderData: keepPreviousData,
      refetchOnWindowFocus: false,
      retry: 1,
    }),

  /** One dataset with the snapshot asked for, or the latest: dictionary, ingest, coverage, file. */
  dataset: (id: string, snapshotId?: string | null) =>
    queryOptions({
      queryKey: sourceKeys.dataset(id, snapshotId),
      queryFn: ({ signal }): Promise<SourceDatasetDetail> =>
        getSourceDataset({ data: { id, snapshotId: text(snapshotId) }, signal }),
      staleTime: staleFor(snapshotId),
      refetchOnWindowFocus: false,
      retry: false,
    }),

  /** One page of records, at most 100 rows and 64 fields. */
  records: (query: SourceRecordQuery) => {
    const queryKey = sourceKeys.records(query);
    return queryOptions({
      queryKey,
      queryFn: ({ signal }): Promise<SourceRecordPage> =>
        querySourceRecords({ data: normalizeRecordQuery(query), signal }),
      placeholderData: (previous, previousQuery) =>
        previousQuery && sameRecordScope(previousQuery.queryKey, queryKey) ? previous : undefined,
      staleTime: staleFor(query.snapshotId),
      refetchOnWindowFocus: false,
      retry: false,
    });
  },

  /** One whole record, every field, with the snapshot's dictionary. Works before 0069. */
  record: (datasetId: string, snapshotId: string | null | undefined, row: number) =>
    queryOptions({
      queryKey: sourceKeys.record(datasetId, snapshotId, row),
      queryFn: ({ signal }): Promise<SourceRead<SourceRecordRead>> =>
        getSourceRecord({ data: { ...pinnedOnly(datasetId, snapshotId), row }, signal }),
      staleTime: readStaleTime(snapshotId),
      refetchOnWindowFocus: false,
      retry: false,
    }),

  /** One field over one series, in file order, at most 5,000 points a call. Works before 0069. */
  series: (query: SourceSeriesQueryInput) =>
    queryOptions({
      queryKey: sourceKeys.series(query),
      queryFn: ({ signal }): Promise<SourceRead<SourceSeries>> =>
        getSourceSeries({ data: normalizeSeriesQuery(query), signal }),
      staleTime: readStaleTime(query.snapshotId),
      refetchOnWindowFocus: false,
      retry: false,
    }),

  /** One field across entities for one period (the greatest period string when absent). Works before 0069. */
  crossSection: (query: SourceCrossSectionQueryInput) =>
    queryOptions({
      queryKey: sourceKeys.crossSection(query),
      queryFn: ({ signal }): Promise<SourceRead<SourceCrossSection>> =>
        getSourceCrossSection({ data: normalizeCrossSectionQuery(query), signal }),
      staleTime: readStaleTime(query.snapshotId),
      refetchOnWindowFocus: false,
      retry: false,
    }),

  /** Least and greatest period strings through the period index. Works before 0069. */
  periodRange: (datasetId: string, snapshotId?: string | null) =>
    queryOptions({
      queryKey: sourceKeys.periodRange(datasetId, snapshotId),
      queryFn: ({ signal }): Promise<SourceRead<SourcePeriodRange>> =>
        getSourcePeriodRange({ data: pinnedOnly(datasetId, snapshotId), signal }),
      staleTime: readStaleTime(snapshotId),
      refetchOnWindowFocus: false,
      retry: false,
    }),

  /** The entities (or places) of one period, for pickers, at most 1,000. Works before 0069. */
  entities: (query: SourceEntitiesQueryInput) =>
    queryOptions({
      queryKey: sourceKeys.entities(query),
      queryFn: ({ signal }): Promise<SourceRead<SourceEntities>> =>
        getSourceEntities({ data: normalizeEntitiesQuery(query), signal }),
      staleTime: readStaleTime(query.snapshotId),
      refetchOnWindowFocus: false,
      retry: false,
    }),

  /** Filled share per field from the snapshot's stored blank counts; reads no records. Works before 0069. */
  completeness: (datasetId: string, snapshotId?: string | null) =>
    queryOptions({
      queryKey: sourceKeys.completeness(datasetId, snapshotId),
      queryFn: ({ signal }): Promise<SourceRead<SourceFieldCompleteness>> =>
        getFieldCompleteness({ data: pinnedOnly(datasetId, snapshotId), signal }),
      staleTime: readStaleTime(snapshotId),
      refetchOnWindowFocus: false,
      retry: false,
    }),

  /** Values of one dimension with record counts. Needs 0069: answers `unavailable` until then. */
  facets: (query: SourceFacetsQueryInput) => {
    const queryKey = sourceKeys.facets(query);
    return queryOptions({
      queryKey,
      queryFn: ({ signal }): Promise<SourceRead<SourceFacets>> =>
        getSourceFacets({ data: normalizeFacetsQuery(query), signal }),
      placeholderData: (previous, previousQuery) =>
        previousQuery && sameSnapshotScope(previousQuery.queryKey, queryKey) ? previous : undefined,
      staleTime: readStaleTime(query.snapshotId),
      refetchOnWindowFocus: false,
      retry: false,
    });
  },

  /** Records per period and counts of entities and places. Needs 0069: `unavailable` until then. */
  stats: (datasetId: string, snapshotId?: string | null) =>
    queryOptions({
      queryKey: sourceKeys.stats(datasetId, snapshotId),
      queryFn: ({ signal }): Promise<SourceRead<SourceSnapshotStats>> =>
        getSnapshotStats({ data: pinnedOnly(datasetId, snapshotId), signal }),
      staleTime: readStaleTime(snapshotId),
      refetchOnWindowFocus: false,
      retry: false,
    }),

  /** Catalogue search including field labels. Needs 0069: `unavailable` until then (search the library rows instead). */
  find: (q: string, limit?: number) =>
    queryOptions({
      queryKey: sourceKeys.find(q, limit),
      queryFn: ({ signal }): Promise<SourceRead<SourceFind>> =>
        findSources({ data: { q: q.trim(), ...(limit === undefined ? {} : { limit }) }, signal }),
      enabled: q.trim().length > 0,
      staleTime: readStaleTime(null),
      placeholderData: keepPreviousData,
      refetchOnWindowFocus: false,
      retry: false,
    }),
};

/** Two keys of the same read, dataset and snapshot (or both "latest"). */
export function sameSnapshotScope(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a[0] === "sources" && b[0] === "sources" && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

/** Two record keys of the same dataset and the same snapshot (or both "latest"). */
export function sameRecordScope(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a[1] === "records" && sameSnapshotScope(a, b);
}

/**
 * The cursor of the page before the one that starts after `after` (rev-app M3). Without a
 * filter or search, row numbers are contiguous from 1, so it is plain arithmetic and works
 * on an address opened cold (a reload, an assistant's row link). With a filter the rows
 * skip, so only a trail of the cursors the reader passed can say: null then, and on the
 * first page.
 */
export function previousRecordCursor(
  query: Pick<SourceRecordQuery, "after" | "limit" | "entity" | "geography" | "period" | "q">,
): number | null {
  const after = query.after ?? 0;
  if (after <= 0) return null;
  if (text(query.entity) || text(query.geography) || text(query.period) || text(query.q?.trim())) return null;
  return Math.max(0, after - (query.limit ?? RECORD_PAGE_SIZE));
}

/**
 * Reads a dataset through the cache and files the answer under its pinned key too, so a later
 * read that names the snapshot (the assistant always does) does not download the dictionary
 * again. The FDIC institution table's dictionary alone is 1.6 MB.
 */
export async function fetchSourceDataset(
  client: QueryClient,
  id: string,
  snapshotId?: string | null,
): Promise<SourceDatasetDetail> {
  const detail = await client.fetchQuery(sourceQueries.dataset(id, snapshotId));
  if (!snapshotId && detail.snapshot)
    client.setQueryData(sourceKeys.dataset(id, detail.snapshot.id), detail);
  return detail;
}

/** Why a read failed: the `SourceRead` reasons of the new reads, and "cancelled" for an aborted call. */
export type SourceErrorKind = SourceReadFailure | "cancelled";

/**
 * Why one of the three original reads failed, from the message the database raised (those
 * reads throw; the new reads answer a `SourceRead` instead). Screens use it to say what is
 * wrong and what helps ("Open the latest snapshot", "Use the exact identifier") instead of
 * offering a retry that cannot work.
 */
export function sourceReadFailure(error: unknown): SourceErrorKind {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (name === "AbortError" || /\baborted\b/i.test(message)) return "cancelled";
  if (/could not find the function|PGRST202/i.test(message)) return "unavailable";
  if (/statement timeout|canceling statement|timed out/i.test(message)) return "timeout";
  if (/not found/i.test(message)) return "not-found";
  if (/^invalid source|invalid input|validation/i.test(message)) return "invalid";
  return "error";
}
