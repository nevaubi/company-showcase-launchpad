import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Bar, CompanyDataset } from "@/lib/financials/types";
import { chartSetup, earningsRead, MIN_SESSIONS, RECENT_SESSIONS } from "./setup";

const bars = (t: string) => (JSON.parse(readFileSync(path.resolve(__dirname, `../../test/fixtures/prices/${t}.json`), "utf8")) as { bars: Bar[] }).bars;
const company = (t: string) => JSON.parse(readFileSync(path.resolve(__dirname, `../../test/fixtures/companies/${t}.json`), "utf8")) as CompanyDataset;

/** Weekday bars with the given closes. */
function series(closes: number[], volume = 1e6): Bar[] {
  const out: Bar[] = [];
  const d = new Date("2025-01-02T00:00:00Z");
  for (const c of closes) {
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
    out.push([d.toISOString().slice(0, 10), c, c * 1.01, c * 0.99, c, c, volume]);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

describe("chartSetup", () => {
  it("needs enough history", () => {
    expect(chartSetup([])).toBeNull();
    expect(chartSetup(series(Array.from({ length: MIN_SESSIONS - 1 }, (_, i) => 100 + i)))).toBeNull();
  });

  it("finds the nearest clustered level on each side of the price", () => {
    // a range that turns at 90 and 110 several times, ending in the middle
    const wave = Array.from({ length: 240 }, (_, i) => 100 + 10 * Math.sin((i / 20) * Math.PI));
    const s = chartSetup(series([...wave, 100.5]))!;
    expect(s.price).toBe(100.5);
    expect(s.support!.price).toBeLessThan(100.5);
    expect(s.support!.price).toBeCloseTo(90, 0);
    expect(s.resistance!.price).toBeCloseTo(110, 0);
    expect(s.support!.touches).toBeGreaterThanOrEqual(2);
    expect(s.sessions).toBe(241);
  });

  it("lists only rules that fired in the last sessions, with their record on the same stock", () => {
    // a flat year, then a close above the prior 52-week high on the last day
    const flat = Array.from({ length: 300 }, (_, i) => 100 + (i % 2));
    const s = chartSetup(series([...flat, 120]))!;
    expect(s.active.map((a) => a.kind)).toContain("breakout_52w");
    const hit = s.active.find((a) => a.kind === "breakout_52w")!;
    expect(hit).toMatchObject({ label: "52-week breakout", bias: "bullish", price: 120 });
    expect(hit.past).toBeNull(); // it never fired before on this series
    // twelve sessions later the same rule is no longer listed as active
    const later = chartSetup(series([...flat, 120, ...Array.from({ length: RECENT_SESSIONS + 2 }, () => 119)]))!;
    expect(later.active.map((a) => a.kind)).not.toContain("breakout_52w");
  });

  it("runs on real bars", () => {
    for (const t of ["AAPL", "JPM", "NVDA"]) {
      const b = bars(t);
      const s = chartSetup(b)!;
      expect(s.asOf).toBe(b.at(-1)![0].slice(0, 10));
      if (s.support) expect(s.support.price).toBeLessThan(s.price);
      if (s.resistance) expect(s.resistance.price).toBeGreaterThan(s.price);
      for (const a of s.active) expect(b.findIndex((x) => x[0] === a.date)).toBeGreaterThanOrEqual(b.length - RECENT_SESSIONS);
    }
  });
});

describe("earningsRead", () => {
  it("measures each release once and summarises the reactions", () => {
    const d = company("AAPL");
    const r = earningsRead(bars("AAPL"), d.earningsReleases, bars("JPM"));
    expect(r.reactions.length).toBeGreaterThan(8);
    expect(r.reactions.map((x) => x.date)).toEqual([...r.reactions.map((x) => x.date)].sort().reverse());
    expect(r.stats).toMatchObject({ n: r.reactions.length });
    expect(r.stats!.avgAbsMove).toBeGreaterThan(0);
    expect(r.asOf).toBe(bars("AAPL").at(-1)![0].slice(0, 10));
  });
  it("is empty without bars or releases", () => {
    expect(earningsRead([], company("AAPL").earningsReleases)).toEqual({ reactions: [], stats: null, asOf: null });
    expect(earningsRead(bars("AAPL"), []).stats).toBeNull();
  });
});
