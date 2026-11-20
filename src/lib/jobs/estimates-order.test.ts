import { describe, expect, it } from "vitest";
import { chargeFailure, estimateErrorClass, failHolds, pickEstimates, scanCursorAfter } from "./estimates-order";

const now = Date.parse("2026-11-20T10:00:00Z");
const ago = (d: number) => new Date(now - d * 86400_000).toISOString();
const base = { start: 10, total: 100, have: new Set<string>(), none: new Map<string, string | null>(), stale: [] as { ticker: string; fetchedAt: string }[], nowMs: now };

describe("estimates order", () => {
  it("missing coverage first, in the scan's priority order, then the stalest rows", () => {
    const p = pickEstimates({ ...base, candidates: ["A", "B", "C", "D"], have: new Set(["A", "C"]), stale: [{ ticker: "S", fetchedAt: ago(1) }] });
    expect(p.batch.map((b) => b.ticker)).toEqual(["B", "D", "S"]);
    expect(p.batch[0]).toMatchObject({ kind: "missing", nextCursor: 12 });
    expect(p.scanCursor).toBeNull();
  });
  it("reserves one slot for a row older than a week", () => {
    const p = pickEstimates({ ...base, candidates: ["A", "B", "C", "D"], stale: [{ ticker: "S", fetchedAt: ago(8) }] });
    expect(p.batch.map((b) => b.ticker)).toEqual(["A", "B", "S"]);
  });
  it("a window with nothing missing moves the scan on and refreshes the stalest", () => {
    const p = pickEstimates({ ...base, candidates: ["A", "B"], have: new Set(["A", "B"]), stale: [{ ticker: "A", fetchedAt: ago(1) }] });
    expect(p.batch).toEqual([{ ticker: "A", kind: "stale" }]);
    expect(p.scanCursor).toBe(12);
  });
  it("a fresh 'no estimates' receipt skips the ticker; an old one does not", () => {
    const p = pickEstimates({ ...base, candidates: ["A", "B"], none: new Map([["A", ago(3)], ["B", ago(40)]]) });
    expect(p.batch.map((b) => b.ticker)).toEqual(["B"]);
  });
  it("classifies errors: one symbol's answers are the ticker's, timeouts and retried outages the provider's", () => {
    expect(estimateErrorClass(new Error("No estimates for X"))).toBe("none");
    expect(estimateErrorClass(new Error("Estimates provider responded 404"))).toBe("ticker");
    expect(estimateErrorClass(new SyntaxError("Unexpected token <"))).toBe("ticker");
    expect(estimateErrorClass(new TypeError("Cannot read properties of undefined"))).toBe("ticker");
    expect(estimateErrorClass(new Error("Estimates provider unavailable"))).toBe("provider");
    expect(estimateErrorClass(new Error("Estimates provider session failed (429)"))).toBe("provider");
    expect(estimateErrorClass(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }))).toBe("provider");
    expect(estimateErrorClass(new TypeError("fetch failed"))).toBe("provider");
  });
  it("a failure receipt holds a ticker 6 h, a give-up 7 days; three charges give up", () => {
    expect(failHolds({ tries: 1, at: ago(0.2) }, now)).toBe(true);
    expect(failHolds({ tries: 1, at: ago(0.3) }, now)).toBe(false);
    expect(failHolds({ tries: 3, at: ago(6) }, now)).toBe(true);
    expect(failHolds({ tries: 3, at: ago(8) }, now)).toBe(false);
    let prev: { tries: number; at: string } | undefined;
    const out = [1, 2, 3].map(() => {
      const c = chargeFailure("X", prev, "404", now);
      prev = { tries: c.tries, at: c.row.updated_at };
      return c.gaveUp;
    });
    expect(out).toEqual([false, false, true]);
  });
  it("held tickers are skipped, the deferred ticker goes last, and the scan moves only past a leading run of attempted picks", () => {
    const p = pickEstimates({ ...base, candidates: ["A", "B", "C", "D"], failed: new Map([["B", { tries: 1, at: ago(0.1) }]]), deferred: "A" });
    expect(p.batch.map((b) => b.ticker)).toEqual(["C", "D", "A"]);
    expect(scanCursorAfter(p.batch, new Set(["C", "D"]))).toBeNull();
    expect(scanCursorAfter(p.batch, new Set(["C", "D", "A"]))).toBe(14);
    expect(scanCursorAfter(p.batch, new Set(["A"]))).toBe(11);
  });
});
