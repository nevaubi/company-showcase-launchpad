import { createServerFn } from "@tanstack/react-start";
import { requireAppAccess } from "@/lib/app-access-middleware";
import { freshRows, returnsFromCloses, type MemberTape, type TapeFile } from "./breadth";

/**
 * Every covered company's recent returns and trend flags from `setup_series`, which only the service role
 * reads. Rows older than a week before the newest session are left out; the 3-, 6- and 12-month returns
 * are derived from the stored closes. About 1,800 small rows, kept for 15 minutes per server instance.
 */
let memo: { at: number; file: TapeFile } | null = null;
const TTL = 15 * 60_000;
const PAGE = 1000;

const round = (v: number | null | undefined, d = 5) => (v == null || !Number.isFinite(v) ? null : Number(v.toFixed(d)));

export const getSectorBreadth = createServerFn({ method: "GET" })
  .middleware([requireAppAccess])
  .handler(async (): Promise<TapeFile> => {
    if (memo && Date.now() - memo.at < TTL) return memo.file;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    type Row = { ticker: string; end_date: string; r5: number | null; r21: number | null; vol60: number | null; above200: boolean | null; near_high: boolean | null; c: number[] | null };
    const all: Row[] = [];
    for (let from = 0; from < 20_000; from += PAGE) {
      const { data, error } = await supabaseAdmin
        .from("setup_series")
        .select("ticker, end_date, r5, r21, vol60, above200, near_high, c")
        .order("ticker")
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`setup_series: ${error.message}`);
      all.push(...((data ?? []) as unknown as Row[]));
      if (!data || data.length < PAGE) break;
    }
    const fresh = freshRows(all);
    const rows: MemberTape[] = fresh.rows.map((r) => {
      const long = returnsFromCloses((r.c ?? []).map(Number));
      return {
        tk: r.ticker,
        r5: round(r.r5),
        r21: round(r.r21),
        r63: round(long.r63),
        r126: round(long.r126),
        r252: round(long.r252),
        vol60: round(r.vol60),
        above200: r.above200,
        near_high: r.near_high,
      };
    });
    const file = { asOf: fresh.asOf, rows };
    memo = { at: Date.now(), file };
    return file;
  });
