/**
 * Query options of the table page's direct reads (`record-read.ts`). The reads of unit `reads` go through the one
 * query layer, `sourceQueries` in `src/lib/sources/queries.ts`. Every read below names the snapshot the page
 * resolved, and a published snapshot is immutable, so nothing here goes stale. Reads are not retried: a scan or a
 * missing record does not change on a second try, and a failure is shown with its reason and a retry button.
 */
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { SourceRead } from "@/lib/sources/read-types";
import {
  readDatasetBrief,
  readRecord,
  readRecordPage,
  readVersions,
  type ReadClient,
  type RecordPageQuery,
} from "./record-read";

/** The member's own client in the browser; row level security decides what it may read. */
export const readClient = (): ReadClient => supabase as unknown as ReadClient;

const pinned = { staleTime: Infinity, gcTime: 30 * 60_000, refetchOnWindowFocus: false, retry: false } as const;

/** The data of a read that answered, or why it did not: "unavailable" means migration 0069 is not applied yet. */
export function readData<T>(read: SourceRead<T> | undefined): { data: T | null; reason: string | null; message: string | null } {
  if (!read) return { data: null, reason: null, message: null };
  return read.ok ? { data: read.data, reason: null, message: null } : { data: null, reason: read.reason, message: read.message };
}

export const datasetKeys = {
  records: (q: Omit<RecordPageQuery, "signal">) => ["sources", "library-records", q.snapshotId, q] as const,
  record: (snapshotId: string, row: number) => ["sources", "library-record", snapshotId, row] as const,
  versions: (datasetId: string) => ["sources", "library-versions", datasetId] as const,
};

export const datasetQueries = {
  /** A page of records. The page on screen stays while the next one loads, within the same snapshot only. */
  records: (q: Omit<RecordPageQuery, "signal">) => {
    const queryKey = datasetKeys.records(q);
    return queryOptions({
      queryKey,
      queryFn: ({ signal }) => readRecordPage(readClient(), { ...q, signal }),
      placeholderData: (previous, previousQuery) =>
        previousQuery && previousQuery.queryKey[2] === q.snapshotId ? previous : undefined,
      ...pinned,
    });
  },
  record: (snapshotId: string, row: number) =>
    queryOptions({
      queryKey: datasetKeys.record(snapshotId, row),
      queryFn: ({ signal }) => readRecord(readClient(), snapshotId, row, signal),
      ...pinned,
    }),
  /** The list of versions can grow while the page is open: trusted for five minutes. */
  versions: (datasetId: string) =>
    queryOptions({
      queryKey: datasetKeys.versions(datasetId),
      queryFn: ({ signal }) => readVersions(readClient(), datasetId, signal),
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: false,
    }),
  /** Another dataset's stored row (the parent of a view), trusted for five minutes. */
  brief: (datasetId: string) =>
    queryOptions({
      queryKey: ["sources", "library-brief", datasetId] as const,
      queryFn: ({ signal }) => readDatasetBrief(readClient(), datasetId, signal),
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: false,
    }),
};
