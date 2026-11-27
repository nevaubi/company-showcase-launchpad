/**
 * What a worker lane asks and tells about itself (rules: src/lib/jobs/lanes.ts, lane-hold.ts).
 *
 *   heldReason(lane)   the owner's hold on the lane, or null. Read from the database at most every
 *                      20 s for all lanes of this process together; a held lane's row is stamped
 *                      with the time it was seen (once a minute), which is how the board knows the
 *                      running worker really looks.
 *   working(lane)      marks a run in progress (`lane:<id>`), renewed every minute until `done()`.
 *
 * A read that fails keeps the last answer: a lane that was held stays held, a lane that was free
 * keeps working. Nothing here throws into a lane's loop.
 */
import { isOwnerHold, holdText } from "@/lib/jobs/lane-hold";
import { HOLD_ROW_PREFIX, LANES, MARK_TTL_MS, holdKey, laneById, laneOfHoldKey, markKey } from "@/lib/jobs/lanes";
import { sb } from "./supa";

const READ_EVERY_MS = 20_000;
const SEEN_EVERY_MS = 60_000;
let holds = new Map<string, string>();
let readAt = 0;
let reading: Promise<void> | null = null;
const seenAt = new Map<string, number>();
const OWN_ROWS = LANES.flatMap((l) => (l.holdOn ? [l.holdOn] : []));

async function read() {
  try {
    const { data, error } = await sb
      .from("job_state")
      .select("job, paused_reason")
      .or(`job.like."${HOLD_ROW_PREFIX}*"${OWN_ROWS.length ? `,job.in.(${OWN_ROWS.join(",")})` : ""}`)
      .limit(500);
    if (error) throw new Error(error.message);
    const next = new Map<string, string>();
    for (const r of (data ?? []) as { job: string; paused_reason: string | null }[]) {
      const lane = laneOfHoldKey(r.job);
      if (lane && isOwnerHold(r.paused_reason)) next.set(lane, holdText(r.paused_reason!));
    }
    holds = next;
    readAt = Date.now();
  } catch (e) {
    // keep the last answer; try again at the next look
    readAt = Date.now() - READ_EVERY_MS + 5_000;
    console.warn(`[lanes] holds unreadable (${(e as Error).message.slice(0, 100)}); keeping the last known state`);
  }
}

/** Every lane under an owner hold, as last read (at most 20 s old). */
export async function heldLanes(): Promise<ReadonlyMap<string, string>> {
  if (Date.now() - readAt >= READ_EVERY_MS) {
    reading ??= read().finally(() => (reading = null));
    await reading;
  }
  return holds;
}

/** The owner's reason when `lane` is held, else null. Stamps the hold as seen. */
export async function heldReason(lane: string): Promise<string | null> {
  const why = (await heldLanes()).get(lane) ?? null;
  if (why != null) stampSeen(lane);
  return why;
}

/** The same answer from the last read, without waiting (for guards that must stay synchronous). */
export function heldNow(lane: string): string | null {
  const why = holds.get(lane) ?? null;
  if (why != null) stampSeen(lane);
  return why;
}

function stampSeen(lane: string) {
  const key = holdKey(lane);
  // a hold on the lane's own lease row needs no stamp: the lease keeps the lane out
  if (!key.startsWith(HOLD_ROW_PREFIX)) return;
  const last = seenAt.get(lane) ?? 0;
  if (Date.now() - last < SEEN_EVERY_MS) return;
  seenAt.set(lane, Date.now());
  // only the cursor moves: updated_at stays the time the hold was placed
  void sb.from("job_state").update({ cursor: Math.floor(Date.now() / 1000) }).eq("job", key).like("paused_reason", "owner: hold.%").then(undefined, () => undefined);
}

const marks = new Map<string, { timer: ReturnType<typeof setInterval>; started: string; count: number }>();
const put = (lane: string, started: string) =>
  sb.from("job_state").upsert({ job: markKey(lane), cursor: 0, paused_reason: null, lease_until: new Date(Date.now() + MARK_TTL_MS).toISOString(), updated_at: started }).then(undefined, () => undefined);

/**
 * A run of `lane` is in progress from now until the returned function is called. Runs of one lane
 * may overlap (parallel company builds): the marker stays until the last one is done.
 */
export function working(lane: string): () => void {
  // a step that is not a lane on the board (the freshness check, the reaper) leaves no marker
  if (!laneById(lane)) return () => undefined;
  let m = marks.get(lane);
  if (!m) {
    const started = new Date().toISOString();
    m = { started, count: 0, timer: setInterval(() => void put(lane, started), 60_000) };
    m.timer.unref?.();
    marks.set(lane, m);
    void put(lane, started);
  }
  m.count++;
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    const cur = marks.get(lane);
    if (!cur || --cur.count > 0) return;
    clearInterval(cur.timer);
    marks.delete(lane);
    void sb.from("job_state").update({ lease_until: null }).eq("job", markKey(lane)).then(undefined, () => undefined);
  };
}
