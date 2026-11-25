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
 */
import { keepPreviousData, queryOptions, type QueryClient } from "@tanstack/react-query";
import { getSourceDataset, listSources, querySourceRecords } from "./functions";
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

const staleFor = (snapshotId: string | null | undefined) => (snapshotId ? Infinity : LATEST_STALE_MS);
const text = (value: string | null | undefined) => (value ? value : undefined);

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

/** `undefined` cannot live in a key that is compared after a JSON round trip; null can. */
const keyPart = <T extends object>(value: T) =>
  Object.fromEntries(Object.entries(value).map(([k, v]) => [k, v ?? null]));

export const sourceKeys = {
  all: ["sources"] as const,
  list: (filters: SourceListFilters = {}) =>
    ["sources", "list", keyPart(normalizeListFilters(filters))] as const,
  /** Every read of one dataset, whatever the snapshot: use it to drop a dataset from the cache. */
  datasetScope: (id: string) => ["sources", "dataset", id] as const,
  dataset: (id: string, snapshotId?: string | null) =>
    ["sources", "dataset", id, snapshotId || "latest"] as const,
  recordsScope: (datasetId: string) => ["sources", "records", datasetId] as const,
  records: (query: SourceRecordQuery) => {
    const { datasetId, snapshotId, ...rest } = normalizeRecordQuery(query);
    return ["sources", "records", datasetId, snapshotId ?? "latest", keyPart(rest)] as const;
  },
};

export const sourceQueries = {
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
};

/** Two record keys of the same dataset and the same snapshot (or both "latest"). */
export function sameRecordScope(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a[0] === "sources" && a[1] === "records" && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
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

export type SourceReadFailure = "not-found" | "timeout" | "invalid" | "cancelled" | "error";

/**
 * Why one of the three original reads failed, from the message the database raised. Screens
 * use it to say what is wrong and what helps ("Open the latest snapshot", "Use the exact
 * identifier") instead of offering a retry that cannot work.
 */
export function sourceReadFailure(error: unknown): SourceReadFailure {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (name === "AbortError" || /\baborted\b/i.test(message)) return "cancelled";
  if (/statement timeout|canceling statement|timed out/i.test(message)) return "timeout";
  if (/not found/i.test(message)) return "not-found";
  if (/^invalid source|invalid input|validation/i.test(message)) return "invalid";
  return "error";
}
