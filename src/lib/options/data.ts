// Browser reads of the nightly options snapshots (RLS: members with app access).
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { OptionsSource, TermPoint } from "./core";
import type { StoredMove } from "./as-of";
import { sameSource, sourceOf, type OptionsMeta } from "./source";

export interface OptionsRow {
  ticker: string;
  date: string;
  price: number;
  iv30: number | null;
  atm_iv: number | null;
  skew25: number | null;
  pc_oi: number | null;
  pc_vol: number | null;
  call_oi: number;
  put_oi: number;
  call_vol: number;
  put_vol: number;
  term: TermPoint[];
  fetched_at?: string;
  /** where the quotes came from; a history only compares rows of one source (`sameSource`) */
  source: OptionsSource;
  /** how the day was read (Yahoo rows) */
  meta: OptionsMeta | null;
}

export interface OptionsBoardRow extends OptionsRow {
  /** prior recorded days with an IV30 in the last year, and their range */
  iv_n: number | null;
  iv_min: number | null;
  iv_max: number | null;
  /** prior days with a lower IV30 than today */
  iv_below: number | null;
  /** IV30 on the previous recorded day */
  iv_prev: number | null;
  /** average total option volume over up to 20 prior recorded days */
  vol_avg20: number | null;
}

const num = (x: unknown) => (x == null ? null : Number(x));

export const optionsHistoryQuery = (ticker: string) =>
  queryOptions({
    queryKey: ["options", ticker.toUpperCase()],
    queryFn: async (): Promise<OptionsRow[]> => {
      const { data, error } = await supabase
        .from("options_daily")
        .select("ticker, date, price, iv30, atm_iv, skew25, pc_oi, pc_vol, call_oi, put_oi, call_vol, put_vol, term, fetched_at, source, meta")
        .eq("ticker", ticker.toUpperCase())
        .order("date", { ascending: false })
        .limit(400);
      if (error) throw new Error(error.message);
      // newest first; only the newest row's source, so a rank never mixes Cboe's figures with computed ones
      return sameSource((data ?? []).map((r) => ({
        ...r,
        price: Number(r.price),
        iv30: num(r.iv30),
        atm_iv: num(r.atm_iv),
        skew25: num(r.skew25),
        pc_oi: num(r.pc_oi),
        pc_vol: num(r.pc_vol),
        term: (r.term ?? []) as unknown as TermPoint[],
        source: sourceOf(r),
        meta: (r.meta ?? null) as OptionsMeta | null,
      })));
    },
    staleTime: 30 * 60_000,
    retry: 1,
  });

export const optionsBoardQuery = queryOptions({
  queryKey: ["options-board"],
  queryFn: async (): Promise<OptionsBoardRow[]> => {
    const out: OptionsBoardRow[] = [];
    for (let from = 0; from < 10000; from += 1000) {
      const { data, error } = await supabase.rpc("options_board_v2").order("ticker").range(from, from + 999);
      if (error) throw new Error(error.message);
      for (const r of data ?? [])
        out.push({
          ...r,
          price: Number(r.price),
          iv30: num(r.iv30),
          atm_iv: num(r.atm_iv),
          skew25: num(r.skew25),
          pc_oi: num(r.pc_oi),
          pc_vol: num(r.pc_vol),
          call_oi: Number(r.call_oi),
          put_oi: Number(r.put_oi),
          call_vol: Number(r.call_vol),
          put_vol: Number(r.put_vol),
          term: (r.term ?? []) as unknown as TermPoint[],
          source: sourceOf(r),
          meta: (r.meta ?? null) as OptionsMeta | null,
          iv_n: num(r.iv_n),
          iv_min: num(r.iv_min),
          iv_max: num(r.iv_max),
          iv_below: num(r.iv_below),
          iv_prev: num(r.iv_prev),
          vol_avg20: num(r.vol_avg20),
        });
      if ((data ?? []).length < 1000) break;
    }
    return out;
  },
  staleTime: 30 * 60_000,
  retry: 1,
});

/** IV rank and percentile from the board's history columns (null until enough days are recorded). */
export function boardIvRank(r: OptionsBoardRow, minDays = 20): { rank: number; pct: number; n: number } | null {
  if (r.iv30 == null || !r.iv_n || r.iv_n < minDays || r.iv_min == null || r.iv_max == null) return null;
  const lo = Math.min(r.iv_min, r.iv30);
  const hi = Math.max(r.iv_max, r.iv30);
  return { rank: hi > lo ? (r.iv30 - lo) / (hi - lo) : 0.5, pct: (r.iv_below ?? 0) / r.iv_n, n: r.iv_n };
}

/** Today's option volume against its recent average (needs five prior recorded days). */
export function volumeRatio(r: OptionsBoardRow): number | null {
  if (!r.vol_avg20 || !r.iv_n || r.iv_n < 5) return null;
  return (r.call_vol + r.put_vol) / r.vol_avg20;
}

/** How each covered stock moved after its recent reports (`scripts/earnings-reactions.ts`). */
export interface ReactionsFile {
  generated: string;
  basis: string;
  companies: Record<string, { generated?: string; n: number; median: number; mean: number; moves: StoredMove[] }>;
}
export const reactionsQuery = queryOptions({
  queryKey: ["earnings-reactions"],
  queryFn: async (): Promise<ReactionsFile | null> => {
    const { data, error } = await supabase.storage.from("datasets").download("markets/reactions.json");
    if (error || !data) return null;
    return JSON.parse(await data.text()) as ReactionsFile;
  },
  staleTime: 6 * 3600_000,
  retry: 1,
});

/** The closing quote for this signal's trading session. Later quotes cannot describe its setup. */
export const setupQuoteQuery = (ticker: string, session: string) =>
  queryOptions({
    queryKey: ["setup-options", ticker, session],
    queryFn: async () => {
      const { data, error } = await supabase.from("options_daily").select("date, price, term, skew25, pc_oi, source, meta")
        .eq("ticker", ticker).eq("date", session).maybeSingle();
      if (error) throw new Error(error.message);
      return data ? { date: data.date, price: Number(data.price), term: (data.term ?? []) as unknown as TermPoint[],
        skew: num(data.skew25), putCall: num(data.pc_oi), source: sourceOf(data), meta: (data.meta ?? null) as OptionsMeta | null } : null;
    },
    staleTime: 30 * 60_000,
    retry: 1,
  });
