import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Bar } from "@/lib/financials/types";
import { analyze, barsFromPriceRows, type Technicals } from "./analysis";
import { EVIDENCE, isTested } from "./evidence";
import type { PooledRow } from "./pooled";
import { technicalRead } from "./read";
import { binomTwoSided, tCritical, tTwoSided } from "./stat";
import { detectableText, sampleLength, verdictSummary } from "./verdict";

const rows = (t: string) => (JSON.parse(readFileSync(`src/test/fixtures/prices/${t}.json`, "utf8")) as { bars: Bar[] }).bars;
const run = (t: string): Technicals => analyze({ sym: t, bars: barsFromPriceRows(rows(t)), bench: [], intervals: "candidates" })!;

const pooledRow = (type: string, h: 5 | 20 | 60, over: Partial<PooledRow> = {}): PooledRow => ({
  type,
  name: type,
  dir: 1,
  text: "",
  h,
  n: 4200,
  months: 180,
  symbols: 1800,
  mean: 0.031,
  hit: 0.62,
  base: 0.018,
  baseHit: 0.59,
  excess: 0.013,
  ci: [0.008, 0.018],
  se: 0.00255,
  z: 5.1,
  p: 3e-7,
  q: 0.0004,
  verdict: "reliable",
  reason: "ok",
  ...over,
});

describe("Student-t critical values", () => {
  it("inverts the two-sided p-value", () => {
    expect(tCritical(0.05, 1e7)).toBeCloseTo(1.959964, 4);
    expect(tCritical(0.05, 10)).toBeCloseTo(2.228139, 5);
    expect(tCritical(0.01, 5)).toBeCloseTo(4.032143, 5);
    const c = tCritical(0.05 / 58, 40);
    expect(tTwoSided(c, 40)).toBeCloseTo(0.05 / 58, 10);
  });
});

describe("what the bar can see (minimum detectable effect)", () => {
  // The bar is the difference from days without the condition that a cell needs for an even chance of being
  // called reliable: t(1 − 0.025/m, nEff − 1) × Hodrick SE ÷ (1 − share of days flagged), median over the
  // horizon's family cells. Independent figures (scipy, work/r3/p4-tech3/py/mde_contrast.py on these fixtures):
  // AAPL 1.95% / 5.12% / 9.04%; AAPL last 700 bars 3.21% at 5 days (6 cells), 20 days has 1 cell; AAPL last
  // 420 bars 2 cells. The review's figures on the preview's longer bars: 1.95% / 5.06% / 9.07% (p3-tech M1).
  // Against all days (the old bar) the same fixtures gave 1.73% / 4.21% / 6.27%, and 1.36% and 0.41% when cut.
  const T = run("AAPL");
  const cut = (n: number) => analyze({ sym: "AAPL", bars: barsFromPriceRows(rows("AAPL").slice(-n)), bench: [], intervals: "candidates" })!;
  const pct = (E: Technicals["evidence"], h: 5 | 20 | 60) => Math.round(E.detectable[h]! * 10000) / 100;
  it("reproduces the independent figures for Apple against days without the condition", () => {
    expect(pct(T.evidence, 5)).toBe(1.95);
    expect(pct(T.evidence, 20)).toBe(5.12);
    expect(pct(T.evidence, 60)).toBe(9.04);
    const short = cut(700).evidence;
    expect(pct(short, 5)).toBe(3.21);
    expect(short.detectable[20]).toBeNull();
    expect(short.detectable[60]).toBeNull();
  });
  it("never falls when history is removed", () => {
    for (const n of [1500, 1000, 700, 420, 300]) {
      const E = cut(n).evidence;
      for (const h of EVIDENCE.horizons) if (E.detectable[h] != null) expect(E.detectable[h]!).toBeGreaterThan(T.evidence.detectable[h]!);
    }
  });
  it("states no figure from fewer than five cells", () => {
    const E = cut(420).evidence;
    expect(EVIDENCE.horizons.map((h) => E.detectable[h])).toEqual([null, null, null]);
    expect(detectableText(E, "AAPL")).toBeNull();
  });
  it("is the median over the horizon's cells of the critical t times the standard error of the contrast", () => {
    const m = T.evidence.tested;
    const need = T.evidence.rows
      .map((r) => r.cells[20])
      .filter((c) => c?.q != null)
      .map((c) => (tCritical(EVIDENCE.fdr / m, c!.test.dof) * c!.test.se) / (1 - c!.test.n / c!.test.nAll))
      .sort((a, b) => a - b);
    const mid = need.length % 2 ? need[(need.length - 1) / 2] : (need[need.length / 2 - 1] + need[need.length / 2]) / 2;
    expect(T.evidence.detectable[20]).toBeCloseTo(mid, 12);
  });
  it("says it in plain words beside the verdict, with its basis", () => {
    const text = detectableText(T.evidence, "AAPL")!;
    expect(text).toBe(
      "With 9 years of AAPL's history, only a condition after which the average return differs from days without it by about 2.0% over 5 days, 5.1% over 20 days or 9.0% over 60 days would have an even chance of showing up as reliable; smaller differences show as no clear difference.",
    );
    const v = T.read.find((s) => s.key === "verdict")!;
    expect(v.aside).toBe(text);
    expect(v.table.formula).toContain(text);
    expect(sampleLength(2512 - 252)).toBe("9 years");
    expect(sampleLength(500)).toBe("2.0 years");
    expect(sampleLength(120)).toBe("6 months");
  });
});

describe("the verdict sentence", () => {
  const T = run("AAPL");
  const E = T.evidence;
  const active = E.rows.filter((r) => r.active);
  it("counts only tested conditions and names those left out for small samples", () => {
    const tested = active.filter(isTested);
    const untested = active.filter((r) => !isTested(r));
    const v = technicalRead(T.measures, E, { sym: "AAPL", pooled: [] }).find((s) => s.key === "verdict")!;
    expect(v.text).toMatch(/^No statistically reliable signal today/);
    if (tested.length) expect(v.text).toContain(`none of the ${tested.length} tested condition${tested.length === 1 ? "" : "s"} in force`);
    for (const r of untested) expect(v.text).toContain(r.name);
    if (untested.length) expect(v.text).toContain("too few cases to test");
    expect(v.figures.find((f) => f.label === "Tested")?.value).toBe(String(tested.length));
  });
  it("states that the cross-company record is unavailable when it is", () => {
    const v = technicalRead(T.measures, E, { sym: "AAPL", pooled: null }).find((s) => s.key === "verdict")!;
    expect(v.text).toContain("the cross-company record is not available right now");
    expect(v.table.rows.every((r) => r[r.length - 2] === "not available")).toBe(true);
  });
  it("reports a condition reliable across companies but not on the stock as an average, not a forecast", () => {
    const row = active[0];
    const P = [pooledRow(row.key, 20)];
    const S = verdictSummary(E, P);
    expect(S.outcome).toBe("pooled");
    const v = technicalRead(T.measures, E, { sym: "AAPL", pooled: P }).find((s) => s.key === "verdict")!;
    expect(v.text).toMatch(/^Not detectable on AAPL's own history, but reliable across companies: /);
    expect(v.text).toContain(`${row.name} has been followed across 1,800 covered companies by an average of 1.3% more than all days over 20 days (4,200 events, interval +0.8% to +1.8%, q 0.000)`);
    expect(v.text).toContain("That is an average across companies, not a forecast for AAPL");
    expect(v.tone).toBe(1);
    expect(v.table.rows.find((r) => r[0] === row.name)![v.table.cols.length - 1]).toBe("reliable across companies");
  });
  it("says neither when the cross-company record exists but is not reliable", () => {
    const row = active[0];
    const P = [pooledRow(row.key, 20, { verdict: "context", reason: "base", q: 0.4 })];
    expect(verdictSummary(E, P).outcome).toBe("neither");
    const v = technicalRead(T.measures, E, { sym: "AAPL", pooled: P }).find((s) => s.key === "verdict")!;
    expect(v.text).toContain("none of the 1 in force with a cross-company record is reliable across covered companies");
  });
});

describe("earnings: what followed the releases, against the base rate", () => {
  it("binomial test agrees with scipy.stats.binomtest", () => {
    expect(binomTwoSided(3, 20, 0.5)).toBeCloseTo(0.0025768280029296875, 12);
    expect(binomTwoSided(30, 40, 0.55)).toBeCloseTo(0.010850929431026692, 10);
    expect(binomTwoSided(22, 41, 0.54)).toBeCloseTo(1, 10);
  });
  it("tests the 20 days after each reaction window like a condition, with its base rate", () => {
    const filings = (JSON.parse(readFileSync("src/test/fixtures/companies/AAPL.json", "utf8")) as { filings: { form: string; items?: string; filed: string; accn: string; doc: string }[] }).filings;
    const releases = filings.filter((f) => f.form === "8-K" && (f.items ?? "").split(",").includes("2.02")).map((f) => ({ filed: f.filed, accn: f.accn, doc: f.doc }));
    const B = barsFromPriceRows(rows("AAPL"));
    const T = analyze({ sym: "AAPL", bars: B, bench: [], releases, intervals: "candidates" })!;
    const R = T.reactions!;
    const D = R.drift;
    expect(D.test).not.toBeNull();
    // the tested windows are exactly the releases with a complete 20-day window, and their average is the table's
    const done = R.rows.filter((r) => r.drift20 != null);
    expect(D.n).toBe(done.length);
    expect(D.test!.n).toBe(done.length);
    expect(D.test!.mean).toBeCloseTo(R.stats.avgDrift20!, 10);
    // the base rate is the average of every 20-day window of the history
    let s = 0;
    for (let i = 0; i + 20 < B.c.length; i++) s += B.tr[i + 20] / B.tr[i] - 1;
    expect(D.test!.meanAll).toBeCloseTo(s / (B.c.length - 20), 10);
    expect(D.continued).toBe(done.filter((r) => Math.sign(r.drift20!) === Math.sign(r.move)).length);
    const up = done.filter((r) => r.move > 0).length / done.length;
    expect(D.expected).toBeCloseTo(up * D.test!.hitAll + (1 - up) * (1 - D.test!.hitAll), 12);
    expect(D.p).toBeGreaterThan(0.05); // AAPL: nothing unusual after its releases
  });
});
