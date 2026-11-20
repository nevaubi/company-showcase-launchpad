import { supabase } from "@/integrations/supabase/client";
import type { RiskLink } from "./core";
import type { TaggedShare } from "./chain";
import { currentRows, trustRows } from "./trusted";

/** All rows: the first page also returns the total, then the remaining pages load in parallel (a few at a time). */
async function pageAll(build: (count?: boolean) => any): Promise<RiskLink[]> {
  const first = await build(true).range(0, 999);
  if (first.error) throw first.error;
  const out: RiskLink[] = [...((first.data ?? []) as unknown as RiskLink[])];
  const total: number = first.count ?? out.length;
  const starts: number[] = [];
  for (let from = 1000; from < total; from += 1000) starts.push(from);
  for (let i = 0; i < starts.length; i += 4) {
    const pages = await Promise.all(starts.slice(i, i + 4).map((from) => build().range(from, from + 999)));
    for (const pg of pages) {
      if (pg.error) throw pg.error;
      out.push(...((pg.data ?? []) as unknown as RiskLink[]));
    }
  }
  // Rows added between the count and the last page would be missed; ids dedupe any overlap.
  const seen = new Set<string>();
  return out.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
}

/** Links from each company's latest 10-K and any newer 10-Q — what the map shows. */
export const supplyLinksQuery = {
  queryKey: ["supply_links", "trusted"],
  queryFn: async () => currentRows(await pageAll((count) => supabase.from("supply_links").select("*", count ? { count: "exact" } : undefined).eq("is_current", true).order("id"))),
  staleTime: 10 * 60_000,
};

/** Every link `ticker` stated, including prior 10-Ks — for "what changed". */
export const supplyHistoryQuery = (ticker: string) => ({
  queryKey: ["supply_links_history", "trusted", ticker],
  // every filing is kept (no dedupe): "what changed" compares one filing with another
  queryFn: async () => trustRows(await pageAll((count) => supabase.from("supply_links").select("*", count ? { count: "exact" } : undefined).eq("ticker", ticker).order("id"))),
  staleTime: 10 * 60_000,
});

/** XBRL-tagged customer/supplier shares that name a covered company, newest period per pair (for the value chain). */
export const taggedSharesQuery = {
  queryKey: ["xbrl_concentration", "named"],
  queryFn: async (): Promise<TaggedShare[]> => {
    const rows: TaggedShare[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("xbrl_concentration")
        .select("ticker, counterparty, kind, benchmark, label, pct, accn, form, filed, period_end, element_id")
        .not("counterparty", "is", null)
        .in("kind", ["customer", "supplier"])
        .order("period_end", { ascending: false })
        .range(from, from + 999);
      if (error) throw error;
      rows.push(...((data ?? []).map((r) => ({ ...r, pct: Number(r.pct) })) as TaggedShare[]));
      if (!data || data.length < 1000) break;
    }
    const seen = new Set<string>();
    return rows.filter((r) => {
      const k = `${r.ticker}|${r.counterparty}|${r.kind}|${r.benchmark}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  },
  staleTime: 6 * 60 * 60_000,
};
