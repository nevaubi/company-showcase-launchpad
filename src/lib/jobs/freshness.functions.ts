// Admin-only freshness and pipeline status read: data advance per dataset, paused jobs (grouped),
// provider circuits, open alerts, job health, stalled cursors and top-1,000 coverage. Aggregated in
// SQL (data_freshness, job_health, data_coverage); every part beyond datasets is optional, so the page
// still loads when one read fails.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dataFreshness, groupPaused, pausedJobs } from "@/lib/jobs/data-freshness";
import { coverageOrder, jobStatus, openAlerts, providerStatus, stalledCursors, unfinishedRate, type CoverageRow } from "@/lib/jobs/status";
import type { JobHealthRow, StateRow } from "@/lib/jobs/watchdog";

export const getDataFreshness = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) throw new Error("Admins only");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const cursorJobs = ["prices", "macro", "sec", "alt-data", "filing-cache", "options"];
    const [fresh, paused, health, coverage, special] = await Promise.all([
      supabaseAdmin.rpc("data_freshness"),
      supabaseAdmin.from("job_state").select("job,paused_reason,updated_at").not("paused_reason", "is", null).limit(1000),
      supabaseAdmin.rpc("job_health", { _hours: 24 }),
      supabaseAdmin.rpc("data_coverage"),
      supabaseAdmin
        .from("job_state")
        .select("job,cursor,paused_reason,updated_at")
        .or(`job.like."provider:*",job.like."alert:*",job.in.(${[...cursorJobs, ...cursorJobs.map((j) => `${j}-slice`)].join(",")})`)
        .limit(1000),
    ]);
    if (fresh.error) throw new Error(fresh.error.message);
    const now = Date.now();
    const states = (special.data ?? []) as StateRow[];
    const jobsRows = (health.data ?? []) as JobHealthRow[];
    return {
      at: new Date(now).toISOString(),
      datasets: dataFreshness((fresh.data ?? []) as { key: string; newest: string | null }[], new Date(now)),
      paused: groupPaused(pausedJobs((paused.data ?? []) as { job: string; paused_reason: string | null; updated_at: string }[])),
      providers: special.error ? null : providerStatus(states, now),
      alerts: special.error ? null : openAlerts(states),
      stalled: special.error ? null : stalledCursors(states, now),
      jobs: health.error ? null : jobStatus(jobsRows, now),
      unfinished: health.error ? null : unfinishedRate(jobsRows),
      coverage: coverage.error ? null : coverageOrder((coverage.data ?? []) as CoverageRow[]),
    };
  });
