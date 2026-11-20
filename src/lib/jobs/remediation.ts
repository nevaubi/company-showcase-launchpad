/**
 * Freshness remediation (pure): what the hourly freshness check does about a stale dataset.
 *
 *   loop   ask the Render worker to run a step now: a `loop-request:<step>` row in job_state; the
 *          loop (the one writer of its own state file) clears the step's timer when it sees the row
 *   intel  ask the weekly supply-intel step for one run: a `supply-intel-request` row. The step
 *          honours it once, and only when its marker is clean and its last advance has no recorded
 *          run behind it (intelDue in scripts/lib/filing-steps.ts); the marker, its retry count and
 *          its give-up are never touched from here
 *   alert  nothing to do automatically: the scheduler or the owner drives it; the watchdog alerts
 *
 * A remedy asks at most once per staleness episode (review R3). The episode is the dataset's newest
 * timestamp: it stays the same for as long as the dataset does not move, so the receipt
 * `remedy:<key>` (cursor = time, paused_reason = `episode:<newest>`) blocks a second request until
 * new data arrives and goes stale again. AI steps (`requires: "ai"`) ask only while the AI route is
 * healthy; while it is closed nothing is written, so the one request goes out when credit returns.
 * The watchdog does not wait for remedies beyond a fixed 6 h grace (watchdog.ts).
 */

export type Remedy = { kind: "loop"; step: string; requires?: "ai" } | { kind: "intel"; requires: "ai" } | { kind: "alert" };

export const REMEDY: Record<string, Remedy> = {
  supply_signals: { kind: "intel", requires: "ai" },
  ir_label_map: { kind: "loop", step: "canon", requires: "ai" },
  analytics_markets: { kind: "loop", step: "analytics:markets" },
  analytics_auctions: { kind: "loop", step: "analytics:auctions" },
  analytics_hedge: { kind: "loop", step: "analytics:hedge" },
  analytics_context: { kind: "loop", step: "analytics:context" },
  analytics_hq: { kind: "loop", step: "analytics:hq" },
  alt_ownership: { kind: "loop", step: "alt-slow" },
  alt_contracts: { kind: "loop", step: "alt-slow" },
  alt_recalls: { kind: "loop", step: "alt-slow" },
  xbrl_concentration: { kind: "loop", step: "detail" },
  partner_mirror: { kind: "loop", step: "mirror" },
};

/** Keys with an automatic remedy (the watchdog waits 6 h after one before alerting). */
export const REMEDY_KEYS: ReadonlySet<string> = new Set(Object.entries(REMEDY).filter(([, r]) => r.kind !== "alert").map(([k]) => k));

export const remedyKey = (key: string) => `remedy:${key}`;
export const loopRequestKey = (step: string) => `loop-request:${step}`;
export const INTEL_REQUEST_KEY = "supply-intel-request";

/** The staleness episode a dataset is in: its newest timestamp (or "none" when it has no data). */
export const episodeOf = (newest: string | null | undefined) => `episode:${newest ?? "none"}`;

export interface RemedyReceipt {
  /** epoch s of the request */
  at: number;
  /** `episode:<newest>` the request was made in (null: written before episodes were recorded) */
  episode: string | null;
}

export interface RemedyAction {
  key: string;
  remedy: Remedy;
  /** apply now (false: skipped, see `why`) */
  apply: boolean;
  /** write the `remedy:<key>` receipt now (the request was made in this episode) */
  receipt: boolean;
  why: string;
}

/**
 * For each stale or missing key: ask its remedy once per staleness episode; an AI step only while
 * the AI route is healthy. `receipts` maps key → the last request.
 */
export function planRemedies(stale: readonly { key: string; newest?: string | null }[], receipts: ReadonlyMap<string, RemedyReceipt>, aiHealthy: boolean, nowMs: number): RemedyAction[] {
  const out: RemedyAction[] = [];
  const steps = new Set<string>();
  for (const s of stale) {
    const remedy = REMEDY[s.key];
    if (!remedy || remedy.kind === "alert") continue;
    const last = receipts.get(s.key);
    const episode = episodeOf(s.newest);
    if (last && last.episode === episode) {
      out.push({ key: s.key, remedy, apply: false, receipt: false, why: `already asked ${Math.round((nowMs - last.at * 1000) / 60_000)} min ago in this staleness episode` });
      continue;
    }
    if (remedy.requires === "ai" && !aiHealthy) {
      out.push({ key: s.key, remedy, apply: false, receipt: false, why: "AI route closed (credit or configuration); asks once it is healthy" });
      continue;
    }
    // One request per loop step even when several datasets share it (alt-slow feeds three keys).
    const step = remedy.kind === "loop" ? remedy.step : "intel";
    out.push({ key: s.key, remedy, apply: !steps.has(step), receipt: true, why: steps.has(step) ? `same step as an earlier remedy (${step})` : "applied" });
    steps.add(step);
  }
  return out;
}

/** Receipt rows → receipts (cursor = time, paused_reason = episode). */
export function readReceipts(rows: readonly { job: string; cursor: number | null; paused_reason: string | null }[]): Map<string, RemedyReceipt> {
  return new Map(rows.filter((r) => r.job.startsWith("remedy:")).map((r) => [r.job.slice("remedy:".length), { at: Number(r.cursor ?? 0), episode: r.paused_reason?.startsWith("episode:") ? r.paused_reason : null }]));
}

/** The persisted hourly gate: true when the last check (epoch s) is at least 55 min old. */
export const checkDue = (lastCheckS: number | null | undefined, nowMs: number) => !lastCheckS || nowMs - lastCheckS * 1000 >= 55 * 60_000;
