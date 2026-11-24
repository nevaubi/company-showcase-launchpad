import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Bar } from "@/lib/financials/types";
import { analyze, barsFromPriceRows, MIN_BARS, type Technicals } from "./analysis";
import { EVIDENCE } from "./evidence";
import type { BenchSeries } from "./measures";
import { fmtNum, fmtPct, ordinal, pctile } from "./read";
import { simulateBars } from "./simulate";

const rows = (t: string) =>
  (JSON.parse(readFileSync(t === "SPY" || t.startsWith("XL") ? `public/data/prices/${t}.json` : `src/test/fixtures/prices/${t}.json`, "utf8")) as { bars: Bar[] }).bars;
const bench = (sym: string, kind: BenchSeries["kind"]): BenchSeries => {
  const B = barsFromPriceRows(rows(sym));
  return { sym, kind, d: B.d, tr: B.tr };
};
const releases = (t: string) =>
  (JSON.parse(readFileSync(`src/test/fixtures/companies/${t}.json`, "utf8")) as { filings: { form: string; items?: string; filed: string; accn: string; doc: string }[] }).filings
    .filter((f) => f.form === "8-K" && (f.items ?? "").split(",").includes("2.02"))
    .map((f) => ({ filed: f.filed, accn: f.accn, doc: f.doc }));

/**
 * Real ten-year histories from the repository's fixtures. The expected values were computed independently
 * with numpy, pandas and scipy from the same files (tools/expected.py in the round-3 work folder: momentum
 * from the adjusted close, Wilder RSI, rolling sample SD, scipy.stats.linregress for beta, the Lo-MacKinlay
 * formulas written out, and the Hodrick standard error through an explicit convolution).
 */
const EXPECTED = {
  AAPL: { mom12_1: 0.23405517431135658, rsi: 47.87306383355341, rv21: 0.15793080439064505, betaSpy: 0.5700873306676373, vr5: 0.999218021329168, vr5z: -0.00848545702229686, maxDrawdown: -0.3851593650932623, excess: -0.002321896632518649, t: -0.5442766830304407, days: 1774 },
  JPM: { mom12_1: 0.08938647774700925, rsi: 53.278960120439194, rv21: 0.1533975269429187, betaSpy: 0.7437098575583314, vr5: 1.0160675130233918, vr5z: 0.1970369150653186, maxDrawdown: -0.43626458586748884, excess: -0.0013843122295942242, t: -0.28474781389484916, days: 1643 },
  NVDA: { mom12_1: 0.1558503219533498, rsi: 33.30534068239335, rv21: 0.31715074244638036, betaSpy: 1.935079348035443, vr5: 0.9005537124405911, vr5z: -1.4407243304262296, maxDrawdown: -0.6633513493993307, excess: 0.008085072518195548, t: 1.0996545734559215, days: 1762 },
} as const;
const SECTOR = { AAPL: "XLK", JPM: "XLF", NVDA: "XLK" } as const;

const run = (t: keyof typeof EXPECTED): Technicals =>
  analyze({ sym: t, bars: barsFromPriceRows(rows(t)), bench: [bench("SPY", "market"), bench(SECTOR[t], "sector")], releases: releases(t), intervals: "candidates" })!;

describe("analysis on real histories, against an independent calculation", () => {
  for (const t of ["AAPL", "JPM", "NVDA"] as const) {
    const T = run(t);
    const X = EXPECTED[t];
    it(`${t}: measures match numpy`, () => {
      expect(T.bars).toBe(2512);
      expect(T.asOf).toBe("2026-11-02");
      expect(T.measures.momentum.mom12_1).toBeCloseTo(X.mom12_1, 10);
      expect(T.measures.stretch.rsi).toBeCloseTo(X.rsi, 8);
      expect(T.measures.volatility.rv21).toBeCloseTo(X.rv21, 10);
      expect(T.measures.momentum.vs[0].sym).toBe("SPY");
      expect(T.measures.momentum.vs[0].beta).toBeCloseTo(X.betaSpy, 10);
      const vr = T.measures.walk.rows.find((r) => r.q === 5)!;
      expect(vr.vr).toBeCloseTo(X.vr5, 10);
      expect(vr.z).toBeCloseTo(X.vr5z, 8);
      expect(T.measures.drawdown.max).toBeCloseTo(X.maxDrawdown, 10);
    });
    it(`${t}: the forward-return test matches numpy`, () => {
      const cell = T.evidence.rows.find((r) => r.key === "above_200")!.cells[20]!;
      expect(cell.test.n).toBe(X.days);
      expect(cell.test.excess).toBeCloseTo(X.excess, 12);
      expect(cell.test.t).toBeCloseTo(X.t, 9);
    });
    it(`${t}: every sentence of the read carries the figures it prints`, () => {
      expect(T.read.map((s) => s.key)).toEqual(["trend", "momentum", "stretch", "volatility", "volume", "verdict"]);
      for (const s of T.read) {
        expect(s.figures.length).toBeGreaterThan(0);
        expect(s.table.rows.length).toBeGreaterThan(0);
        for (const r of s.table.rows) expect(r).toHaveLength(s.table.cols.length);
        // every number printed in the sentence is one of its figures or appears in its table
        const known = [...s.figures.map((f) => f.value), ...s.table.rows.flat(), s.table.note ?? ""].join(" | ");
        const printed = s.text.match(/[+−]?\d[\d,]*(?:\.\d+)?(?:%|×)?/g) ?? [];
        for (const p of printed) {
          if (FIXED.has(p)) continue; // parameters and labels, not computed values
          const bare = p.replace(/^[+−]/, "").replace(/[%×]$/, "");
          if (!known.includes(bare)) throw new Error(`${t} ${s.key}: "${p}" is printed but is not among the sentence's figures: ${s.text}`);
        }
      }
    });
  }

  it("says there is no reliable signal when nothing passes, and names the tests behind that", () => {
    const T = run("AAPL");
    expect(T.evidence.reliable).toEqual([]);
    const v = T.read.find((s) => s.key === "verdict")!;
    expect(v.text).toMatch(/^No statistically reliable signal today/);
    expect(v.text).toContain(`${T.evidence.tested} tests`);
    expect(v.tone).toBe(0);
    expect(v.table.rows).toHaveLength(T.evidence.rows.filter((r) => r.active).length);
  });

  it("names the condition, its figures and its interval when a condition in force passes every check", () => {
    // Long runs of drift: trend conditions carry information (the planted case of evidence.test.ts).
    let T: Technicals | null = null;
    for (let seed = 77; seed < 97 && !T; seed++) {
      const x = analyze({ sym: "SIM", bars: simulateBars(seed, { trend: 0.003, run: 250, vol: 0.012 }), bench: [] });
      if (x && x.evidence.rows.some((r) => r.active && Object.values(r.cells).some((c) => c?.verdict === "reliable"))) T = x;
    }
    expect(T).not.toBeNull();
    const v = T!.read.find((s) => s.key === "verdict")!;
    expect(v.text).not.toMatch(/No statistically reliable/);
    expect(v.text).toMatch(/has been followed by [+−][\d.]+% (more|less) than its usual (5|20|60)-day return \(\d+ independent cases, interval /);
    expect(v.tone).not.toBe(0);
    expect(v.figures.map((f) => f.label)).toEqual(expect.arrayContaining(["Excess", "Horizon", "Independent cases", "q"]));
    expect(v.table.rows.some((r) => r[r.length - 1] === "reliable")).toBe(true);
  });

  it("builds the earnings-reaction history from the 8-K releases", () => {
    const T = run("AAPL");
    expect(T.reactions).not.toBeNull();
    const R = T.reactions!;
    expect(R.rows.length).toBeGreaterThan(30);
    expect(R.stats.n).toBe(R.rows.length);
    // the first reaction listed is the latest release with two sessions after it
    const B = barsFromPriceRows(rows("AAPL"));
    const r = R.rows[0];
    const i = B.d.findIndex((d) => d >= r.date);
    expect(r.move).toBeCloseTo(B.tr[i + 1] / B.tr[i - 1] - 1, 10);
    expect(r.excess).not.toBeNull();
  });

  it("logs every ta.js event with what followed", () => {
    const T = run("NVDA");
    expect(T.events.length).toBeGreaterThan(100);
    for (let k = 1; k < T.events.length; k++) expect(T.events[k].i).toBeLessThanOrEqual(T.events[k - 1].i);
    const B = barsFromPriceRows(rows("NVDA"));
    const e = T.events.find((x) => x.i + 60 < B.c.length)!;
    expect(e.fwd[20]).toBeCloseTo(B.tr[e.i + 20] / B.tr[e.i] - 1, 12);
    expect(T.events[0].fwd[60]).toBeNull(); // the newest events have no 60-day window yet
    expect(Object.keys(e.fwd).map(Number)).toEqual([...EVIDENCE.horizons]);
  });
});

/** Numbers in the read that are parameters or labels, not computed values. */
const FIXED = new Set(["200", "50", "126", "252", "12", "1", "6", "14", "21", "20", "5", "60"]);

describe("analysis: inputs", () => {
  it("turns price-file rows into bars with a total-return index", () => {
    const B = barsFromPriceRows([
      ["2024-01-02", 10, 11, 9, 10, 9.5, 100],
      ["2024-01-03", 10, 12, 10, 12, 11.4, 200],
      ["2024-01-04", 0, 0, 0, 0, 0, 0], // a bad row is dropped
      ["2024-01-05", 12, 12, 11, 11, 11, 0],
    ]);
    expect(B.d).toEqual(["2024-01-02", "2024-01-03", "2024-01-05"]);
    expect(B.tr[0]).toBe(1);
    expect(B.tr[1]).toBeCloseTo(11.4 / 9.5, 12);
    expect(B.tr[2]).toBeCloseTo(11 / 9.5, 12);
    expect(B.h[2]).toBe(12);
    expect(B.v).toEqual([100, 200, 0]);
  });
  it("returns nothing for a history too short to analyse, and still works on a short one", () => {
    expect(analyze({ sym: "X", bars: simulateBars(1, { n: MIN_BARS - 1 }) })).toBeNull();
    const T = analyze({ sym: "X", bars: simulateBars(1, { n: 150 }) })!;
    expect(T.evidence.tested).toBe(0);
    expect(T.measures.trend.fits.map((f) => f.window)).toEqual([126]);
    expect(T.measures.state.sma200).toBeNull();
    expect(T.read.find((s) => s.key === "trend")).toBeUndefined(); // no 200-day average, so no trend sentence
    expect(T.reactions).toBeNull();
  });
  it("handles a symbol without volume", () => {
    const B = simulateBars(2, { n: 900 });
    const T = analyze({ sym: "IDX", bars: { ...B, v: B.v.map(() => 0) } })!;
    expect(T.measures.liquidity.hasVolume).toBe(false);
    expect(T.read.find((s) => s.key === "volume")).toBeUndefined();
    expect(T.measures.levels.some((l) => l.kind === "vwap")).toBe(false);
  });
});

describe("read formatting", () => {
  it("writes numbers the way the page prints them", () => {
    expect(fmtPct(0.1234)).toBe("+12.3%");
    expect(fmtPct(-0.1234, 2)).toBe("−12.34%");
    expect(fmtPct(0.1234, 1, false)).toBe("12.3%");
    expect(fmtPct(null)).toBe("–");
    expect(fmtNum(-1.5, 1)).toBe("−1.5");
    expect(fmtNum(1.5, 1, true)).toBe("+1.5");
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(22)).toBe("22nd");
    expect(ordinal(13)).toBe("13th");
    expect(pctile(0.002)).toBe("1st percentile");
    expect(pctile(0.998)).toBe("99th percentile");
    expect(pctile(0.72)).toBe("72nd percentile");
  });
});
