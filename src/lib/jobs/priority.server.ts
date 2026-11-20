/**
 * Company priority for the scheduled HTTP jobs: rank by 20-day dollar volume (`setup_series.dv20`,
 * the only size measure the database carries for every company). "Top 1,000" = the 1,000 covered
 * tickers with the highest dv20. Cached per isolate for 6 hours; one small read (1,000 rows) when
 * cold. On any failure, or with PRIORITY_ORDER=0, the rank is empty and jobs keep COVERAGE order.
 */
import { priorityEnabled, PRIORITY_TOP, rankFromDv20 } from "@/lib/jobs/priority";

const TTL_MS = 6 * 3600_000;
let cached: { rank: Map<string, number>; at: number } | null = null;

export async function loadJobRank(): Promise<Map<string, number>> {
  if (!priorityEnabled(process.env)) return new Map();
  if (cached && Date.now() - cached.at < TTL_MS) return cached.rank;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.from("setup_series").select("ticker, dv20").not("dv20", "is", null).order("dv20", { ascending: false }).limit(PRIORITY_TOP);
    if (error) throw new Error(error.message);
    const rank = rankFromDv20((data ?? []) as { ticker: string; dv20: number | null }[]);
    cached = { rank, at: Date.now() };
    return rank;
  } catch (e) {
    console.warn(`[rank] dv20 rank unavailable (${(e as Error).message.slice(0, 120)}); keeping COVERAGE order`);
    return cached?.rank ?? new Map();
  }
}

/** Test hook. */
export const resetJobRank = () => {
  cached = null;
};
