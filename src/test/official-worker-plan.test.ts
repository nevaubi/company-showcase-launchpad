import { describe, expect, it } from "vitest";
import {
  ABS_IDLE_RECHECK_MS,
  ABS_MOVE_PAUSE_MS,
  ABS_STAY_MAX_RUNS,
  ABS_STAY_PAUSE_MS,
  absAfterRun,
  absLeftFromReceipt,
  absNextTurn,
  advanceCursor,
  canStartOfficialChild,
  childReceipt,
  type AbsSeen,
  type AbsStay,
  enabled,
  retryDelay,
  safeError,
} from "../../scripts/lib/official-worker-plan";
import { refreshReceipt } from "../../scripts/lib/source-refresh-run";

describe("official source worker scheduling", () => {
  it("does not lose a unit when a process fails or is killed", () => {
    expect(advanceCursor(12, 39, 1)).toBe(12);
    expect(advanceCursor(12, 39, null)).toBe(12);
    expect(advanceCursor(12, 39, 124)).toBe(12);
    expect(advanceCursor(12, 39, 75)).toBe(12);
    expect(advanceCursor(38, 39, 0)).toBe(0);
  });
  it("defers new source children when IR readers consume container headroom", () => {
    const gb = 1024 ** 3;
    expect(canStartOfficialChild(8 * gb, 4 * gb, 2)).toBe(true);
    expect(canStartOfficialChild(8 * gb, 6 * gb, 0)).toBe(false);
    expect(canStartOfficialChild(gb, 0.6 * gb, 1)).toBe(false);
    expect(canStartOfficialChild(null, null, 0)).toBe(true);
    expect(canStartOfficialChild(null, null, 1)).toBe(false);
  });
  it("backs off failures without an unbounded delay", () => {
    expect(retryDelay(1)).toBe(30_000);
    expect(retryDelay(3)).toBe(120_000);
    expect(retryDelay(100)).toBe(3_600_000);
  });
  it("allows an operator to disable either supervised lane", () => {
    expect(enabled(undefined)).toBe(true);
    expect(enabled("false")).toBe(false);
    expect(enabled("0")).toBe(false);
  });
  it("stores what the child says it did beside how the process ended", () => {
    const told = {
      script: "source-refresh", items: 6, checked: ["a", "b"], unchanged: ["a"], staged: [{ id: "b", snapshot_id: "c".repeat(64), rows: 12 }],
      failed: [{ id: "fred_x", family: "fred", fault: "provider", error: "FRED download deadline exceeded" }],
      first_error: "fred_x: FRED download deadline exceeded",
    };
    const row = childReceipt({ child: "scripts/source-refresh.ts", exitCode: 0, killed: false, seconds: 54, told });
    expect(row.ok).toBe(true);
    expect(row.items).toBe(6);
    expect(row.detail).toMatchObject({ child: "scripts/source-refresh.ts", exit_code: 0, checked: ["a", "b"], failed: told.failed });
    // a dataset's failure is in the list; `error` is kept for a run that failed
    expect("error" in row.detail).toBe(false);
    expect("note" in row.detail).toBe(false);
    expect("items" in row.detail).toBe(false);
  });
  it("writes a refresh run that checked no dataset as failed, from the child's own account, though it exited 0", () => {
    const told = refreshReceipt({
      mode: "all", startedMs: 0, finishedMs: 41_000, due: 2, notStarted: [], switchedOff: [], circuits: {}, stop: null,
      outcomes: [
        { id: "fred_x", family: "fred", outcome: "failed", fault: "provider", error: "FRED download deadline exceeded" },
        { id: "fred_y", family: "fred", outcome: "failed", fault: "provider", error: "FRED download deadline exceeded" },
      ],
    });
    const row = childReceipt({ child: "scripts/source-refresh.ts", exitCode: 0, killed: false, seconds: 41, told });
    expect(row.ok).toBe(false);
    expect(row.items).toBe(0);
    expect(row.detail).toMatchObject({ exit_code: 0, first_error: "fred_x: FRED download deadline exceeded", error: "child exited with code 0 and reported a failed run: all 2 datasets attempted failed; none was checked" });
    expect("ok" in row.detail).toBe(false);
    // any other account of a run that exited 0 stays a run that worked
    expect(childReceipt({ child: "scripts/source-refresh.ts", exitCode: 0, killed: false, seconds: 41, told: { items: 0, checked: [], failed: [] } }).ok).toBe(true);
  });
  it("always gives a failed run an error to read, with or without a receipt", () => {
    // the watchdog tells the owner to read detail.error; before, these rows held only an exit code
    const silent = childReceipt({ child: "scripts/source-refresh.ts", exitCode: 124, killed: true, seconds: 570.4, told: null });
    expect(silent).toEqual({ ok: false, items: 0, detail: {
      child: "scripts/source-refresh.ts", exit_code: 124,
      note: "The child left no receipt: only how the process ended is known.",
      error: "stopped by the worker after 570 s (time limit or lost lease)" } });
    const failed = childReceipt({ child: "scripts/abs-ee.ts", exitCode: 1, killed: false, seconds: 12,
      told: { items: 0, error: "SEC is throttling or down (status 504): stopped before filing 0001104659-26-083795" } });
    expect(failed.detail.error).toBe("child exited with code 1: SEC is throttling or down (status 504): stopped before filing 0001104659-26-083795");
    const first = childReceipt({ child: "x", exitCode: 1, killed: false, seconds: 1, told: { first_error: "a: boom" } });
    expect(first.detail.error).toBe("child exited with code 1: a: boom");
    expect(childReceipt({ child: "x", exitCode: null, killed: false, seconds: 1, told: null }).detail.error).toBe("child exited with code none");
  });
  it("does not let a receipt overwrite the process facts or carry a bad item count", () => {
    const row = childReceipt({ child: "scripts/abs-ee.ts", exitCode: 0, killed: false, seconds: 3,
      told: { child: "something else", exit_code: 99, items: -4 } });
    expect(row).toEqual({ ok: true, items: 0, detail: { child: "scripts/abs-ee.ts", exit_code: 0 } });
    expect(childReceipt({ child: "x", exitCode: 0, killed: false, seconds: 1, told: { items: 2.5 } }).items).toBe(0);
  });
  it("keeps signed URLs and credentials out of persisted errors", () => {
    expect(
      safeError(new Error("failed https://example.com/file?token=private sb_secret_abc")),
    ).toBe("failed [remote request] [credential]");
  });
});

describe("ABS lane rotation (review rev-workers S7)", () => {
  const NOW = Date.parse("2026-11-25T19:00:00Z");
  it("stays on a CIK while its run leaves filings to do, without listing it again", () => {
    const after = absAfterRun({ count: 91, index: 7, exitCode: 0, left: 31, stay: null, now: NOW });
    expect(after).toEqual({ seen: { at: NOW, left: 31 }, stay: { index: 7, runs: 1 }, cursor: 7, pauseMs: ABS_STAY_PAUSE_MS });
    expect(absNextTurn({ count: 91, cursor: 7, seen: new Map([[7, after.seen!]]), stay: after.stay, now: NOW + 5_000 })).toEqual({ index: 7, command: "load" });
  });

  it("moves on when nothing is left, a minute later, and lists the next CIK", () => {
    const after = absAfterRun({ count: 91, index: 90, exitCode: 0, left: 0, stay: { index: 90, runs: 3 }, now: NOW });
    expect(after).toEqual({ seen: { at: NOW, left: 0 }, stay: null, cursor: 0, pauseMs: ABS_MOVE_PAUSE_MS });
    expect(absNextTurn({ count: 91, cursor: 0, seen: new Map(), stay: null, now: NOW })).toEqual({ index: 0, command: "run" });
  });

  it("looks at an idle CIK at most once an hour, and waits when every CIK is idle", () => {
    const seen = new Map<number, AbsSeen>([[0, { at: NOW - 10 * 60_000, left: 0 }], [1, { at: NOW - 70 * 60_000, left: 0 }], [2, { at: NOW - 5 * 60_000, left: 0 }]]);
    expect(absNextTurn({ count: 3, cursor: 0, seen, stay: null, now: NOW })).toEqual({ index: 1, command: "run" });
    seen.set(1, { at: NOW, left: 0 });
    expect(absNextTurn({ count: 3, cursor: 2, seen, stay: null, now: NOW })).toEqual({ waitMs: 50 * 60_000 });
    // a CIK with work left is never skipped
    seen.set(2, { at: NOW, left: 4 });
    expect(absNextTurn({ count: 3, cursor: 0, seen, stay: null, now: NOW })).toEqual({ index: 2, command: "run" });
    expect(ABS_IDLE_RECHECK_MS).toBe(3_600_000);
  });

  it("gives the other CIKs a turn after a long stay, and comes back on the next pass", () => {
    const stay: AbsStay = { index: 4, runs: ABS_STAY_MAX_RUNS - 1 };
    const after = absAfterRun({ count: 91, index: 4, exitCode: 0, left: 12, stay, now: NOW });
    expect(after).toMatchObject({ stay: null, cursor: 5, seen: { left: 12 } });
  });

  it("a failed run keeps the cursor and forgets the CIK, so it is retried after the backoff", () => {
    // a discover cut by an SEC outage reports no filings left; the CIK must not look idle for an hour
    expect(absAfterRun({ count: 91, index: 12, exitCode: 1, left: null, stay: { index: 12, runs: 2 }, now: NOW }))
      .toEqual({ seen: null, stay: null, cursor: 12, pauseMs: null });
  });

  it("reads what is left for the CIK from the child's receipt, and nothing else", () => {
    const told = { script: "abs-ee", ciks: [{ cik: 1974820, found: 412, stored: 3, left: 31 }, { cik: 2, left: -1 }] };
    expect(absLeftFromReceipt(told, 1974820)).toBe(31);
    expect(absLeftFromReceipt(told, 2)).toBeNull();
    expect(absLeftFromReceipt({ ciks: [{ cik: 1974820 }] }, 1974820)).toBeNull();
    expect(absLeftFromReceipt(null, 1974820)).toBeNull();
  });

  it("works through production's backlog in about a tenth of the old rotation's turns", () => {
    // 25 Nov: 305 filings in range in 9 of 91 CIKs; 3 filings a run. The old rotation took one CIK a
    // turn and needed 30 passes of 91 turns (2,730) for the longest queue.
    const work = new Map([[3, 90], [10, 74], [20, 54], [30, 34], [40, 19], [50, 19], [60, 6], [70, 5], [80, 4]]);
    const seen = new Map<number, AbsSeen>();
    let stay: AbsStay | null = null, cursor = 0, now = NOW, turns = 0;
    while ([...work.values()].some((n) => n > 0) && turns < 1000) {
      const turn = absNextTurn({ count: 91, cursor, seen, stay, now });
      if ("waitMs" in turn) { now += turn.waitMs; continue; }
      turns++;
      const left = Math.max(0, (work.get(turn.index) ?? 0) - 3);
      if (work.has(turn.index)) work.set(turn.index, left);
      const after = absAfterRun({ count: 91, index: turn.index, exitCode: 0, left, stay, now });
      if (after.seen) seen.set(turn.index, after.seen);
      stay = after.stay;
      cursor = after.cursor;
      now += (after.pauseMs ?? ABS_MOVE_PAUSE_MS) + 60_000;
    }
    // 9 CIKs need 30+25+18+12+7+7+2+2+2 = 105 runs; the 72 idle CIKs before the last queue (index 80)
    // are looked at once on the way
    expect(turns).toBe(105 + 72);
  });
});

