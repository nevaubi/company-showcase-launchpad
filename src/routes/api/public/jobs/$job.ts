import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

const JOB = z.enum(["prices", "macro", "sec", "filing-cache", "ir-docs", "ir-site", "ir-extract"]);

// Scheduled data refresh. Called only by the managed scheduler (bearer-authenticated).
export const Route = createFileRoute("/api/public/jobs/$job")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const authFailure = await authenticateCronRequest(request);
        if (authFailure) return authFailure;
        const job = JOB.safeParse(params.job);
        if (!job.success) return Response.json({ error: "Unknown job" }, { status: 404 });
        const { runJob } = await import("@/lib/jobs/jobs.server");
        const result = await runJob(job.data);
        return Response.json({ job: job.data, ...result }, { status: result.ok ? 200 : 500 });
      },
    },
  },
});
