// Admin-only freshness read: data-advance status per dataset plus paused jobs, aggregated in SQL.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dataFreshness, pausedJobs } from "@/lib/jobs/data-freshness";

export const getDataFreshness = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) throw new Error("Admins only");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data, error }, { data: st }] = await Promise.all([
      supabaseAdmin.rpc("data_freshness"),
      supabaseAdmin.from("job_state").select("job,paused_reason,updated_at").not("paused_reason", "is", null),
    ]);
    if (error) throw new Error(error.message);
    return { datasets: dataFreshness((data ?? []) as { key: string; newest: string | null }[]), paused: pausedJobs(st ?? []) };
  });
