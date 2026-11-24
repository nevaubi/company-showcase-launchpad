import { describe, expect, it } from "vitest";
import { openGaps } from "./dense";

function series(n = 700) {
  const c = Array.from({ length: n }, (_, i) => 100 + 12 * Math.sin(i / 17) + i * 0.04);
  // An up gap at bar 650 that stays open (price moves well above it), and a down gap at 400 that later fills.
  for (let i = 650; i < n; i++) c[i] += 40;
  const o = c.map((x, i) => (i > 0 ? c[i - 1] : x));
  o[650] = c[649] * 1.06;
  o[400] = c[399] * 0.94;
  c[400] = o[400];
  return { c, o };
}

describe("open gaps for the price chart", () => {
  const { c, o } = series(700);
  const bars = c.map((x, i) => [
    new Date(Date.UTC(2020, 0, 1) + i * 864e5).toISOString().slice(0, 10),
    o[i],
    Math.max(x, o[i]) + 0.3,
    Math.min(x, o[i]) - 0.3,
    x,
    x,
    1e6,
  ]) as [string, number, number, number, number, number, number][];

  it("finds the gap that is still open and drops the one that filled", () => {
    const g = openGaps(bars);
    expect(g.some((x) => x.dir === 1 && x.date === bars[650][0])).toBe(true);
    expect(g.some((x) => x.date === bars[400][0])).toBe(false);
    expect(g.every((x) => x.top >= x.bottom)).toBe(true);
  });
  it("returns nothing for too few or unusable bars", () => {
    expect(openGaps(bars.slice(0, 2))).toEqual([]);
    expect(openGaps([["2020-01-01", 0, 0, 0, 0]])).toEqual([]);
  });
});
