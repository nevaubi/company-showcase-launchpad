import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface WorkerProgress {
  now: string;
  lease: { lease_until: string | null; updated_at: string | null; paused: string | null } | null;
  facts: Record<string, number>;
  recent: Record<string, number>;
  docs: Record<string, [number, number]>;
  loop: {
    attempted: string[];
    done: string[];
    current: string[];
    cycle: number | null;
    cycleStartedAt: string | null;
    heartbeat: string | null;
    lastMirror: string | null;
    resumes: Record<string, number>;
    healed: string[];
    log: string[];
  } | null;
  universe: string[];
}

/** Admin-only live view of the always-on IR worker: lease, loop state file, live figure counts. */
export const getWorkerProgress = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WorkerProgress> => {
    // The RPC itself refuses non-admins, so this check happens in the database.
    const { data, error } = await context.supabase.rpc("ir_live_progress");
    if (error) throw new Error(error.message);
    const live = data as Pick<WorkerProgress, "lease" | "facts" | "recent" | "docs">;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let loop: WorkerProgress["loop"] = null;
    const st = await supabaseAdmin.storage.from("ir-documents").download("ops/ir-deep-loop.json");
    if (st.data) {
      const j = JSON.parse(await st.data.text());
      loop = {
        attempted: j.attempted ?? [],
        done: j.done ?? [],
        current: j.current ?? [],
        cycle: j.cycle ?? null,
        cycleStartedAt: j.cycleStartedAt ?? null,
        heartbeat: j.heartbeat ?? null,
        lastMirror: j.lastMirror ?? null,
        resumes: j.resumes ?? {},
        healed: j.healed ?? [],
        log: j.log ?? [],
      };
    }
    let universe: string[] = [];
    const u = await supabaseAdmin.storage.from("datasets").download("universe.json");
    if (u.data) {
      const j = JSON.parse(await u.data.text()) as { companies: { ticker: string; revenueTTM?: number; revenueFY?: number }[] };
      universe = j.companies
        .sort((a, b) => (b.revenueTTM ?? b.revenueFY ?? 0) - (a.revenueTTM ?? a.revenueFY ?? 0))
        .map((c) => c.ticker);
    }
    return { now: new Date().toISOString(), ...live, loop, universe };
  });
