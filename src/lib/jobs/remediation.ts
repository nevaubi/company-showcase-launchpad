/**
 * Freshness remediation (pure): what the hourly freshness check does about a stale dataset.
 *
 *   loop   ask the Render worker to run a step now: a `loop-request:<step>` row in job_state; the
 *          loop (the one writer of its own state file) clears the step's timer when it sees the row
 *   intel  make the weekly supply-intel run due again (its marker's updated_at goes back to epoch)
 *   alert  nothing to do automatically: the scheduler or the owner drives it; the watchdog alerts
 *
 * A remedy runs at most once per 6 h per dataset (`remedy:<key>` receipt, cursor = time). AI steps
 * (`requires: "ai"`) run only while the AI route is healthy; otherwise the receipt still records
 * the check, so the watchdog alerts after 6 h instead of waiting for a remedy that cannot run.
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

export const REMEDY_EVERY_MS = 6 * 3600_000;
export const remedyKey = (key: string) => `remedy:${key}`;
export const loopRequestKey = (step: string) => `loop-request:${step}`;

export interface RemedyAction {
  key: string;
  remedy: Remedy;
  /** apply now (false: skipped, see `why`) */
  apply: boolean;
  /** write the `remedy:<key>` receipt now (applied, or checked while the AI route was closed) */
  receipt: boolean;
  why: string;
}

/**
 * For each stale or missing key: apply its remedy unless one ran within 6 h, or it needs the AI
 * route and the route is not healthy. `receipts` maps key → last remedy time (epoch s).
 */
export function planRemedies(stale: readonly { key: string }[], receipts: ReadonlyMap<string, number>, aiHealthy: boolean, nowMs: number): RemedyAction[] {
  const out: RemedyAction[] = [];
  const steps = new Set<string>();
  for (const s of stale) {
    const remedy = REMEDY[s.key];
    if (!remedy || remedy.kind === "alert") continue;
    const last = receipts.get(s.key);
    if (last != null && nowMs - last * 1000 < REMEDY_EVERY_MS) {
      out.push({ key: s.key, remedy, apply: false, receipt: false, why: `remedy ran ${Math.round((nowMs - last * 1000) / 60_000)} min ago` });
      continue;
    }
    if (remedy.requires === "ai" && !aiHealthy) {
      out.push({ key: s.key, remedy, apply: false, receipt: true, why: "AI route closed (credit or configuration); recorded for the watchdog" });
      continue;
    }
    // One request per loop step even when several datasets share it (alt-slow feeds three keys).
    const step = remedy.kind === "loop" ? remedy.step : "intel";
    out.push({ key: s.key, remedy, apply: !steps.has(step), receipt: true, why: steps.has(step) ? `same step as an earlier remedy (${step})` : "applied" });
    steps.add(step);
  }
  return out;
}

/** The persisted hourly gate: true when the last check (epoch s) is at least 55 min old. */
export const checkDue = (lastCheckS: number | null | undefined, nowMs: number) => !lastCheckS || nowMs - lastCheckS * 1000 >= 55 * 60_000;
