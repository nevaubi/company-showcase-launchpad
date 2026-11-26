/**
 * Priority companies for the IR deep loop (owner, 26 Nov: banks first). Off unless set:
 *   IR_PRIORITY_GROUP=banks         every covered bank (coverage group or industry "Banks"), largest first
 *   IR_PRIORITY_TICKERS=GS,MS       explicit tickers, in the order given, ahead of any group
 * Each listed company is read once per campaign (the env values are the campaign key): the loop takes
 * it ahead of every other company while it has files waiting, even when it already has figures or was
 * finished before. It leaves the queue when its run reaches its final report, when nothing is waiting,
 * when it is set aside for review, or after IR_PRIORITY_MAX_RUNS runs (default 3) that did not finish;
 * a run stopped on credits keeps its place and does not count. Unset both variables to go back to the
 * normal order. Pure: the loop owns the state and the database reads.
 */
import { byRank } from "@/lib/jobs/priority";

export interface PriorityCompany {
  ticker: string;
  industry?: string;
  group?: string;
}

/** Groups IR_PRIORITY_GROUP accepts. Banks: deposit-taking banks of the coverage taxonomy (not brokers or card lenders filed elsewhere). */
export const PRIORITY_GROUPS: Record<string, (c: PriorityCompany) => boolean> = {
  banks: (c) => c.group === "Banks" || /^(diversified |regional )?banks$/i.test(c.industry ?? ""),
};

/** Runs that end without finishing before a company leaves the priority queue (default 3, at most 10). */
export const priorityMaxRuns = (env: Record<string, string | undefined>) => {
  const n = Math.floor(Number(env["IR_PRIORITY_MAX_RUNS"] ?? 3));
  return Number.isFinite(n) && n >= 1 ? Math.min(10, n) : 3;
};

const list = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/** Campaign key: the two settings as given, normalised. Empty when priority is off. */
export function priorityKey(env: Record<string, string | undefined>): string {
  const groups = list(env["IR_PRIORITY_GROUP"]).map((g) => g.toLowerCase()).filter((g) => PRIORITY_GROUPS[g]);
  const tickers = list(env["IR_PRIORITY_TICKERS"]).map((t) => t.toUpperCase());
  if (!groups.length && !tickers.length) return "";
  return `groups=${groups.join(",")};tickers=${tickers.join(",")}`;
}

/** Unknown group names (logged by the loop, otherwise ignored). */
export function unknownGroups(env: Record<string, string | undefined>): string[] {
  return list(env["IR_PRIORITY_GROUP"]).filter((g) => !PRIORITY_GROUPS[g.toLowerCase()]);
}

/**
 * The priority order: explicit tickers first (as given, covered or not), then each group's covered
 * companies, largest first (rank 1 = highest 20-day dollar volume), unranked ones after in coverage order.
 */
export function priorityList(env: Record<string, string | undefined>, coverage: readonly PriorityCompany[], rank: Map<string, number>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (t: string) => {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  };
  for (const t of list(env["IR_PRIORITY_TICKERS"])) add(t.toUpperCase());
  for (const g of list(env["IR_PRIORITY_GROUP"])) {
    const test = PRIORITY_GROUPS[g.toLowerCase()];
    if (!test) continue;
    for (const c of byRank(coverage.filter(test), (c) => c.ticker, rank)) add(c.ticker);
  }
  return out;
}

/** What the loop remembers about a campaign (saved with its state). */
export interface PriorityState {
  key: string;
  /** companies still to read, in order */
  queue: string[];
  /** finished in this campaign */
  done: string[];
  /** left because nothing was waiting; a configuration re-queue that resets their files brings them back */
  empty: string[];
  /** left after too many unfinished runs or a review hold */
  dropped: string[];
  /** unfinished runs per company in this campaign (credit stops not counted) */
  runs: Record<string, number>;
}

/** The campaign for the current settings: kept when the key is unchanged, otherwise started afresh. Null when priority is off. */
export function priorityCampaign(prev: PriorityState | null | undefined, key: string, order: readonly string[]): PriorityState | null {
  if (!key) return null;
  if (prev && prev.key === key) return prev;
  return { key, queue: [...order], done: [], empty: [], dropped: [], runs: {} };
}

/** Queue entries the loop may take now, in order (not running, not held for review). */
export function priorityCandidates(p: PriorityState, busy: ReadonlySet<string>, review: Record<string, string>): string[] {
  return p.queue.filter((t) => !busy.has(t) && !review[t]);
}

export type PriorityOutcome = "finished" | "credits" | "unfinished" | "empty" | "review";

/** Apply one outcome for a company (returns the same object, changed in place, for the loop's saved state). */
export function settlePriority(p: PriorityState, t: string, outcome: PriorityOutcome, maxRuns: number): PriorityState {
  if (!p.queue.includes(t)) return p;
  const leave = (into: string[]) => {
    p.queue = p.queue.filter((x) => x !== t);
    if (!into.includes(t)) into.push(t);
  };
  if (outcome === "finished") leave(p.done);
  else if (outcome === "empty") leave(p.empty);
  else if (outcome === "review") leave(p.dropped);
  else if (outcome === "unfinished") {
    p.runs[t] = (p.runs[t] ?? 0) + 1;
    if (p.runs[t] >= maxRuns) leave(p.dropped);
  }
  return p;
}

/**
 * Companies whose configuration-failed files were just reset: those that had left the queue because
 * nothing was waiting go back in, at their original place in `order`.
 */
export function restorePriority(p: PriorityState, tickers: Iterable<string>, order: readonly string[]): PriorityState {
  const back = new Set([...tickers].filter((t) => p.empty.includes(t)));
  if (!back.size) return p;
  p.empty = p.empty.filter((t) => !back.has(t));
  const want = new Set([...p.queue, ...back]);
  const ordered = order.filter((t) => want.has(t));
  p.queue = [...ordered, ...p.queue.filter((t) => !ordered.includes(t))];
  return p;
}
