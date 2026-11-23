/**
 * Company priority for worker scripts: rank by 20-day dollar volume (`setup_series.dv20`, the only
 * size measure the database carries for every company), cached in memory for 6 hours. "Top 1,000" =
 * the 1,000 covered tickers with the highest dv20. On any failure the rank is empty and callers keep
 * their old order. PRIORITY_ORDER=0 turns ranking off.
 */
import { PRIORITY_TOP, priorityEnabled, rankFromDv20, topN } from "@/lib/jobs/priority";
import { sb } from "./supa";

const TTL_MS = 6 * 3600_000;
let cached: { rank: Map<string, number>; at: number } | null = null;

export async function loadRank(): Promise<Map<string, number>> {
  if (!priorityEnabled(process.env)) return new Map();
  if (cached && Date.now() - cached.at < TTL_MS) return cached.rank;
  try {
    // Responses are capped at 1,000 rows: page, so ranks past 1,000 order the tail too (review F13).
    const rows = await pageAll<{ ticker: string; dv20: number | null }>((from, to) => sb.from("setup_series").select("ticker, dv20").not("dv20", "is", null).order("dv20", { ascending: false }).order("ticker").range(from, to));
    const rank = rankFromDv20(rows);
    cached = { rank, at: Date.now() };
    return rank;
  } catch (e) {
    console.warn(`[rank] dv20 rank unavailable (${(e as Error).message.slice(0, 120)}) — keeping the default order`);
    return cached?.rank ?? new Map();
  }
}

/** Read every page of a query (1,000 rows a page, at most `maxPages`); any page error throws. */
export async function pageAll<R>(page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>, size = 1000, maxPages = 10): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < maxPages; i++) {
    const { data, error } = await page(i * size, i * size + size - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as R[]));
    if ((data ?? []).length < size) break;
  }
  return out;
}

export async function loadTop(n = PRIORITY_TOP): Promise<Set<string>> {
  return topN(await loadRank(), n);
}
