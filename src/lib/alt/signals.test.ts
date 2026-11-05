import { describe, expect, it } from "vitest";
import { computeSignals, heat, signalLabel, topChanges, type Bucket } from "./signals";

const b = (bucket: number, n: number, ticker = "AAA", dataset = "events"): Bucket => ({ ticker, dataset, bucket, n, last_date: null });

describe("alt signals", () => {
  it("compares the last 90 days with the prior 8 windows", () => {
    const rows = [b(0, 10), ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => b(i, 2))];
    const [s] = computeSignals(rows);
    expect(s.recent).toBe(10);
    expect(s.baseline).toBe(2);
    // sd 0 → spread floors at √2
    expect(s.z).toBeCloseTo(8 / Math.SQRT2, 5);
    expect(s.history).toEqual([2, 2, 2, 2, 2, 2, 2, 2, 10]);
  });

  it("ignores buckets outside the window", () => {
    const [s] = computeSignals([b(0, 1), b(9, 50)]);
    expect(s.baseline).toBe(0);
    expect(s.z).toBe(1);
  });

  it("does not flag a single event against an empty history", () => {
    const sig = computeSignals([b(0, 1)]);
    expect(topChanges(sig)).toHaveLength(0);
  });

  it("flags a drop only from a busy baseline", () => {
    const busy = computeSignals([...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => b(i, 20, "BUSY"))]);
    expect(topChanges(busy)[0].ticker).toBe("BUSY");
  });

  it("labels pace and heat", () => {
    const [s] = computeSignals([b(0, 6), ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => b(i, 2))]);
    expect(signalLabel(s)).toBe("3.0× its usual pace");
    expect(heat(2.4)).toBe(2);
    expect(heat(-1.2)).toBe(-1);
  });
});
