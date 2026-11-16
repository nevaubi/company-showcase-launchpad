import { supabase } from "@/integrations/supabase/client";
import type { RiskLink } from "./core";
import type { TaggedShare } from "./chain";

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
