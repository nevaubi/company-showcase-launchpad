/**
 * Dead-man watchdog (pure). Runs inside the scheduled `emails` job, so a dead worker is noticed
 * without the worker's help. It turns database state into alerts, and alerts into at most one owner
 * email per 30 minutes:
 *
 *   worker-heartbeat     the worker's state file has not moved for 20 min
 *   job-failing:<job>    5 failed runs in a row (HTTP jobs) or 2 (worker `loop:*` steps)
 *   job-silent:<job>     a scheduled job has not run for 3x its cadence
 *   unfinished:<job>     30% or more of 20+ runs in 24 h never recorded a finish (scheduler cut-off)
 *   provider:<id>        a provider circuit open on quota or configuration for 2 h
 *   options-blocked      Cboe refuses option chains (the options job is backing off)
 *   registrant:<ticker>  SEC's ticker file maps a covered ticker to another CIK (weekly check)
 *   stale:<key>          a dataset is stale: at once when it has no automatic remedy, after 6 h of
 *                        staleness when it has one (the remedy's own timing does not matter)
 *
 * Each alert is an episode row `alert:<key>` in job_state (cursor = episode start, paused_reason =
 * `open: …` or `sent: …`). An episode is emailed once, after its grace period. When the condition
 * clears, the row is kept as `cleared open: …` / `cleared sent: …` (updated_at = when it cleared);
 * if the condition comes back within the recovery hold (6 h; 1 h for the worker heartbeat) the same
 * episode resumes and nothing is sent again. Only after a real recovery (clear for the whole hold)
 * is the row deleted, so a later recurrence is a new episode and a new email (review R2: a remedy
 * re-running every 6 h used to delete and re-send the same problem). New episodes due at the same
 * time go out as one digest; digests are at most one per 30 minutes (`alert-digest` row, cursor =
 * last send).
 */
import { parseReason } from "./provider-health";
import { SOURCES } from "./freshness";
import type { DataFreshness } from "./data-freshness";

export interface JobHealthRow {
  job: string;
  runs: number;
  unfinished: number;
  failed: number;
  last_ok: string | null;
  last_run: string | null;
  fail_streak: number;
}

export interface StateRow {
  job: string;
  cursor: number | null;
  paused_reason: string | null;
  updated_at: string | null;
}

export interface Alert {
  key: string;
  /** what is wrong (one line, plain) */
  title: string;
  /** what the system already does about it */
  tried: string;
  /** what the owner must do, if anything */
  action: string;
  /** minutes the condition must hold before an email */
  graceMin: number;
}

export interface WatchdogInput {
  freshness: DataFreshness[];
  jobs: JobHealthRow[];
  /** `provider:*`, `options-backoff`, `remedy:*`, `registrant-drift:*` rows */
  states: StateRow[];
}

export const HEARTBEAT_MAX_MIN = 20;
export const DIGEST_EVERY_MIN = 30;
export const REMEDY_WAIT_H = 6;
const ALERT_PREFIX = "alert:";
export const DIGEST_KEY = "alert-digest";
export const alertKey = (key: string) => `${ALERT_PREFIX}${key}`;

/** Freshness keys a remedy exists for (see remediation.ts); the others alert as soon as they are stale. */
export type RemedyKeys = ReadonlySet<string>;

const ageMin = (iso: string | null | undefined, nowMs: number) => (iso ? (nowMs - Date.parse(iso)) / 60_000 : Infinity);

/** Jobs the Render worker runs (the others are scheduled HTTP jobs). */
const WORKER_JOBS = new Set(["filing-steps", "alt-slow", "freshness", "xbrl-detail", "gov-sod", "gov-medicare-states", "gov-tri"]);

const inMarketHours = (d: Date) => {
  const day = d.getUTCDay();
  const h = d.getUTCHours();
  return day >= 1 && day <= 5 && h >= 13 && h <= 22;
};

export function alerts(input: WatchdogInput, nowMs: number, remedies: RemedyKeys = new Set()): Alert[] {
  const out: Alert[] = [];
  const now = new Date(nowMs);
  const fresh = new Map(input.freshness.map((f) => [f.key, f]));

  const hb = fresh.get("worker_heartbeat");
  const hbAge = ageMin(hb?.newest, nowMs);
  if (hbAge > HEARTBEAT_MAX_MIN)
    out.push({
      key: "worker-heartbeat",
      title: hb?.newest ? `Render worker silent: last heartbeat ${Math.round(hbAge)} min ago` : "Render worker heartbeat missing",
      tried: "worker-start restarts the loop by itself after a crash; nothing in the app can restart the service",
      action: "Open the Render dashboard for the worker service, check its logs and restart or redeploy it.",
      graceMin: 0,
    });

  for (const j of input.jobs) {
    const loop = j.job.startsWith("loop:");
    const limit = loop ? 2 : 5;
    // The freshness check "fails" whenever data is stale; those are the stale:<key> alerts.
    if (j.fail_streak >= limit && j.job !== "freshness")
      out.push({
        key: `job-failing:${j.job}`,
        title: `${j.job} failed ${j.fail_streak} runs in a row`,
        tried: loop ? "the worker retries the step on its next due time with a growing backoff" : "the job repeats the same slice on its next scheduled run",
        action: "Read the latest failed run in job_runs (detail.error) on the freshness page; fix the source or the configuration it names.",
        graceMin: 0,
      });
    if (j.runs >= 20 && j.unfinished / j.runs >= 0.3)
      out.push({
        key: `unfinished:${j.job}`,
        title: `${j.job}: ${Math.round((100 * j.unfinished) / j.runs)}% of ${j.runs} runs in 24 h never finished`,
        tried: "the reaper closes these runs and the job repeats the cut-off slice",
        action: "Raise the scheduler's HTTP timeout (statements in the round 2 report) or lower the job's slice size.",
        graceMin: 0,
      });
  }
  // Silent scheduled jobs (only cadences the 24 h window can judge).
  const byJob = new Map(input.jobs.map((j) => [j.job, j]));
  for (const s of SOURCES) {
    const limitMin = 3 * s.everyMin;
    if (limitMin > 24 * 60) continue;
    if (s.marketHours && !(inMarketHours(now) && inMarketHours(new Date(nowMs - limitMin * 60_000)))) continue;
    const last = byJob.get(s.job)?.last_run ?? null;
    if (ageMin(last, nowMs) > limitMin)
      out.push({
        key: `job-silent:${s.job}`,
        title: last ? `${s.label}: no run for ${Math.round(ageMin(last, nowMs))} min (expected every ${s.everyMin} min)` : `${s.label}: no run in 24 h (expected every ${s.everyMin} min)`,
        tried: "nothing: the scheduler (or the worker) did not call it",
        action: WORKER_JOBS.has(s.job) ? "Check the Render worker." : "Check the job's cron entry (cron.job) and the app host.",
        graceMin: 0,
      });
  }

  for (const r of input.states) {
    if (r.job.startsWith("provider:") && r.paused_reason) {
      const p = parseReason(r.paused_reason);
      if (!p || !(p.cls === "quota" || p.cls === "config" || p.cls === "allowance")) continue;
      const id = r.job.slice("provider:".length);
      // The free daily allowance running out is routine (it resets at 00:05 UTC); only a paid provider out of money needs the owner.
      if (p.cls === "allowance") continue;
      out.push({
        key: `provider:${id}`,
        title: `${id} closed: ${p.cls === "config" ? "configuration error" : "out of credit"} (${p.message.slice(0, 140)})`,
        tried: "calls are held; one probe is sent on a growing backoff and the work resumes by itself once it succeeds",
        action: p.cls === "config" ? "Fix the configuration the message names (key, model id or setting)." : "Add credit with the provider, or switch the readers to the free allowance.",
        graceMin: 120,
      });
    }
    if (r.job.startsWith("registrant-drift:") && r.paused_reason) {
      const ticker = r.job.slice("registrant-drift:".length);
      out.push({
        key: `registrant:${ticker}`,
        title: `${ticker} changed SEC registrant: ${r.paused_reason}`,
        tried: "nothing: the SEC feed jobs read only the CIKs coverage lists, so new filings under the other CIK are missed",
        action: `Set ${ticker}'s cik in src/lib/coverage.ts to SEC's CIK and keep the old one in formerCiks; tell the partner pipeline (statement history stays under the old CIK).`,
        graceMin: 0,
      });
    }
    if (r.job === "options-backoff" && r.paused_reason && (r.cursor ?? 0) > 0)
      out.push({
        key: "options-blocked",
        title: `Options collection blocked: ${r.paused_reason.replace(/^blocked: /, "")}`,
        tried: "the job holds its place and backs off from 2 to 60 minutes between tries",
        action: "Check whether Cboe blocks the app host, and decide on a slower pace or another source.",
        graceMin: 30,
      });
  }

  const receipts = new Map(input.states.filter((r) => r.job.startsWith("remedy:")).map((r) => [r.job.slice("remedy:".length), r]));
  for (const f of input.freshness) {
    if (f.status === "fresh" || f.key === "worker_heartbeat") continue;
    const has = remedies.has(f.key);
    const receipt = receipts.get(f.key);
    const triedAt = receipt?.cursor ? receipt.cursor * 1000 : null;
    // The episode exists for as long as the dataset is stale; a remedy only delays the email (grace).
    out.push({
      key: `stale:${f.key}`,
      title: f.status === "missing" ? `${f.label}: no data recorded` : `${f.label}: newest ${Math.round(f.ageHours ?? 0)} h old (limit ${f.maxAgeHours} h)`,
      tried: !has
        ? "no automatic remedy exists for this dataset"
        : triedAt != null
          ? `the automatic remedy asked for a run ${Math.round((nowMs - triedAt) / 3600_000)} h ago without effect (it asks once per staleness episode)`
          : "the automatic remedy has not run (its step needs the AI route, which is closed, or the hourly check is not running)",
      action: "Open the freshness page for the source job's latest runs.",
      graceMin: has ? REMEDY_WAIT_H * 60 : 0,
    });
  }
  return out;
}

export interface AlertPlan {
  /** episode rows to upsert (new episodes, and episodes marked sent) */
  upsert: StateRow[];
  /** what to upsert instead when the digest could not be handed to the outbox: nothing marked sent, no digest time */
  unsent: StateRow[];
  /** episode rows to delete (conditions that cleared) */
  close: string[];
  /** alerts to email now, as one digest (empty: send nothing) */
  send: (Alert & { since: string })[];
  /** digest idempotency state: sorted `key@start` */
  digestState: string | null;
}

/** `open: <title>` or `sent: <title>`, either behind `cleared ` while the recovery hold runs */
const episodeSent = (r: StateRow) => /^(cleared )?sent:/.test(r.paused_reason ?? "");
const CLEARED = "cleared ";
export const episodeCleared = (r: StateRow) => (r.paused_reason ?? "").startsWith(CLEARED);

/** How long a condition must stay clear before its episode ends (a recurrence after that is new). */
export const recoveryMin = (key: string) => (key === "worker-heartbeat" ? 60 : 6 * 60);

export function planAlerts(active: Alert[], rows: StateRow[], nowMs: number): AlertPlan {
  const nowS = Math.floor(nowMs / 1000);
  const at = new Date(nowMs).toISOString();
  const episodes = new Map(rows.filter((r) => r.job.startsWith(ALERT_PREFIX)).map((r) => [r.job, r]));
  const lastDigest = Number(rows.find((r) => r.job === DIGEST_KEY)?.cursor ?? 0);
  const activeKeys = new Set(active.map((a) => alertKey(a.key)));
  const upsert: StateRow[] = [];
  const close: string[] = [];
  // Cleared conditions: hold the episode through the recovery time, then end it.
  for (const [k, ep] of episodes) {
    if (activeKeys.has(k)) continue;
    if (!episodeCleared(ep)) upsert.push({ job: k, cursor: ep.cursor, paused_reason: `${CLEARED}${ep.paused_reason ?? "open: "}`.slice(0, 300), updated_at: at });
    else if (nowMs - (ep.updated_at ? Date.parse(ep.updated_at) : 0) >= recoveryMin(k.slice(ALERT_PREFIX.length)) * 60_000) close.push(k);
  }
  const due: (Alert & { since: string; start: number })[] = [];
  for (const a of active) {
    const k = alertKey(a.key);
    const ep = episodes.get(k);
    const start = ep ? Number(ep.cursor ?? nowS) : nowS;
    if (!ep) upsert.push({ job: k, cursor: start, paused_reason: `open: ${a.title}`.slice(0, 300), updated_at: at });
    // Back within the hold: the same episode resumes (a sent one stays sent).
    else if (episodeCleared(ep)) upsert.push({ job: k, cursor: start, paused_reason: `${episodeSent(ep) ? "sent" : "open"}: ${a.title}`.slice(0, 300), updated_at: at });
    const sent = ep ? episodeSent(ep) : false;
    if (!sent && nowS - start >= a.graceMin * 60) due.push({ ...a, since: new Date(start * 1000).toISOString(), start });
  }
  const throttled = lastDigest > 0 && nowS - lastDigest < DIGEST_EVERY_MIN * 60;
  if (!due.length || throttled) return { upsert, unsent: upsert, close, send: [], digestState: null };
  const unsent = [...upsert];
  for (const d of due) {
    const i = upsert.findIndex((u) => u.job === alertKey(d.key));
    const row = { job: alertKey(d.key), cursor: d.start, paused_reason: `sent: ${d.title}`.slice(0, 300), updated_at: at };
    if (i >= 0) upsert[i] = row;
    else upsert.push(row);
  }
  upsert.push({ job: DIGEST_KEY, cursor: nowS, paused_reason: null, updated_at: at });
  const digestState = due
    .map((d) => `${d.key}@${d.start}`)
    .sort()
    .join(",");
  return { upsert, unsent, close, send: due.map(({ start: _s, ...rest }) => rest), digestState };
}

/** Subject line for a digest. */
export const digestSubject = (n: number, first: string) => (n === 1 ? `FiledUnder ops: ${first}` : `FiledUnder ops: ${n} problems need a look`);

// ---------- the database itself unreachable (review R7) ----------
/**
 * The watchdog's reads failed. Whether that is the database API being down (worth a direct email
 * that bypasses the outbox, which lives in the same database) or the watchdog's own time limit
 * (a slow read; the next run tries again).
 */
export const dbReadFailure = (message: string) => !/took over \d+ ms/.test(message);

/** Idempotency key for the direct email: at most one per UTC day, deduplicated by the email provider across isolates. */
export const dbDownKey = (nowMs: number) => `ops-db-unreachable:${new Date(nowMs).toISOString().slice(0, 10)}`;
