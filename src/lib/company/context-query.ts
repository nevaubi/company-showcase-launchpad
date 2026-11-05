import { queryOptions, useQuery } from "@tanstack/react-query";
import type { CompanyContext } from "./context";

/** Description, photos and people from `bun scripts/company-context.ts`; null when not built yet. */
export const contextQuery = (ticker: string) =>
  queryOptions({
    queryKey: ["company-context", ticker],
    queryFn: async (): Promise<CompanyContext | null> => {
      const r = await fetch(`/data/context/${ticker}.json`);
      if (!r.ok) return null;
      try {
        return (await r.json()) as CompanyContext;
      } catch {
        return null;
      }
    },
    staleTime: 60 * 60_000,
  });

export const useCompanyContext = (ticker: string) => useQuery(contextQuery(ticker));
