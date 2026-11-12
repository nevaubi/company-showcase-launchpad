import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getEstimates } from "@/lib/estimates.functions";
import { nextEarnings, type NextEarnings } from "@/lib/company/catalysts";

/**
 * The next earnings date for a company, the same on every page: the earnings calendar's date when the
 * estimates feed has one, otherwise a projection from the company's past release dates. Shares the
 * estimates page's query, so it costs nothing extra once either has loaded.
 */
export function useNextEarnings(ticker: string, releases: string[] | undefined): NextEarnings | null {
  const fn = useServerFn(getEstimates);
  const q = useQuery({
    queryKey: ["estimates", ticker],
    queryFn: () => fn({ data: { ticker } }),
    staleTime: 3600_000,
    retry: 1,
  });
  const calendar = q.data?.estimates?.nextEarnings?.start ?? null;
  return useMemo(() => (releases ? nextEarnings(calendar, releases, new Date().toISOString().slice(0, 10)) : null), [calendar, releases]);
}
