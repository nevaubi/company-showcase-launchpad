import { supabase } from "@/integrations/supabase/client";
import type { RiskLink } from "./core";

async function pageAll(build: () => any): Promise<RiskLink[]> {
  const out: RiskLink[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as unknown as RiskLink[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Links from each company's latest 10-K and any newer 10-Q — what the map shows. */
export const supplyLinksQuery = {
  queryKey: ["supply_links"],
  queryFn: () => pageAll(() => supabase.from("supply_links").select("*").eq("is_current", true)),
  staleTime: 10 * 60_000,
};

/** Every link `ticker` stated, including prior 10-Ks — for "what changed". */
export const supplyHistoryQuery = (ticker: string) => ({
  queryKey: ["supply_links_history", ticker],
  queryFn: () => pageAll(() => supabase.from("supply_links").select("*").eq("ticker", ticker)),
  staleTime: 10 * 60_000,
});
