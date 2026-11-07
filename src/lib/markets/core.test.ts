import { describe, expect, it } from "vitest";
import type { Bar } from "../financials/types";
import {
  correlationMatrix,
  detectPatterns,
  earningsReactions,
  reactionStats,
  returnsByDate,
} from "./core";

const day = (i: number) => new Date(Date.UTC(2024, 0, 1) + i * 86400000).toISOString().slice(0, 10);
const mk = (closes: number[], vol = 1000): Bar[] =>
  closes.map((c, i) => [day(i), c, c, c, c, c, vol]);

describe("earnings reactions", () => {
  it("measures close-before to close-day-after and excess vs SPY", () => {
    const bars = mk([100, 100, 100, 110, 121, 121]);
    const spy = mk([100, 100, 100, 101, 101, 101]);
    const [r] = earningsReactions(bars, [{ filed: day(3), accn: "a", doc: "d" }], spy);
    expect(r.move).toBeCloseTo(0.21);
    expect(r.excess).toBeCloseTo(0.2);
    expect(reactionStats([r]).upRate).toBe(1);
  });
});

describe("correlations", () => {
  it("is 1 for identical and -1 for mirrored returns", () => {
    const up = Array.from({ length: 40 }, (_, i) => 100 + (i % 3) * 2 + i);
    const a = returnsByDate(mk(up));
    const neg = new Map([...a].map(([d, v]) => [d, -v]));
    const m = correlationMatrix([a, a, neg], 30);
    expect(m[0][1]).toBeCloseTo(1);
    expect(m[0][2]).toBeCloseTo(-1);
  });
});

describe("patterns", () => {
  it("flags a 52-week breakout only once the prior high is cleared", () => {
    const closes = [...Array.from({ length: 260 }, (_, i) => 100 + Math.sin(i / 5) * 5), 106];
    const hits = detectPatterns(mk(closes)).filter((h) => h.kind === "breakout_52w");
    expect(hits.map((h) => h.index)).toEqual([260]);
  });
  it("detects a golden cross when the 50d moves above the 200d", () => {
    const closes = [
      ...Array.from({ length: 220 }, () => 100),
      ...Array.from({ length: 60 }, (_, i) => 100 + i),
    ];
    expect(detectPatterns(mk(closes)).some((h) => h.kind === "golden_cross")).toBe(true);
  });
});
