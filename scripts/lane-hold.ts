/**
 * Owner holds on background lanes from the command line (rules: src/lib/jobs/lane-hold.ts, lanes.ts).
 * The admin page Live worker does the same with Stop and Resume.
 *
 *   bun scripts/lane-hold.ts list
 *   bun scripts/lane-hold.ts hold loop:canon "Saving credit this week"
 *   bun scripts/lane-hold.ts release loop:canon
 *
 * A hold is seen by the running lane within a minute (five for the bank and vendor lanes): it
 * starts nothing more, and a run in progress is stopped. A release clears it; the lane takes its work
 * again on its next look. Only lanes on the list can be held: each of them checks for its hold.
 */
import { log, sb } from "./lib/supa";
import { isOwnerHold, placeHold, releasePatch } from "../src/lib/jobs/lane-hold";
import { LANES, LANE_IDS, holdKey, laneBoard, laneById, markKey, type LaneRunRow, type LaneStateRow } from "../src/lib/jobs/lanes";

const [action, lane, ...rest] = process.argv.slice(2);
const usage = () => {
  log(`usage: lane-hold.ts list | hold <lane> "<why>" | release <lane>\nlanes: ${LANE_IDS.join(", ")}`);
  process.exit(2);
};

if (action === "list") {
  const keys = [...new Set(LANES.flatMap((l) => [holdKey(l.id), markKey(l.id)]))];
  const [states, runs] = await Promise.all([sb.from("job_state").select("job, cursor, paused_reason, lease_until, updated_at").in("job", keys), sb.rpc("lane_last_runs" as never, { _jobs: [...LANE_IDS] } as never)]);
  if (states.error) throw new Error(states.error.message);
  if (runs.error) throw new Error(runs.error.message);
  const ago = (iso: string) => {
    const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
    return m < 90 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
  };
  for (const v of laneBoard((states.data ?? []) as LaneStateRow[], (runs.data ?? []) as unknown as LaneRunRow[], Date.now())) {
    const state = v.state === "held" ? `HELD (${v.hold!.why}${v.hold!.since ? `, since ${v.hold!.since}` : ""}${v.hold!.unseen ? "; NOT YET SEEN by the worker" : v.hold!.seenAt ? `; seen ${ago(v.hold!.seenAt)}` : ""})` : v.state === "running" ? `running${v.runningSince ? ` since ${ago(v.runningSince)}` : ""}` : `waiting${v.late ? " (LATE)" : ""}`;
    const last = v.last ? `last run ${ago(v.last.at)}${v.last.ok === false ? ", failed" : ""}${v.last.note ? ` (${v.last.note})` : ""}` : "no run recorded";
    log(`${v.id.padEnd(26)} ${state}; ${last}; ${v.runs24h} runs in 24 h`);
  }
  process.exit(0);
}

const def = lane ? laneById(lane) : undefined;
if (!def) usage();
const key = holdKey(def!.id);
const now = new Date();

if (action === "hold") {
  const why = rest.join(" ");
  if (why.trim().length < 3) usage();
  // The row exists once the lane has run or was held before; otherwise this places it.
  const { data, error } = await sb.from("job_state").upsert({ job: key, ...placeHold(why, now, !!def!.holdOn) }, { onConflict: "job" }).select("job,paused_reason");
  if (error) throw new Error(error.message);
  await sb.from("job_runs").insert({ job: "lane-hold", started_at: now.toISOString(), finished_at: now.toISOString(), ok: true, items: 1, detail: { lane: def!.id, action: "hold", by: "command line", why: why.trim() } });
  log(`held ${def!.id}: ${data?.[0]?.paused_reason}`);
  process.exit(0);
}

if (action === "release") {
  // Only a hold is released: a lease another copy holds for real work is never cleared from here.
  const { data: row, error: readError } = await sb.from("job_state").select("paused_reason").eq("job", key).maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!isOwnerHold(row?.paused_reason)) {
    log(`${def!.id} is not held; nothing to release`);
    process.exit(0);
  }
  const { error } = await sb.from("job_state").update(releasePatch(now)).eq("job", key).eq("paused_reason", row!.paused_reason!);
  if (error) throw new Error(error.message);
  await sb.from("job_runs").insert({ job: "lane-hold", started_at: now.toISOString(), finished_at: now.toISOString(), ok: true, items: 1, detail: { lane: def!.id, action: "release", by: "command line" } });
  log(`released ${def!.id}: it takes its work again on its next look`);
  process.exit(0);
}

usage();
