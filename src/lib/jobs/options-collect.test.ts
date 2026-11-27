import { describe, expect, it } from "vitest";
import {
  APP_TAKEOVER_MIN, appTakesOver, chunkFailed, COLLECT_KEY, collectBlock, collectBlocked, collectClosed, collectPlan, collectProgress, collectStalled, noneReceipts,
  emptyTally, inCollectWindow, judgeChain, parseCollect, probeVerdict, READER_MAX_PER_SESSION, readerLeft, readerRow, readerUsed, sessionOf, tally, toFetch, usableState,
} from "./options-collect";
import { black76 } from "@/lib/options/pricing";
import type { YahooOptionsResult } from "@/lib/options/yahoo";
import type { StateRow } from "./watchdog";

// Friday 27 Nov 2026 is standard time in New York: 21:20 UTC = 16:20, 04:30 UTC (Saturday) = 23:30.
const utc = (s: string) => Date.parse(s);
const row = (cursor: number, reason: string | null, updated = "2026-11-27T21:30:00Z"): StateRow => ({ job: COLLECT_KEY, cursor, paused_reason: reason, updated_at: updated });

describe("the collection window", () => {
  it("is 16:20 to 23:30 in New York on weekdays", () => {
    expect(inCollectWindow(utc("2026-11-27T21:19:00Z"))).toBe(false);
    expect(inCollectWindow(utc("2026-11-27T21:20:00Z"))).toBe(true);
    expect(inCollectWindow(utc("2026-11-28T04:29:00Z"))).toBe(true); // still Friday evening in New York
    expect(inCollectWindow(utc("2026-11-28T04:30:00Z"))).toBe(false);
    expect(inCollectWindow(utc("2026-11-28T22:00:00Z"))).toBe(false); // Saturday
  });
  it("follows daylight time", () => {
    // 1 July 2026: New York is UTC-4, so 16:20 is 20:20 UTC
    expect(inCollectWindow(utc("2026-07-01T20:19:00Z"))).toBe(false);
    expect(inCollectWindow(utc("2026-07-01T20:20:00Z"))).toBe(true);
  });
  it("numbers the session by the New York day", () => {
    expect(sessionOf(utc("2026-11-28T02:00:00Z"))).toMatchObject({ session: 20261127, date: "2026-11-27", weekday: true });
  });
  it("stores only the finished session's quotes", () => {
    expect(["POST", "POSTPOST", "CLOSED"].every(usableState)).toBe(true);
    expect(["REGULAR", "PRE", "PREPRE", "", undefined].some(usableState)).toBe(false);
  });
});

describe("collectPlan", () => {
  const now = utc("2026-11-27T22:00:00Z");
  it("starts a new session at the top of the list", () => {
    expect(collectPlan({ nowMs: now, row: null, total: 1844 })).toMatchObject({ run: true, session: 20261127, start: 0 });
    expect(collectPlan({ nowMs: now, row: row(900, "session:20261125 done"), total: 1844 })).toMatchObject({ run: true, start: 0 });
  });
  it("resumes where the last pass stopped", () => {
    expect(collectPlan({ nowMs: now, row: row(640, "session:20261127"), total: 1844 })).toMatchObject({ run: true, start: 640 });
  });
  it("does not run when the list is through, on a holiday, or outside the window", () => {
    expect(collectPlan({ nowMs: now, row: row(1844, "session:20261127 done"), total: 1844 }).run).toBe(false);
    expect(collectPlan({ nowMs: now, row: row(0, "session:20261127 closed: Yahoo's newest quote is from 2026-11-25"), total: 1844 })).toMatchObject({ run: false, why: "no session today" });
    expect(collectPlan({ nowMs: utc("2026-11-27T20:00:00Z"), row: null, total: 1844 }).run).toBe(false);
    expect(collectPlan({ nowMs: utc("2026-11-28T15:00:00Z"), row: null, total: 1844 })).toMatchObject({ run: false, why: "no session at the weekend" });
  });
  it("leaves a receipt for a name without listed options, and for nothing else", () => {
    const now = utc("2026-11-27T21:30:00Z");
    const rows = noneReceipts([{ t: "ZZZ", kind: "none" }, { t: "AAPL", kind: "stale", quoted: "2026-11-25 PRE" }, { t: "KO", kind: "unquoted" }, { t: "X", kind: "error", message: "timeout" }], now);
    expect(rows).toEqual([{ job: "options-none:ZZZ", cursor: Math.floor(now / 1000), paused_reason: null, updated_at: "2026-11-27T21:30:00.000Z" }]);
  });
  it("a pass asked for by hand runs outside the clock window, never at the weekend", () => {
    // 18:30 UTC on an early-close day: the session ended at 13:00 in New York
    expect(collectPlan({ nowMs: utc("2026-11-27T18:30:00Z"), row: null, total: 1844 }).run).toBe(false);
    expect(collectPlan({ nowMs: utc("2026-11-27T18:30:00Z"), row: null, total: 1844, anyTime: true })).toMatchObject({ run: true, session: 20261127, start: 0 });
    expect(collectPlan({ nowMs: utc("2026-11-28T18:30:00Z"), row: null, total: 1844, anyTime: true }).run).toBe(false);
  });
  it("waits out a block and then tries again from the same place", () => {
    const blocked = collectBlocked(20261127, 300, null, utc("2026-11-27T21:50:00Z"), "Yahoo refused the collector (429) and the page reader's allowance is used");
    expect(blocked.paused_reason).toBe("session:20261127 blocked until 2026-11-27T21:55:00.000Z Yahoo refused the collector (429) and the page reader's allowance is used [n=1]");
    expect(collectPlan({ nowMs: utc("2026-11-27T21:52:00Z"), row: blocked, total: 1844 }).run).toBe(false);
    expect(collectPlan({ nowMs: utc("2026-11-27T21:56:00Z"), row: blocked, total: 1844 })).toMatchObject({ run: true, start: 300, why: "trying again after a refusal" });
  });
});

describe("state rows", () => {
  it("round-trips progress, done, closed and blocked", () => {
    const t = utc("2026-11-27T22:00:00Z");
    expect(parseCollect(collectProgress(20261127, 40, 1844, t))).toMatchObject({ session: 20261127, cursor: 40, status: "running" });
    expect(parseCollect(collectProgress(20261127, 1850, 1844, t))).toMatchObject({ cursor: 1844, status: "done" });
    expect(parseCollect(collectClosed(20261126, "2026-11-25", t))).toMatchObject({ session: 20261126, status: "closed" });
    expect(parseCollect(row(0, "night:20261126 done"))).toBeNull();
  });
  it("doubles the wait after each refusal in a session, to an hour at most", () => {
    const t = utc("2026-11-27T22:00:00Z");
    let prev = parseCollect(collectBlocked(20261127, 10, null, t, "x"));
    const waits = [prev!.until! - t];
    for (let i = 0; i < 5; i++) {
      prev = parseCollect(collectBlocked(20261127, 10, prev, t, "x"));
      waits.push(prev!.until! - t);
    }
    expect(waits.map((w) => w / 60_000)).toEqual([5, 10, 20, 40, 60, 60]);
    // a new session starts the count again
    expect(parseCollect(collectBlocked(20261130, 0, prev, t, "x"))!.streak).toBe(1);
  });
  it("reports a block in force without its bookkeeping", () => {
    const t = utc("2026-11-27T22:00:00Z");
    const b = collectBlocked(20261127, 10, null, t, "Yahoo refused the collector (429)");
    expect(collectBlock(b, t + 60_000)).toBe("Yahoo refused the collector (429)");
    expect(collectBlock(b, t + 6 * 60_000)).toBeNull();
    expect(collectBlock(row(10, "session:20261127"), t)).toBeNull();
  });
  it("keeps the page reader's count per session", () => {
    const t = utc("2026-11-27T22:00:00Z");
    expect(readerUsed(readerRow(20261127, 37, t), 20261127)).toBe(37);
    expect(readerUsed(readerRow(20261126, 600, t), 20261127)).toBe(0);
    expect(readerLeft(READER_MAX_PER_SESSION)).toBe(0);
    expect(readerLeft(10)).toBe(READER_MAX_PER_SESSION - 10);
  });
});

describe("appTakesOver", () => {
  const at = (m: number) => utc("2026-11-27T21:20:00Z") + m * 60_000;
  it("leaves the session to the worker while it moves", () => {
    expect(appTakesOver({ nowMs: at(40), row: row(200, "session:20261127", new Date(at(30)).toISOString()) })).toBe(false);
    expect(appTakesOver({ nowMs: at(40), row: row(1844, "session:20261127 done", new Date(at(1)).toISOString()) })).toBe(false);
  });
  it("steps in when the worker never started or went silent", () => {
    expect(appTakesOver({ nowMs: at(APP_TAKEOVER_MIN - 1), row: null })).toBe(false);
    expect(appTakesOver({ nowMs: at(APP_TAKEOVER_MIN), row: null })).toBe(true);
    expect(appTakesOver({ nowMs: at(90), row: row(200, "session:20261127", new Date(at(60)).toISOString()) })).toBe(true);
    expect(appTakesOver({ nowMs: at(90), row: row(200, "session:20261125 done", new Date(at(60)).toISOString()) })).toBe(true);
  });
});

describe("collectStalled", () => {
  const at = (m: number) => utc("2026-11-27T21:20:00Z") + m * 60_000;
  it("flags a running session nobody moved for 45 minutes, inside the window only", () => {
    expect(collectStalled(row(200, "session:20261127", new Date(at(10)).toISOString()), at(50))).toBeNull();
    expect(collectStalled(row(200, "session:20261127", new Date(at(10)).toISOString()), at(56))).toEqual({ movedAt: new Date(at(10)).toISOString(), cursor: 200 });
    expect(collectStalled(null, at(46))).toEqual({ movedAt: null, cursor: 0 });
    expect(collectStalled(null, at(30))).toBeNull();
    expect(collectStalled(row(200, "session:20261127 done", new Date(at(10)).toISOString()), at(200))).toBeNull();
    expect(collectStalled(null, utc("2026-11-28T15:00:00Z"))).toBeNull();
  });
});

describe("chunks", () => {
  it("skips names already stored and counts what came back", () => {
    expect(toFetch(["A", "B", "C"], new Set(["B"]))).toEqual(["A", "C"]);
    const t = tally(emptyTally(), [
      { t: "A", kind: "stored", row: {}, route: "direct" },
      { t: "B", kind: "stored", row: {}, route: "reader" },
      { t: "C", kind: "none" },
      { t: "D", kind: "unquoted" },
      { t: "E", kind: "stale", quoted: "2026-11-25 CLOSED" },
      { t: "F", kind: "error", message: "timeout" },
    ]);
    expect(t).toEqual({ stored: 2, none: 1, unquoted: 1, stale: 1, errors: 1, reader: 1 });
  });
  it("fails a chunk only when every name errored", () => {
    expect(chunkFailed([{ t: "A", kind: "error", message: "x" }, { t: "B", kind: "error", message: "y" }])).toBe(true);
    expect(chunkFailed([{ t: "A", kind: "error", message: "x" }, { t: "B", kind: "none" }])).toBe(false);
    expect(chunkFailed([])).toBe(false);
  });
});

describe("judgeChain", () => {
  const CLOSE = utc("2026-11-27T18:00:02Z") / 1000; // an early close: 13:00 in New York
  const rate = { value: 0.0436, date: "2026-11-24" };
  const chain = (state: string, at = CLOSE): YahooOptionsResult => {
    const t = 21 / 365;
    const df = Math.exp(-rate.value * t);
    const one = (right: "C" | "P", k: number) => {
      const px = black76(right, 100.2, k, t, 0.3, df);
      return { contractSymbol: `XYZ261218${right}${String(k * 1000).padStart(8, "0")}`, strike: k, bid: px - 0.02, ask: px + 0.02, volume: 5, openInterest: 50 };
    };
    return {
      underlyingSymbol: "XYZ",
      quote: { regularMarketPrice: 100, regularMarketTime: at, marketState: state },
      options: [{ expirationDate: utc("2026-12-18T00:00:00Z") / 1000, calls: [95, 100, 105].map((k) => one("C", k)), puts: [95, 100, 105].map((k) => one("P", k)) }],
    };
  };
  it("stores a finished session's chain with its source, route and method", () => {
    const r = judgeChain("XYZ", chain("POST"), "2026-11-27", rate, "direct");
    expect(r.kind).toBe("stored");
    if (r.kind !== "stored") return;
    expect(r.row).toMatchObject({ ticker: "XYZ", date: "2026-11-27", price: 100, source: "yahoo" });
    expect(r.row["meta"]).toMatchObject({ state: "POST", route: "direct", rate: 0.0436, rateDate: "2026-11-24", iv30From: { kind: "single", at: { e: "2026-12-18", d: 21 } } });
    expect(r.row["iv30"]).toBeCloseTo(0.3, 3);
  });
  it("never stores quotes taken while the session is open or from an earlier day", () => {
    expect(judgeChain("XYZ", chain("REGULAR"), "2026-11-27", rate, "direct")).toEqual({ t: "XYZ", kind: "stale", quoted: "2026-11-27 REGULAR" });
    expect(judgeChain("XYZ", chain("PRE", CLOSE - 2 * 86400), "2026-11-27", rate, "direct")).toEqual({ t: "XYZ", kind: "stale", quoted: "2026-11-25 PRE" });
    expect(judgeChain("XYZ", chain("CLOSED", CLOSE - 2 * 86400), "2026-11-27", rate, "direct").kind).toBe("stale");
  });
  it("tells no listed options from no usable quotes", () => {
    expect(judgeChain("XYZ", null, "2026-11-27", rate, "direct")).toEqual({ t: "XYZ", kind: "none" });
    const dead = chain("POST");
    dead.options![0]!.calls = dead.options![0]!.calls!.map((c) => ({ ...c, bid: 0, ask: 0 }));
    expect(judgeChain("XYZ", dead, "2026-11-27", rate, "reader")).toEqual({ t: "XYZ", kind: "unquoted" });
  });
});

describe("probeVerdict", () => {
  const q = (state: string, iso: string): YahooOptionsResult => ({ quote: { regularMarketPrice: 600, regularMarketTime: utc(iso) / 1000, marketState: state } });
  it("reads a holiday, an open session and a finished one", () => {
    expect(probeVerdict(q("CLOSED", "2026-11-25T21:00:00Z"), "2026-11-26")).toEqual({ kind: "closed", last: "2026-11-25" });
    expect(probeVerdict(q("REGULAR", "2026-11-27T17:30:00Z"), "2026-11-27")).toEqual({ kind: "open" });
    expect(probeVerdict(q("POST", "2026-11-27T18:00:00Z"), "2026-11-27")).toEqual({ kind: "ready" });
    expect(probeVerdict(null, "2026-11-27")).toEqual({ kind: "unknown" });
  });
});
