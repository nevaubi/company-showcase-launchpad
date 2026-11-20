import { supabase } from "@/integrations/supabase/client";
import type { RiskLink } from "./core";
import type { TaggedShare } from "./chain";
import { dedupeCurrent } from "./identity";
import { pageSupplyLinks } from "./read";

/** Links from each company's latest 10-K and any newer 10-Q — what the map shows. */
export const supplyLinksQuery = {
  queryKey: ["supply-links", "trusted"],
  // rows arrive verified (read.ts); then one row per link across a filer's 10-K and 10-Q
  queryFn: async () => dedupeCurrent(await pageSupplyLinks<RiskLink>(supabase, "*", (q) => q.eq("is_current", true).order("id"))) as RiskLink[],
  staleTime: 10 * 60_000,
};

/** Every link `ticker` stated, including prior 10-Ks — for "what changed". */
export const supplyHistoryQuery = (ticker: string) => ({
  queryKey: ["supply-links-history", "trusted", ticker],
  // every filing is kept (no dedupe): "what changed" compares one filing with another
  queryFn: async () => pageSupplyLinks<RiskLink>(supabase, "*", (q) => q.eq("ticker", ticker).order("id")),
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
