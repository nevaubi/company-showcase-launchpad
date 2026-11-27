/**
 * Owner holds (pure). The owner stops a background lane and it stays stopped until the owner lets it go.
 *
 * A hold is a `job_state` row (`holdKey(lane)` in lanes.ts: `hold:<lane>`, or the lane's own lease row
 * for the vendor collector):
 *   paused_reason  "owner: hold. <why> (since YYYY-MM-DD)"
 *   lease_until    far in the future on a lane's own lease row, so a worker built before holds
 *                  existed cannot take the lease either; empty on a `hold:<lane>` row
 *   cursor         on a `hold:<lane>` row: when the lane last saw the hold (epoch seconds)
 * Which lanes can be held is the list in lanes.ts: every lane there checks for its hold.
 *
 * A held lane makes no calls and stores nothing. Freshness shows the datasets it feeds as held, not
 * stale, and the watchdog raises nothing for them: silence the owner asked for is not a fault.
 * `owner:<host>` (the IR loop's lease tag) and `pacing:` reasons are not holds.
 */
export const OWNER_HOLD_PREFIX = "owner: hold.";

/** Lease end written with a hold; any real lease is minutes long. */
export const HOLD_LEASE_UNTIL = "2099-12-31T00:00:00.000Z";

export const isOwnerHold = (reason: string | null | undefined): boolean => typeof reason === "string" && reason.startsWith(OWNER_HOLD_PREFIX);

/** The reason stored with a hold. `why` is one plain sentence; line breaks and repeated spaces are folded. */
export function ownerHoldReason(why: string, now: Date): string {
  const text = why.replace(/\s+/g, " ").trim().replace(/[.;]+$/, "");
  if (!text) throw new Error("A hold needs a reason");
  return `${OWNER_HOLD_PREFIX} ${text} (since ${now.toISOString().slice(0, 10)})`;
}

/** What a page shows for a hold: the reason without its prefix. */
export const holdText = (reason: string): string => reason.slice(OWNER_HOLD_PREFIX.length).trim();

export interface HoldRow {
  job: string;
  paused_reason: string | null;
}

/**
 * lane → what to show, for every row under an owner hold. A `hold:<lane>` row is listed under its
 * lane's name, so a dataset's `heldBy` names the lane whichever row carries the hold.
 */
export function ownerHolds(rows: readonly HoldRow[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rows) if (isOwnerHold(r.paused_reason)) out.set(r.job.startsWith("hold:") ? r.job.slice(5) : r.job, holdText(r.paused_reason!));
  return out;
}

/** Row patch that places a hold on a lane's own lease row: the lease is put out of reach too. */
export const holdPatch = (why: string, now: Date) => ({ paused_reason: ownerHoldReason(why, now), lease_until: HOLD_LEASE_UNTIL, updated_at: now.toISOString() });

/** Row patch that places a hold on a `hold:<lane>` row: no lease, and "seen by the lane" starts at never. */
export const holdRowPatch = (why: string, now: Date) => ({ paused_reason: ownerHoldReason(why, now), lease_until: null, cursor: 0, updated_at: now.toISOString() });

/** The patch for a lane, by where its hold lives (`ownLease`: on the lane's own lease row). */
export const placeHold = (why: string, now: Date, ownLease: boolean) => (ownLease ? holdPatch(why, now) : holdRowPatch(why, now));

/** Row patch that releases one: the lane takes its work again on its next look. */
export const releasePatch = (now: Date) => ({ paused_reason: null, lease_until: null, updated_at: now.toISOString() });
