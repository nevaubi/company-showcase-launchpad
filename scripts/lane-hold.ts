/**
 * Owner holds on background lanes (rules: src/lib/jobs/lane-hold.ts).
 *
 *   bun scripts/lane-hold.ts list
 *   bun scripts/lane-hold.ts hold vendor-backfill "Stopped while the archive is planned in"
 *   bun scripts/lane-hold.ts release vendor-backfill
 *
 * A hold writes the reason and takes the lane's lease out of reach, so the running copy loses it within
 * one heartbeat and every later copy waits. A release clears both; the lane starts on its next look.
 * Only lanes that check for a hold can be held (HOLDABLE_LANES).
 */
import { log, sb } from "./lib/supa";
import { HOLDABLE_LANES, holdPatch, holdText, isHoldableLane, isOwnerHold, releasePatch } from "../src/lib/jobs/lane-hold";

const [action, job, ...rest] = process.argv.slice(2);
const usage = () => {
  log(`usage: lane-hold.ts list | hold <lane> "<why>" | release <lane>   (lanes: ${HOLDABLE_LANES.join(", ")})`);
  process.exit(2);
};

if (action === "list") {
  const { data, error } = await sb.from("job_state").select("job,paused_reason,lease_until,updated_at").in("job", [...HOLDABLE_LANES]);
  if (error) throw new Error(error.message);
  const by = new Map((data ?? []).map((r) => [r.job, r]));
  for (const lane of HOLDABLE_LANES) {
    const r = by.get(lane);
    if (!r) log(`${lane}: no state yet (never ran)`);
    else if (isOwnerHold(r.paused_reason)) log(`${lane}: HELD. ${holdText(r.paused_reason!)}`);
    else log(`${lane}: running${r.paused_reason ? ` (${r.paused_reason})` : ""}; lease ${r.lease_until ?? "free"}; last update ${r.updated_at}`);
  }
  process.exit(0);
}

if (!job || !isHoldableLane(job)) usage();
const now = new Date();

if (action === "hold") {
  const why = rest.join(" ");
  if (!why.trim()) usage();
  const patch = holdPatch(why, now);
  // The row exists once the lane has run; a lane that never ran gets one, so its first start finds the hold.
  const { data, error } = await sb.from("job_state").upsert({ job, ...patch }, { onConflict: "job" }).select("job,paused_reason,lease_until");
  if (error) throw new Error(error.message);
  log(`held ${job}: ${holdText(data?.[0]?.paused_reason ?? patch.paused_reason)}`);
  process.exit(0);
}

if (action === "release") {
  // Only a hold is released: a lease another copy holds for real work is never cleared from here.
  const { data: row, error: readError } = await sb.from("job_state").select("paused_reason").eq("job", job).maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!isOwnerHold(row?.paused_reason)) {
    log(`${job} is not held; nothing to release`);
    process.exit(0);
  }
  const { error } = await sb.from("job_state").update(releasePatch(now)).eq("job", job).eq("paused_reason", row!.paused_reason!);
  if (error) throw new Error(error.message);
  log(`released ${job}: it takes its lease on its next look (within five minutes)`);
  process.exit(0);
}

usage();
