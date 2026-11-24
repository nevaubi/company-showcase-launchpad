import { createServerFn } from "@tanstack/react-start";
import { requireAppAccess } from "@/lib/app-access-middleware";
import { tapeFile, type TapeFile, type TapeRow } from "./breadth";
import { readAllPages, singleFlight } from "./breadth.read";

/**
 * Every covered company's trend flags and 60-day volatility from `setup_series`, which only the service
 * role reads. Only the columns the sector pages show are selected (about 130 KB for 1,780 rows; the close
 * arrays in the same table are megabytes and stay unread). Rows older than a week before the newest
 * session are left out. One read is kept for 15 minutes per server instance and shared by concurrent calls.
 */
const COLUMNS = "ticker, end_date, vol60, above200, near_high";

const read = singleFlight(15 * 60_000, async (): Promise<TapeFile> => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const rows = await readAllPages<TapeRow>(async (from, to) => {
    const { data, error, count } = await supabaseAdmin
      .from("setup_series")
      .select(COLUMNS, from === 0 ? { count: "exact" } : undefined)
      .order("ticker")
      .range(from, to);
    if (error) throw new Error(`setup_series: ${error.message}`);
    return { rows: (data ?? []) as unknown as TapeRow[], total: count ?? null };
  });
  return tapeFile(rows);
});

export const getSectorBreadth = createServerFn({ method: "GET" })
  .middleware([requireAppAccess])
  .handler((): Promise<TapeFile> => read());
