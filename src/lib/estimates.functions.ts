import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { coverageOf } from "@/lib/coverage";
import type { Estimates } from "@/lib/estimates/core";

const STALE_MS = 6 * 3600_000;

/**
 * Consensus estimates, revisions, ratings and analyst actions. Reads the stored copy
 * (`scripts/estimates.ts`); when it is older than 6h tries a live refresh and keeps the
 * stored copy if the provider throttles.
 */
export const getEstimates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ ticker: z.string().min(1).max(10) }).parse(d))
  .handler(async ({ data, context }): Promise<{ estimates: Estimates | null; error: string | null }> => {
    const t = data.ticker.toUpperCase();
    if (!coverageOf(t)) return { estimates: null, error: "Not a covered company" };
    const { data: row } = await context.supabase.from("analyst_estimates").select("payload, fetched_at").eq("ticker", t).maybeSingle();
    const stored = (row?.payload as unknown as Estimates) ?? null;
    if (stored && Date.now() - Date.parse(row!.fetched_at) < STALE_MS) return { estimates: stored, error: null };
    try {
      const { fetchEstimates } = await import("@/lib/estimates.server");
      const fresh = await fetchEstimates(t);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.from("analyst_estimates").upsert({ ticker: t, payload: fresh as never, fetched_at: fresh.asOf });
      return { estimates: fresh, error: null };
    } catch (e) {
      console.warn("estimates live refresh", t, (e as Error).message);
      return stored ? { estimates: stored, error: null } : { estimates: null, error: "Estimates are temporarily unavailable" };
    }
  });
