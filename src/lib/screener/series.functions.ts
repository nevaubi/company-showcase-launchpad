import { createServerFn } from "@tanstack/react-start";
import { requireAppAccess } from "@/lib/app-access-middleware";
import { SERIES_COLUMNS, type SeriesRow } from "./series";

const COLUMNS = SERIES_COLUMNS.join(", ");
const PAGE = 1000;
const TTL_MS = 30 * 60_000;
let cached: { rows: SeriesRow[]; at: number } | null = null;

/**
 * The columns of every `setup_series` row the screener uses (about 1,800 rows, no close arrays) for its
 * liquidity and short-volume fields. The table is service-role only, so it is read here behind
 * requireAppAccess. Cached per server instance for 30 minutes; the setup job rewrites it once a day.
 */
export const getScreenSeries = createServerFn({ method: "GET" })
  .middleware([requireAppAccess])
  .handler(async (): Promise<{ rows: SeriesRow[]; error?: string }> => {
    if (cached && Date.now() - cached.at < TTL_MS) return { rows: cached.rows };
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const rows: SeriesRow[] = [];
      for (let from = 0; from < 10 * PAGE; from += PAGE) {
        const { data, error } = await supabaseAdmin
          .from("setup_series")
          .select(COLUMNS)
          .order("ticker")
          .range(from, from + PAGE - 1);
        if (error) throw new Error(error.message);
        rows.push(...((data ?? []) as unknown as SeriesRow[]));
        if (!data || data.length < PAGE) break;
      }
      cached = { rows, at: Date.now() };
      return { rows };
    } catch (e) {
      return { rows: cached?.rows ?? [], error: (e as Error).message.slice(0, 200) };
    }
  });
