import { queryOptions, useQuery } from "@tanstack/react-query";
import type { CompanyContext } from "./context";
import { analyticsFile } from "@/lib/analytics-files";

/** Description, photos and people from `bun scripts/company-context.ts`; null when not built yet. */
export const contextQuery = (ticker: string) =>
  queryOptions({
    queryKey: ["company-context", ticker],
    queryFn: async (): Promise<CompanyContext | null> => {
      return analyticsFile<CompanyContext>(`context/${ticker}.json`);
    },
    staleTime: 60 * 60_000,
  });

export const useCompanyContext = (ticker: string) => useQuery(contextQuery(ticker));
