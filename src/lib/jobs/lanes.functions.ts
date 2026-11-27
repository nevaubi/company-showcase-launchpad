// Admin-only lane board: every worker lane as running, waiting or held, what it did last, and the
// owner's Stop and Resume. The rules are pure in lanes.ts and lane-hold.ts; this file reads and writes.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isOwnerHold, placeHold, releasePatch } from "@/lib/jobs/lane-hold";
import { LANES, LANE_IDS, holdKey, laneBoard, laneById, markKey, type LaneRunRow, type LaneStateRow, type LaneView } from "@/lib/jobs/lanes";

export interface LaneBoard {
  at: string;
  lanes: LaneView[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
  if (!data) throw new Error("Admins only");
}

async function readBoard(): Promise<LaneBoard> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const keys = [...new Set(LANES.flatMap((l) => [holdKey(l.id), markKey(l.id)]))];
  const [states, runs] = await Promise.all([
    supabaseAdmin.from("job_state").select("job, cursor, paused_reason, lease_until, updated_at").in("job", keys),
    supabaseAdmin.rpc("lane_last_runs", { _jobs: [...LANE_IDS] }),
  ]);
  if (states.error) throw new Error(states.error.message);
  if (runs.error) throw new Error(runs.error.message);
  const now = Date.now();
  return { at: new Date(now).toISOString(), lanes: laneBoard((states.data ?? []) as LaneStateRow[], (runs.data ?? []) as unknown as LaneRunRow[], now) };
}

export const getLaneBoard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LaneBoard> => {
    await assertAdmin(context);
    return readBoard();
  });

const HoldInput = z.object({
  lane: z.string().refine((l) => LANE_IDS.includes(l), "Unknown lane"),
  action: z.enum(["hold", "release"]),
  why: z.string().trim().max(200).optional(),
});

/** Stop a lane (with the owner's reason) or let it go. Returns the board as it stands afterwards. */
export const setLaneHold = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => HoldInput.parse(d))
  .handler(async ({ data, context }): Promise<LaneBoard> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const def = laneById(data.lane)!;
    const key = holdKey(def.id);
    const now = new Date();
    if (data.action === "hold") {
      const why = (data.why ?? "").trim();
      if (why.length < 3) throw new Error("Say in a few words why the lane is stopped");
      // The row may not exist yet (a lane that never ran, or a first hold): upsert places it either way.
      const { error } = await supabaseAdmin.from("job_state").upsert({ job: key, ...placeHold(why, now, !!def.holdOn) }, { onConflict: "job" });
      if (error) throw new Error(error.message);
    } else {
      // Only a hold is released: a lease another copy holds for real work is never cleared from here.
      const { data: row, error: readError } = await supabaseAdmin.from("job_state").select("paused_reason").eq("job", key).maybeSingle();
      if (readError) throw new Error(readError.message);
      if (isOwnerHold(row?.paused_reason)) {
        const { error } = await supabaseAdmin.from("job_state").update(releasePatch(now)).eq("job", key).eq("paused_reason", row!.paused_reason!);
        if (error) throw new Error(error.message);
      }
    }
    // Who stopped or released what, kept with the other run records.
    await supabaseAdmin.from("job_runs").insert({ job: "lane-hold", started_at: now.toISOString(), finished_at: now.toISOString(), ok: true, items: 1, detail: { lane: def.id, action: data.action, by: context.userId, ...(data.action === "hold" ? { why: (data.why ?? "").trim() } : {}) } });
    return readBoard();
  });
