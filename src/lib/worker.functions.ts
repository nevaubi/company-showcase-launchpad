import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface WorkerProgress {
  now: string;
  lease: { lease_until: string | null; updated_at: string | null; paused: string | null } | null;
  facts: Record<string, number>;
  recent: Record<string, number>;
  docs: Record<string, [number, number]>;
  /** figures read from release text, per company */
  text?: Record<string, number>;
  /** releases whose text the text reader has read / still has to read */
  prose?: { waiting: number; read: number; working: number } | null;
  /** today's (UTC) use of the owner's free OpenAI allowance by the second reader, per model group */
  openai?: Partial<Record<"large" | "mini", { tokens: number; calls: number }>>;
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
    memLimitGB: number | null;
    memUsedGB: number | null;
    instance: string | null;
    startedAt: string | null;
    review: Record<string, string>;
    stage: Record<string, string>;
    finishedLog: { t: string; at: string }[];
  } | null;
  universe: string[];
  /** Filed Under office engine on Render (/health), null when unreachable */
  engine: { ok: boolean; version: string; sessions: number; users: number } | null;
}

/** Admin-only live view of the always-on IR worker: lease, loop state file, live figure counts. */
export const getWorkerProgress = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WorkerProgress> => {
    // The RPC itself refuses non-admins, so this check happens in the database.
    const { data, error } = await context.supabase.rpc("ir_live_progress");
    if (error) throw new Error(error.message);
    const live = data as Pick<WorkerProgress, "lease" | "facts" | "recent" | "docs" | "text" | "prose" | "openai">;
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
        memLimitGB: j.memLimitGB ?? null,
        memUsedGB: j.memUsedGB ?? null,
        instance: j.instance ?? null,
        startedAt: j.startedAt ?? null,
        review: j.review ?? {},
        stage: j.stage ?? {},
        finishedLog: j.finishedLog ?? [],
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
    let engine: WorkerProgress["engine"] = null;
    try {
      const r = await fetch("https://filedunder-office-engine.onrender.com/health", { signal: AbortSignal.timeout(4000) });
      if (r.ok) engine = (await r.json()) as NonNullable<WorkerProgress["engine"]>;
    } catch {
      engine = null;
    }
    return { now: new Date().toISOString(), ...live, loop, universe, engine };
  });
