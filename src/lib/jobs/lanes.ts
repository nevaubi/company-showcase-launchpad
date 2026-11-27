/**
 * The worker's lanes (pure): what each one is, where its owner hold lives and what the lane board
 * shows for it. One list, read by the worker programs (which lane am I, am I held), by the admin
 * board (running, waiting or held; what it did last; Stop and Resume) and by `scripts/lane-hold.ts`.
 *
 * A lane's `id` is the `job_runs.job` name it records its runs under, so "what it did last" is its
 * newest run row. Three kinds of `job_state` row belong to a lane:
 *   hold:<id>   the owner's hold (lane-hold.ts): paused_reason `owner: hold. …`, cursor = when the
 *               lane last saw it (epoch seconds, 0 until then). `vendor-backfill` keeps its hold on
 *               its own lease row, as it did before the board existed.
 *   lane:<id>   the lane's own marker: lease_until in the future while a run is in progress,
 *               updated_at = when that run started. Written only by the lane.
 *   (its own lease or cursor rows, unchanged)
 *
 * A lane is listed here only in the change that teaches its loop the hold check: a Stop button on a
 * lane that does not look is a promise not kept.
 */
import { holdText, isOwnerHold } from "./lane-hold";

export type LaneGroup = "IR figures" | "Filings and companies" | "Markets" | "Official data" | "Calls" | "Vendor archive";
export type LaneProgram = "IR loop" | "Official data worker" | "Call worker" | "Bank worker" | "Vendor collector";

export interface LaneDef {
  /** the job_runs.job name its runs are recorded under */
  id: string;
  label: string;
  /** one plain sentence: what it does */
  what: string;
  group: LaneGroup;
  program: LaneProgram;
  /** how often it runs, in words */
  every: string;
  /** minutes without a run after which the board calls it late; null when no rhythm is expected */
  lateAfterMin: number | null;
  /** what it spends besides machine time */
  spends?: "AI credit" | "page reader credit" | "vendor credit";
  /** where the hold lives when not `hold:<id>` */
  holdOn?: string;
}

const H = 60;
const D = 24 * H;

export const LANES: readonly LaneDef[] = [
  { id: "loop:company", label: "IR deep builds", what: "Reads a company's stored IR files into figures, one company after another.", group: "IR figures", program: "IR loop", every: "continuously while files wait", lateAfterMin: null, spends: "AI credit" },
  { id: "loop:fresh", label: "Newest IR files", what: "Reads the newest unread IR files of the most traded companies before older ones.", group: "IR figures", program: "IR loop", every: "before each company", lateAfterMin: null, spends: "AI credit" },
  { id: "loop:prose", label: "IR text reader", what: "Reads figures stated in the text of IR documents.", group: "IR figures", program: "IR loop", every: "every 10 minutes", lateAfterMin: 2 * H, spends: "AI credit" },
  { id: "loop:verify", label: "IR text cross-check", what: "Checks text-read figures a second time on the free daily allowance.", group: "IR figures", program: "IR loop", every: "every 30 minutes", lateAfterMin: 6 * H },
  { id: "loop:canon", label: "IR label merging", what: "Merges the labels a company uses for one figure across its documents.", group: "IR figures", program: "IR loop", every: "once a day", lateAfterMin: 3 * D, spends: "AI credit" },
  { id: "loop:ir-rebuild", label: "IR series rebuild", what: "Rebuilds a company's stored series after its figures changed.", group: "IR figures", program: "IR loop", every: "hourly when nothing waits", lateAfterMin: 6 * H },
  { id: "loop:ir-site", label: "IR site collection", what: "Looks for new documents on companies' investor-relations sites.", group: "IR figures", program: "IR loop", every: "every 2 hours", lateAfterMin: 8 * H, spends: "page reader credit" },
  { id: "loop:mirror", label: "Partner IR mirror", what: "Copies the partner's IR store into ours and registers the new files.", group: "IR figures", program: "IR loop", every: "every 3 hours", lateAfterMin: 12 * H },

  { id: "loop:filing-steps", label: "New filing steps", what: "For each new 10-K or 10-Q: the redline against the prior filing and the supply links.", group: "Filings and companies", program: "IR loop", every: "every 30 minutes", lateAfterMin: 3 * H, spends: "AI credit" },
  { id: "loop:detail", label: "Filing detail", what: "Reads segment, customer and region detail from new 10-K and 10-Q filings.", group: "Filings and companies", program: "IR loop", every: "every 12 hours", lateAfterMin: 2 * D },
  { id: "loop:sec-catchup", label: "SEC daily catch-up", what: "Checks SEC's daily index for filings the live feed missed.", group: "Filings and companies", program: "IR loop", every: "once a day after 03:00 UTC", lateAfterMin: 2 * D },
  { id: "loop:form4-repair", label: "Insider filings repair", what: "Reads Form 4 filings the company walk has not reached.", group: "Filings and companies", program: "IR loop", every: "every 30 minutes", lateAfterMin: 3 * H },
  { id: "loop:coverage", label: "Coverage ledger", what: "Counts what is stored for every company and kind of data, and records what is complete, partial or missing.", group: "Filings and companies", program: "IR loop", every: "once a day after 07:00 UTC", lateAfterMin: 2 * D },
  { id: "loop:registrant-drift", label: "Registrant check", what: "Compares each company's SEC registrant number with SEC's ticker file.", group: "Filings and companies", program: "IR loop", every: "once a week", lateAfterMin: 21 * D },
  { id: "loop:reports", label: "Due reports", what: "Writes the standard reports that are due.", group: "Filings and companies", program: "IR loop", every: "every 10 minutes", lateAfterMin: 2 * H, spends: "AI credit" },

  { id: "loop:options-night", label: "Options collection", what: "Stores each stock's option chain summary for the session, after the close.", group: "Markets", program: "IR loop", every: "weekday evenings, 16:20 to 23:30 New York", lateAfterMin: null },
  { id: "loop:reactions", label: "Earnings reactions", what: "Measures how each stock moved after its past reports.", group: "Markets", program: "IR loop", every: "once a day", lateAfterMin: 3 * D },
  { id: "loop:analytics", label: "Analytics files", what: "Publishes the market, auction, hedge fund, head-office and context files.", group: "Markets", program: "IR loop", every: "daily to weekly, by file", lateAfterMin: 3 * D },
  { id: "loop:alt-slow", label: "Slow alt data", what: "Ownership filings, recalls and the other alt-data passes that take hours.", group: "Markets", program: "IR loop", every: "once a day", lateAfterMin: 3 * D },
  { id: "setup-replay-worker", label: "Setup replay", what: "Replays the setup rules over each company's price history.", group: "Markets", program: "Official data worker", every: "continuously; every 15 minutes when nothing waits", lateAfterMin: 2 * H },

  { id: "official-sources-runner", label: "Official data loading", what: "Loads staged official datasets into published snapshots.", group: "Official data", program: "Official data worker", every: "when a dataset is staged", lateAfterMin: null },
  { id: "official-source-refresh", label: "Official data refresh", what: "Checks each official source for a new release and stores it beside the earlier one.", group: "Official data", program: "Official data worker", every: "every 5 minutes", lateAfterMin: 1 * H },
  { id: "loop:sod", label: "Weekly government files", what: "Bank deposits by state, Medicare by state and the toxics inventory.", group: "Official data", program: "IR loop", every: "once a week", lateAfterMin: 21 * D },
  { id: "abs-bulk-runner", label: "Securitized credit", what: "Reads asset-level files from ABS-EE filings of the watched issuers.", group: "Official data", program: "Official data worker", every: "each issuer every 6 hours", lateAfterMin: 8 * H },
  { id: "bank-sector", label: "Bank sector file", what: "Rebuilds the bank sector dataset when its sources changed.", group: "Official data", program: "Bank worker", every: "every 3 hours", lateAfterMin: 12 * H },

  { id: "call-source-worker", label: "Call transcript import", what: "Imports published call transcripts into the call archive.", group: "Calls", program: "Call worker", every: "every 30 seconds", lateAfterMin: 30 },
  { id: "call-discovery-worker", label: "Call transcript search", what: "Looks for the calls a company is missing on its own site.", group: "Calls", program: "Call worker", every: "every 5 minutes", lateAfterMin: 1 * H, spends: "page reader credit" },
  { id: "call-commitments-worker", label: "Call commitments", what: "Reads what management committed to on a call, with the quote.", group: "Calls", program: "Call worker", every: "every 5 minutes", lateAfterMin: 1 * H, spends: "AI credit" },

  { id: "vendor-backfill", label: "Vendor collector", what: "Collects the vendor archive: statements, estimates, transcripts and filings lists.", group: "Vendor archive", program: "Vendor collector", every: "continuously until its list is through", lateAfterMin: null, spends: "vendor credit", holdOn: "vendor-backfill" },
];

export const LANE_GROUPS: readonly LaneGroup[] = ["IR figures", "Filings and companies", "Markets", "Official data", "Calls", "Vendor archive"];
export const LANE_IDS: readonly string[] = LANES.map((l) => l.id);
export const laneById = (id: string): LaneDef | undefined => LANES.find((l) => l.id === id);

export const HOLD_ROW_PREFIX = "hold:";
export const MARK_ROW_PREFIX = "lane:";
/** The job_state key of a lane's owner hold. */
export const holdKey = (lane: string): string => laneById(lane)?.holdOn ?? `${HOLD_ROW_PREFIX}${lane}`;
/** The job_state key of a lane's running marker. */
export const markKey = (lane: string): string => `${MARK_ROW_PREFIX}${lane}`;
/** The lane a hold row belongs to, or null when the row is not a hold row. */
export function laneOfHoldKey(job: string): string | null {
  if (job.startsWith(HOLD_ROW_PREFIX)) return job.slice(HOLD_ROW_PREFIX.length);
  return LANES.find((l) => l.holdOn === job)?.id ?? null;
}
/** IR loop step name → lane id (`mirror` → `loop:mirror`). */
export const loopLane = (step: string): string => `loop:${step}`;

/** A lane sees its hold within this long (its look interval while held, plus one pass). */
export const HOLD_SEEN_WITHIN_MIN = 10;
/** A lane with no recorded run at all is called late only when its rhythm is at most this long. */
export const NO_RECORD_LATE_MIN = 24 * 60;
/** A running marker is written with at most this lifetime and renewed while the run lasts. */
export const MARK_TTL_MS = 3 * 60_000;

export interface LaneStateRow {
  job: string;
  cursor: number | null;
  paused_reason: string | null;
  lease_until: string | null;
  updated_at: string | null;
}
export interface LaneRunRow {
  job: string;
  started_at: string;
  finished_at: string | null;
  ok: boolean | null;
  items: number | null;
  detail: Record<string, unknown> | null;
  /** runs and failed runs in the last 24 hours */
  runs_24h: number;
  failed_24h: number;
}

export type LaneState = "held" | "running" | "waiting";
export interface LaneView extends LaneDef {
  state: LaneState;
  /** held: the owner's reason and when the hold was placed */
  hold: { why: string; since: string | null; seenAt: string | null; /** the lane has not confirmed the hold in time */ unseen: boolean; /** the lane recorded a run after the hold was placed */ ranSince: boolean } | null;
  /** running: when the run in progress started */
  runningSince: string | null;
  last: { at: string; ok: boolean | null; items: number; ms: number | null; note: string | null } | null;
  runs24h: number;
  failed24h: number;
  /** no run for longer than the lane's rhythm allows (never for a held lane) */
  late: boolean;
}

const SINCE = /\(since (\d{4}-\d{2}-\d{2})\)\s*$/;

/** One short line from a run's detail: what a person would want to know about it. */
export function runNote(detail: Record<string, unknown> | null | undefined): string | null {
  if (!detail) return null;
  const d = detail;
  const s = (k: string) => (typeof d[k] === "string" && d[k] ? String(d[k]) : null);
  const text = s("error") ?? s("blocked") ?? s("note") ?? s("stopped") ?? s("reason");
  if (text) return text.slice(0, 160);
  if (d["timedOut"] === true) return "stopped at its time limit";
  if (typeof d["code"] === "number" && d["code"] !== 0) return `ended with code ${d["code"]}`;
  if (d["idle"] === true) return "nothing to do";
  return null;
}

/** The board: every lane with its state, in the list's order. */
export function laneBoard(states: readonly LaneStateRow[], runs: readonly LaneRunRow[], nowMs: number): LaneView[] {
  const st = new Map(states.map((r) => [r.job, r]));
  const run = new Map(runs.map((r) => [r.job, r]));
  return LANES.map((def): LaneView => {
    const holdRow = st.get(holdKey(def.id));
    const mark = st.get(markKey(def.id));
    const r = run.get(def.id);
    const lastAt = r ? (r.finished_at ?? r.started_at) : null;
    const last = r && lastAt ? { at: lastAt, ok: r.ok, items: r.items ?? 0, ms: r.finished_at ? Date.parse(r.finished_at) - Date.parse(r.started_at) : null, note: runNote(r.detail) } : null;
    const held = isOwnerHold(holdRow?.paused_reason);
    let hold: LaneView["hold"] = null;
    if (held && holdRow) {
      const placed = holdRow.updated_at ? Date.parse(holdRow.updated_at) : NaN;
      // a hold on the lane's own lease row carries no "seen" time: the lease itself keeps the lane out
      const own = !!def.holdOn;
      const seen = !own && (holdRow.cursor ?? 0) > 0 ? (holdRow.cursor as number) * 1000 : null;
      const day = SINCE.exec(holdRow.paused_reason ?? "")?.[1] ?? null;
      const startedAfter = r && Number.isFinite(placed) ? Date.parse(r.started_at) > placed + 60_000 : false;
      hold = {
        why: holdText(holdRow.paused_reason!).replace(SINCE, "").trim(),
        since: day,
        seenAt: seen ? new Date(seen).toISOString() : null,
        unseen: !own && !seen && Number.isFinite(placed) && nowMs - placed > HOLD_SEEN_WITHIN_MIN * 60_000,
        ranSince: startedAfter,
      };
    }
    const running = !held && !!mark?.lease_until && Date.parse(mark.lease_until) > nowMs;
    // When it last ran: its newest run row, else when its marker last started (run rows are kept 14 days).
    const seenRunning = lastAt ?? mark?.updated_at ?? null;
    // Without any record a lane is late only if it should run at least daily: a weekly lane's last
    // run may simply be older than the records.
    const late = !held && !running && def.lateAfterMin != null && (seenRunning ? nowMs - Date.parse(seenRunning) > def.lateAfterMin * 60_000 : def.lateAfterMin <= NO_RECORD_LATE_MIN);
    return { ...def, state: held ? "held" : running ? "running" : "waiting", hold, runningSince: running ? (mark?.updated_at ?? null) : null, last, runs24h: r?.runs_24h ?? 0, failed24h: r?.failed_24h ?? 0, late };
  });
}
