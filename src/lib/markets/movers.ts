// movers.json: largest one-day and one-month moves among covered companies above $2B market cap,
// written by the pipeline together with index.json (daily closes from the Yahoo Finance chart API).
import { queryOptions } from "@tanstack/react-query";
import { partnerFile } from "@/lib/data";

export interface Mover {
  ticker: string;
  name: string | null;
  sector: string | null;
  price: number | null;
  chg_1d: number | null;
  ret_1m: number | null;
  market_cap: number | null;
  as_of: string | null;
  logo?: string | null;
}
export interface MoversFile {
  generated: string;
  as_of: string | null;
  min_market_cap: number;
  universe: number;
  day: { up: Mover[]; down: Mover[] };
  month: { up: Mover[]; down: Mover[] };
  source: string;
}

export const moversQuery = queryOptions({
  queryKey: ["movers"],
  queryFn: () => partnerFile<MoversFile>("movers.json"),
  staleTime: 10 * 60_000,
  retry: 0,
});

/** Sector ETF returns for one window, largest first; groups without an ETF return are left out. */
export function sectorStrip(
  groups: {
    kind: string;
    name: string;
    etf?: string | null;
    slug: string;
    returns?: { etf?: Record<string, number | null> | null } | null;
  }[],
  window: string,
) {
  return groups
    .filter((g) => g.kind === "sector" && g.etf && g.returns?.etf?.[window] != null)
    .map((g) => ({
      name: g.name,
      etf: g.etf!,
      slug: g.slug,
      ret: g.returns!.etf![window] as number,
    }))
    .sort((a, b) => b.ret - a.ret);
}
