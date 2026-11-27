import { describe, expect, it } from "vitest";
import type { Bar } from "../financials/types";
import { indexVolatility, quoteHistory, reactionsAtQuote } from "./as-of";

const date = (day: number) => new Date(Date.UTC(2026, 0, day)).toISOString().slice(0, 10);
const bars: Bar[] = Array.from({ length: 31 }, (_, i) => {
  const close = i >= 25 ? 300 + i : 100 + (i % 3);
  return [date(i + 1), close, close, close, close, close, 5];
});
const releases = [10, 25, 26].map((day) => ({ filed: date(day), accn: String(day), doc: "report.htm" }));
const moves = [
  { d: date(10), end: date(11), m: -0.1, a: "a", doc: "a" },
  { d: date(25), end: date(27), m: 0.9, a: "b", doc: "b" },
  { d: date(12), m: 0.04, a: "c", doc: "c" },
];

describe("options comparisons at the recorded close", () => {
  it("ignores later price shocks, incomplete earnings windows and missing same-day closes", () => {
    const known = quoteHistory(bars.slice(0, 25), releases, date(25));
    expect(quoteHistory(bars, releases, date(25))).toEqual(known);
    expect(known.reactions.map((r) => r.endDate)).toEqual([date(11)]);
    expect(known.realized).toBeGreaterThan(0);
    expect(quoteHistory(bars.slice(0, 24), releases, date(25)).realized).toBeNull();
  });
  it("uses observed exit dates and only trusts legacy rows when the archive was already built", () => {
    expect(reactionsAtQuote(moves, date(28), date(25))?.median).toBe(0.1);
    expect(reactionsAtQuote(moves, date(28), date(28))?.median).toBe(0.1);
    expect(reactionsAtQuote(moves.slice(2), date(28), date(25))).toBeNull();
  });
  it("matches SPY to the VIX date and excludes today's VIX from its trailing percentile", () => {
    const levels: [string, number][] = Array.from({ length: 254 }, (_, i) => [date(i + 1), i === 253 ? 50 : i + 1]);
    const end = indexVolatility(levels, bars)!;
    expect(end.percentile).toBeCloseTo(48 / 252);
    expect(end.change).toBe(-199);
    expect(end.realized).toBeNull();
    expect(indexVolatility([[date(25), 20]], bars)?.realized).toEqual(quoteHistory(bars, [], date(25)).realized);
  });
});
