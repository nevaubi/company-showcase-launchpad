/**
 * The options collection (pure): one snapshot per stock and trading day from Yahoo Finance.
 *
 * Owner, 27 Nov 2026: Cboe had refused the collector since 19 Nov; options come from Yahoo Finance,
 * with the page reader (Firecrawl) as the second route. Nothing here fetches.
 *
 *   when       every weekday in New York, from 16:20 (the session's last quotes are on Yahoo by
 *              then) to 23:30. Yahoo's option quotes are two-sided only until its pre-market reset,
 *              so nothing is read after midnight or before the close.
 *   what       a chain is stored only when its stock quote is from today's session and Yahoo's
 *              market state says the session is over (`usableState`). On a market holiday the probe
 *              (SPY) still shows the earlier session: the day is recorded as closed and nothing is read.
 *   who        the worker (`scripts/options-snapshot.ts --night`). The app's scheduled `options` job
 *              takes over only while the worker is silent (`appTakesOver`), a few stocks a call.
 *   where      `options-collect` (the worker; `options-app` for the app job): cursor = next position in the session's ranked list;
 *              paused_reason = `session:<yyyymmdd>` while running, `… done …` when the list is
 *              through, `… closed …` on a holiday, `… blocked until <iso> … [n=<k>]` when Yahoo
 *              refuses both routes. `options-reader`: page-reader requests used this session.
 *   routes     direct first. When Yahoo refuses the collector's address the same request goes
 *              through the page reader, at most `READER_MAX_PER_SESSION` stocks a session (one
 *              credit each); the direct route is tried again every `DIRECT_RETRY_MS`.
 *   stop       list through; both routes refused (back-off 5 min doubling to 60 min); or the pass's
 *              time limit (the cursor is saved after every chunk, the next pass resumes).
 *   skip       names already stored for the session, by either side.
 */
import { snapshotRow, summarizeChain } from "@/lib/options/core";
import { newYork, yahooChain, type YahooOptionsResult } from "@/lib/options/yahoo";
import type { StateRow } from "./watchdog";

export const COLLECT_KEY = "options-collect";
export const READER_KEY = "options-reader";
/** The app job's own place in its ranked list (its rank covers the top 1,000 only, so it cannot share the worker's cursor). */
export const APP_KEY = "options-app";
/** The symbol whose chain always exists: it tells a holiday from a block. */
export const COLLECT_PROBE = "SPY";

/** New York minutes past midnight between which the collection runs. */
export const WINDOW_START_MIN = 16 * 60 + 20;
export const WINDOW_END_MIN = 23 * 60 + 30;
/** Names per saved step. */
export const COLLECT_CHUNK = 20;
/** Pause between direct requests: about 50 a minute, one address. */
export const DIRECT_GAP_MS = 1200;
/** Page-reader requests allowed per session (one credit each): the most traded names when Yahoo refuses the collector. */
export const READER_MAX_PER_SESSION = 600;
/** After a refusal the direct route is tried again this often. */
export const DIRECT_RETRY_MS = 10 * 60_000;
/** The app job reads this many stocks a call, and only after the worker has been silent this long. */
export const APP_STEP = 2;
export const APP_TAKEOVER_MIN = 25;

/** Yahoo market states in which the option quotes are the finished session's last. */
export const usableState = (state: string | null | undefined): boolean => state === "POST" || state === "POSTPOST" || state === "CLOSED";

/** Today's session number in New York (yyyymmdd) and where the clock stands. */
export function sessionOf(nowMs: number): { session: number; date: string; minutes: number; weekday: boolean } {
  const ny = newYork(nowMs);
  const day = new Date(`${ny.date}T12:00:00Z`).getUTCDay();
  return { session: Number(ny.date.replace(/-/g, "")), date: ny.date, minutes: ny.minutes, weekday: day >= 1 && day <= 5 };
}

export const inCollectWindow = (nowMs: number): boolean => {
  const s = sessionOf(nowMs);
  return s.weekday && s.minutes >= WINDOW_START_MIN && s.minutes < WINDOW_END_MIN;
};

export type CollectStatus = "running" | "done" | "closed" | "blocked";
export interface CollectState {
  session: number;
  cursor: number;
  status: CollectStatus;
  /** epoch ms a block ends */
  until: number | null;
  streak: number;
}

const REASON = /^session:(\d{8})(?: (done|closed|blocked until (\S+)))?/;

export function parseCollect(row: StateRow | null | undefined): CollectState | null {
  const m = REASON.exec(row?.paused_reason ?? "");
  if (!m) return null;
  const word = m[2] ?? "";
  const blocked = word.startsWith("blocked");
  const n = /\[n=(\d+)\]\s*$/.exec(row?.paused_reason ?? "");
  return {
    session: Number(m[1]),
    cursor: Math.max(0, Number(row?.cursor ?? 0)),
    status: word === "done" ? "done" : word === "closed" ? "closed" : blocked ? "blocked" : "running",
    until: blocked ? Date.parse(m[3] ?? "") : null,
    streak: blocked && n ? Number(n[1]) : 0,
  };
}

export type CollectPlan = { run: true; session: number; date: string; start: number; why: string } | { run: false; session: number; date: string; why: string };

/** Whether a pass may start now and where it starts. */
export function collectPlan(i: { nowMs: number; row: StateRow | null | undefined; total: number; /** a pass asked for by hand: the clock window is not applied (an early close ends at 13:00) */ anyTime?: boolean }): CollectPlan {
  const s = sessionOf(i.nowMs);
  const base = { session: s.session, date: s.date };
  if (!s.weekday) return { ...base, run: false, why: "no session at the weekend" };
  if (!i.anyTime && s.minutes < WINDOW_START_MIN) return { ...base, run: false, why: "before the session's last quotes are published (16:20 New York)" };
  if (!i.anyTime && s.minutes >= WINDOW_END_MIN) return { ...base, run: false, why: "after the collection window (23:30 New York)" };
  const st = parseCollect(i.row);
  const mine = st && st.session === s.session ? st : null;
  if (mine?.status === "done") return { ...base, run: false, why: "today's list is through" };
  if (mine?.status === "closed") return { ...base, run: false, why: "no session today" };
  if (mine?.status === "blocked" && mine.until != null && mine.until > i.nowMs) return { ...base, run: false, why: `both routes refused; next try at ${new Date(mine.until).toISOString()}` };
  const start = mine ? Math.min(mine.cursor, i.total) : 0;
  if (i.total > 0 && start >= i.total) return { ...base, run: false, why: "today's list is through" };
  return { ...base, run: true, start, why: mine ? (mine.status === "blocked" ? "trying again after a refusal" : `resuming at ${start}`) : "starting today's list" };
}

/**
 * The app job collects only while the worker is silent: no row for today's session `APP_TAKEOVER_MIN`
 * into the window, or a running or blocked row nobody has touched for that long.
 */
export function appTakesOver(i: { nowMs: number; row: StateRow | null | undefined }): boolean {
  const s = sessionOf(i.nowMs);
  if (!s.weekday || s.minutes < WINDOW_START_MIN + APP_TAKEOVER_MIN || s.minutes >= WINDOW_END_MIN) return false;
  const st = parseCollect(i.row);
  if (!st || st.session !== s.session) return true;
  if (st.status === "done" || st.status === "closed") return false;
  const touched = i.row?.updated_at ? Date.parse(i.row.updated_at) : 0;
  return i.nowMs - touched >= APP_TAKEOVER_MIN * 60_000;
}

/** What one stock's chain came to. */
export type ChainOutcome =
  | { t: string; kind: "stored"; row: Record<string, unknown>; route: Route }
  /** no listed options */
  | { t: string; kind: "none" }
  /** listed, but no call and put quoted on both sides near the money */
  | { t: string; kind: "unquoted" }
  /** the stock did not trade today, or Yahoo still shows an earlier session */
  | { t: string; kind: "stale"; quoted: string }
  /** both routes refused */
  | { t: string; kind: "blocked"; status: number }
  | { t: string; kind: "error"; message: string };
export type Route = "direct" | "reader";

export interface Tally {
  stored: number;
  none: number;
  unquoted: number;
  stale: number;
  errors: number;
  reader: number;
}
export const emptyTally = (): Tally => ({ stored: 0, none: 0, unquoted: 0, stale: 0, errors: 0, reader: 0 });
export function tally(into: Tally, results: readonly ChainOutcome[]): Tally {
  for (const r of results) {
    if (r.kind === "stored") {
      into.stored++;
      if (r.route === "reader") into.reader++;
    } else if (r.kind === "none") into.none++;
    else if (r.kind === "unquoted") into.unquoted++;
    else if (r.kind === "stale") into.stale++;
    else if (r.kind === "error") into.errors++;
  }
  return into;
}

/** job_state key of a "no listed options" receipt: `options-none:<TICKER>`, cursor = when it was seen (epoch seconds). */
export const OPTIONS_NONE_PREFIX = "options-none:";
/**
 * Receipts for the names the source lists no options for. The coverage ledger reads them
 * (src/lib/coverage/corpora.ts): "has no listed options" is not "not collected yet". A name that
 * gets options later simply has stored days, which outrank an older receipt.
 */
export function noneReceipts(results: readonly ChainOutcome[], nowMs: number): StateRow[] {
  return results.filter((r) => r.kind === "none").map((r) => ({ job: `${OPTIONS_NONE_PREFIX}${r.t}`, cursor: Math.floor(nowMs / 1000), paused_reason: null, updated_at: new Date(nowMs).toISOString() }));
}

/** A chunk fails as a whole only when every name in it errored: then the place is kept and it is tried again. */
export const chunkFailed = (results: readonly ChainOutcome[]): boolean => results.length > 0 && results.every((r) => r.kind === "error");

const at = (nowMs: number) => new Date(nowMs).toISOString();

/** Row after a stored chunk: the next position, or done when the list is through. */
export function collectProgress(session: number, next: number, total: number, nowMs: number): StateRow {
  return { job: COLLECT_KEY, cursor: Math.min(next, total), paused_reason: next >= total ? `session:${session} done` : `session:${session}`, updated_at: at(nowMs) };
}

/** Row for a day without a session (a market holiday): Yahoo's newest quote is from an earlier day. */
export function collectClosed(session: number, lastQuoted: string, nowMs: number): StateRow {
  return { job: COLLECT_KEY, cursor: 0, paused_reason: `session:${session} closed: Yahoo's newest quote is from ${lastQuoted}`, updated_at: at(nowMs) };
}

export const BLOCK_MIN_MS = 5 * 60_000;
export const BLOCK_MAX_MS = 60 * 60_000;

/** Row when both routes refused: hold the position, back off 5 min doubling to 60 min. */
export function collectBlocked(session: number, position: number, prev: CollectState | null, nowMs: number, why: string): StateRow {
  const n = (prev && prev.session === session && prev.status === "blocked" ? prev.streak : 0) + 1;
  const waitMs = Math.min(BLOCK_MAX_MS, BLOCK_MIN_MS * 2 ** (n - 1));
  return { job: COLLECT_KEY, cursor: position, paused_reason: `session:${session} blocked until ${at(nowMs + waitMs)} ${why.replace(/\s+/g, " ").trim()} [n=${n}]`, updated_at: at(nowMs) };
}

/** Page-reader requests already used this session, from the `options-reader` row. */
export function readerUsed(row: StateRow | null | undefined, session: number): number {
  return row?.paused_reason === `session:${session}` ? Math.max(0, Number(row.cursor ?? 0)) : 0;
}
export const readerRow = (session: number, used: number, nowMs: number): StateRow => ({ job: READER_KEY, cursor: used, paused_reason: `session:${session}`, updated_at: at(nowMs) });
export const readerLeft = (used: number): number => Math.max(0, READER_MAX_PER_SESSION - used);

/** The names of a chunk still to fetch: not stored for the session by either side. */
export const toFetch = (chunk: readonly string[], stored: ReadonlySet<string>) => chunk.filter((t) => !stored.has(t));

/**
 * The collection is behind: inside the window, the row is running and nobody moved it for
 * `limitMin`. Done, closed and blocked rows are not stalls (a block raises its own alert).
 */
export function collectStalled(row: StateRow | null | undefined, nowMs: number, limitMin = 45): { movedAt: string | null; cursor: number } | null {
  const s = sessionOf(nowMs);
  if (!s.weekday || s.minutes < WINDOW_START_MIN + limitMin || s.minutes >= WINDOW_END_MIN) return null;
  const st = parseCollect(row);
  if (st && st.session === s.session && st.status !== "running") return null;
  const moved = row?.updated_at && st?.session === s.session ? Date.parse(row.updated_at) : 0;
  if (moved && nowMs - moved <= limitMin * 60_000) return null;
  return { movedAt: moved ? (row?.updated_at ?? null) : null, cursor: st?.session === s.session ? st.cursor : 0 };
}

/** A block still in force, for the watchdog: the reason without its bookkeeping. */
export function collectBlock(row: StateRow | null | undefined, nowMs: number): string | null {
  const st = parseCollect(row);
  if (!st || st.status !== "blocked" || st.until == null || st.until <= nowMs) return null;
  return (row?.paused_reason ?? "").replace(/^session:\d{8} blocked until \S+\s*/, "").replace(/\s*\[n=\d+\]\s*$/, "");
}

// ---------- one chain ----------

/**
 * What a fetched chain comes to for today's session (`sessionDate`, yyyy-mm-dd in New York): a row
 * to store, or why there is none. `rate` is the annual risk-free rate as a fraction.
 */
export function judgeChain(t: string, result: YahooOptionsResult | null, sessionDate: string, rate: { value: number; date: string | null }, route: Route): ChainOutcome {
  const y = yahooChain(result, rate.value, rate.date);
  if (!y) return { t, kind: "none" };
  const quoted = (y.chain.last_trade_time ?? "").slice(0, 10);
  if (quoted !== sessionDate || !usableState(y.meta.state)) return { t, kind: "stale", quoted: `${quoted} ${y.meta.state}`.trim() };
  const snap = summarizeChain(t, y.chain);
  if (!snap) return { t, kind: "unquoted" };
  return { t, kind: "stored", route, row: snapshotRow(snap, { source: "yahoo", meta: { ...y.meta, route } }) };
}

/** What the probe says about today: a session whose quotes are final, one still open, or none (holiday). */
export function probeVerdict(result: YahooOptionsResult | null, sessionDate: string): { kind: "ready" } | { kind: "open" } | { kind: "closed"; last: string } | { kind: "unknown" } {
  const at = result?.quote?.regularMarketTime;
  if (!at) return { kind: "unknown" };
  const last = newYork(at * 1000).date;
  if (last < sessionDate) return { kind: "closed", last };
  return usableState(result?.quote?.marketState) ? { kind: "ready" } : { kind: "open" };
}
