import { describe, expect, it } from "vitest";
import { pickEstimates } from "./estimates-order";

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
});
