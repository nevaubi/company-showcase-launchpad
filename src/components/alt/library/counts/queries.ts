/**
 * Query options of unit counts, under the app's `["sources", …]` keys so the library's invalidation reaches them.
 * A pinned snapshot never goes stale; a failure that may pass (timeout, error) is stale at once; nothing is retried.
 */
import { queryOptions } from "@tanstack/react-query";
import { getSourceFacets } from "@/lib/sources/read.functions";
import { readFail, readOk, type SourceFacetDimension, type SourceFacetValue, type SourceFacets, type SourceRead, type SourceSnapshotRef } from "@/lib/sources/read-types";
import { getCategoryCounts, getTablePeriods } from "./counts.functions";
import type { CategoryCounts, TablePeriodsWire } from "./wire";

/** Facet pages read at most for one dimension: each reads at most 250,000 index entries and 1,000 values. */
export const FACET_PAGES = 5;
const FACET_PAGE_VALUES = 1000;
const TEN_MINUTES = 10 * 60_000;

function staleTime(pinned: boolean) {
  return (query: { state: { data: SourceRead<unknown> | undefined } }) => {
    const answer = query.state.data;
    if (answer && !answer.ok && (answer.reason === "timeout" || answer.reason === "error")) return 0;
    return pinned ? Infinity : 5 * 60_000;
  };
}

/** Every value of one dimension with its count, from up to five facet pages in value order. */
export type AllFacets = {
  snapshot: SourceSnapshotRef;
  dimension: SourceFacetDimension;
  values: SourceFacetValue[];
  /** True when every distinct value is in `values` with its count (a count may still be a floor: `exact`). */
  complete: boolean;
  pages: number;
};

/** Reads the pages of one dimension until the answer is complete or five pages are read (pure over `page`). */
export async function readAllFacets(page: (after: string | undefined) => Promise<SourceRead<SourceFacets>>, pages = FACET_PAGES): Promise<SourceRead<AllFacets>> {
  const values: SourceFacetValue[] = [];
  let after: string | undefined;
  let first: SourceFacets | null = null;
  for (let i = 0; i < pages; i++) {
    const answer = await page(after);
    if (!answer.ok) return first ? readOk({ snapshot: first.snapshot, dimension: first.dimension, values, complete: false, pages: i }) : answer;
    first ??= answer.data;
    // the database orders and continues by its own collation: a page holds only values after `after`
    values.push(...answer.data.values);
    if (answer.data.complete || answer.data.nextAfter === null || answer.data.nextAfter === after) {
      return readOk({ snapshot: first.snapshot, dimension: first.dimension, values, complete: answer.data.complete, pages: i + 1 });
    }
    after = answer.data.nextAfter;
  }
  if (!first) return readFail("error", "No facet page was read");
  return readOk({ snapshot: first.snapshot, dimension: first.dimension, values, complete: false, pages });
}

export const countKeys = {
  facets: (datasetId: string, snapshotId: string, dimension: SourceFacetDimension) => ["sources", "counts", "facets", datasetId, snapshotId, dimension] as const,
  categories: (datasetId: string, snapshotId: string, fields: readonly number[]) => ["sources", "counts", "categories", datasetId, snapshotId, fields.join(",")] as const,
  periods: () => ["sources", "counts", "table-periods"] as const,
};

export const countQueries = {
  /** Every value of one dimension of a pinned snapshot with its record count. */
  facets: (datasetId: string, snapshotId: string, dimension: SourceFacetDimension) =>
    queryOptions({
      queryKey: countKeys.facets(datasetId, snapshotId, dimension),
      queryFn: ({ signal }): Promise<SourceRead<AllFacets>> =>
        readAllFacets((after) => getSourceFacets({ data: { datasetId, snapshotId, dimension, limit: FACET_PAGE_VALUES, ...(after === undefined ? {} : { after }) }, signal })),
      staleTime: staleTime(true),
      refetchOnWindowFocus: false,
      retry: false,
    }),

  /** Values of the given fields counted over every record of a small pinned snapshot. */
  categories: (datasetId: string, snapshotId: string, fields: readonly number[]) =>
    queryOptions({
      queryKey: countKeys.categories(datasetId, snapshotId, fields),
      queryFn: ({ signal }): Promise<SourceRead<CategoryCounts>> => getCategoryCounts({ data: { datasetId, snapshotId, fields: [...fields] }, signal }),
      staleTime: staleTime(true),
      refetchOnWindowFocus: false,
      retry: false,
    }),

  /** Period ranges of every current snapshot, for the collection timeline and the landing. */
  periods: () =>
    queryOptions({
      queryKey: countKeys.periods(),
      queryFn: ({ signal }): Promise<SourceRead<TablePeriodsWire>> => getTablePeriods({ signal }),
      staleTime: (query: { state: { data: SourceRead<unknown> | undefined } }) => {
        const answer = query.state.data;
        return answer && !answer.ok && (answer.reason === "timeout" || answer.reason === "error") ? 0 : TEN_MINUTES;
      },
      refetchOnWindowFocus: false,
      retry: false,
    }),
};
