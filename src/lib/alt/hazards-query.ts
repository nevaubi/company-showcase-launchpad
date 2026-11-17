import { queryOptions } from "@tanstack/react-query";
import { getPlantHazards } from "@/lib/hazards.functions";

/** Live hazards at covered plants (all companies, or one). Refreshes every 5 minutes while open. */
export const plantHazardsQuery = (ticker?: string | null) =>
  queryOptions({
    queryKey: ["plant-hazards", ticker ?? "all"],
    queryFn: () => getPlantHazards({ data: { ticker: ticker ?? null } }),
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    retry: 1,
  });
