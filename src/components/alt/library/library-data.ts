import { queryOptions, useQuery } from "@tanstack/react-query";
import { getLibrary } from "@/lib/sources/read.functions";
import type { SourceLibrary, SourceReadFailure } from "@/lib/sources/read-types";

/** The landing's one read: totals, collections, publishers, changes and one slim row per table. */
export const libraryQuery = () =>
  queryOptions({
    queryKey: ["sources", "library"] as const,
    queryFn: () => getLibrary(),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

export type LibraryState = {
  lib: SourceLibrary | null;
  loading: boolean;
  /** Why the library could not be read: a failure the read answered, or a request that threw. */
  failure: { reason: SourceReadFailure | "request"; message: string } | null;
  retry: () => void;
};

export function useLibrary(): LibraryState {
  const q = useQuery(libraryQuery());
  const answer = q.data;
  const lib = answer && answer.ok ? answer.data : null;
  const failure =
    answer && !answer.ok
      ? { reason: answer.reason, message: answer.message }
      : q.error && !lib
        ? { reason: "request" as const, message: q.error instanceof Error ? q.error.message : String(q.error) }
        : null;
  return { lib, loading: q.isLoading, failure, retry: () => void q.refetch() };
}

/** What a reader is told when the library cannot be read: a timeout says so; a request that failed says to retry. */
export function failureHint(failure: NonNullable<LibraryState["failure"]>): string {
  if (failure.reason === "timeout") return "The database took too long to answer. Try again in a moment.";
  if (failure.reason === "request") return "The request did not complete. Check the connection and try again.";
  return failure.message;
}
