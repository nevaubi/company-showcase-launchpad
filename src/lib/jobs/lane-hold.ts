/**
 * Owner holds (pure). The owner stops a background lane and it stays stopped until the owner lets it go.
 *
 * A hold lives on the lane's own `job_state` row:
 *   paused_reason  "owner: hold. <why> (since YYYY-MM-DD)"
 *   lease_until    far in the future, so a worker built before holds existed cannot take the lease either
 *
 * A held lane makes no calls and stores nothing. Freshness shows the datasets it feeds as held, not
 * stale, and the watchdog raises nothing for them: silence the owner asked for is not a fault.
 * `owner:<host>` (the IR loop's lease tag) and `pacing:` reasons are not holds.
 */
export const OWNER_HOLD_PREFIX = "owner: hold.";

/** Lease end written with a hold; any real lease is minutes long. */
export const HOLD_LEASE_UNTIL = "2099-12-31T00:00:00.000Z";

/**
 * Lanes whose loop checks `isOwnerHold` before taking work. Add a lane here in the same change that
 * teaches its loop the check, never before: a hold on a lane that does not look is a promise not kept.
 */
export const HOLDABLE_LANES = ["vendor-backfill"] as const;
export type HoldableLane = (typeof HOLDABLE_LANES)[number];
export const isHoldableLane = (job: string): job is HoldableLane => (HOLDABLE_LANES as readonly string[]).includes(job);

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

/** job → what to show, for every row under an owner hold. */
export function ownerHolds(rows: readonly HoldRow[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rows) if (isOwnerHold(r.paused_reason)) out.set(r.job, holdText(r.paused_reason!));
  return out;
}

/** Row patch that places a hold. */
export const holdPatch = (why: string, now: Date) => ({ paused_reason: ownerHoldReason(why, now), lease_until: HOLD_LEASE_UNTIL, updated_at: now.toISOString() });

/** Row patch that releases one: the lane takes its lease again on its next look. */
export const releasePatch = (now: Date) => ({ paused_reason: null, lease_until: null, updated_at: now.toISOString() });
