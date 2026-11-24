import { describe, expect, it } from "vitest";
import { checkConsistency } from "./consistency";
import type { IrPayload, PayloadCell, PayloadSeries } from "./payload";

const c = (v: number, extra: Partial<PayloadCell> = {}): PayloadCell => ({ v, d: 0, ...extra });
const p = (s: PayloadSeries[], quarters: string[]): IrPayload => ({
  v: 2, ticker: "TST", builtAt: "", quarters, years: [], docs: [], groups: [], checks: [], series: s,
  stats: { series: 1, groups: 0, documents: 0, facts: 0, firstPeriod: null, lastPeriod: null, checksQ: { ok: 0, total: 0 }, checksFY: { ok: 0, total: 0 } },
});
const Q = ["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31"];

describe("quarters against the year", () => {
  // AAPL revenue FY2025 (real release figures, $M): 124,300 + 95,359 + 94,036 + 102,466 = 416,161.
  const aapl = ["2024-12-28", "2025-03-29", "2025-06-28", "2025-09-27"];
  it("passes a year its four printed quarters add up to", () => {
    const s: PayloadSeries = { k: "r", cat: "income", met: "revenue", label: "Net sales", parent: null, total: true, unit: "usd", q: Object.fromEntries(aapl.map((e, i) => [e, c([124_300, 95_359, 94_036, 102_466][i] * 1e6)])), y: { "2025-09-27": c(416_161e6) } };
    const { payload, summary } = checkConsistency(p([s], aapl));
    expect(summary).toMatchObject({ years: 1, yearsFailed: 0 });
    expect(payload.series[0].y["2025-09-27"].flags).toBeUndefined();
  });
  it("flags a year that doesn't, with the arithmetic", () => {
    const s: PayloadSeries = { k: "r", cat: "income", met: "revenue", label: "Revenue", parent: null, total: true, unit: "usd", q: Object.fromEntries(Q.map((e) => [e, c(1e9)])), y: { "2025-12-31": c(5e9) } };
    const { payload, summary } = checkConsistency(p([s], Q));
    expect(summary.yearsFailed).toBe(1);
    expect(payload.series[0].y["2025-12-31"].flags?.[0]).toMatchObject({ k: "year", v: 4e9 });
    expect(payload.series[0].y["2025-12-31"].flags?.[0].why).toBe("The four quarters add up to $4.000B ($1.000B + $1.000B + $1.000B + $1.000B); the year prints $5.000B, $1.000B apart.");
  });
  it("skips balances, years with a calculated quarter, and years missing a quarter", () => {
    const bal: PayloadSeries = { k: "d", cat: "balance", met: "deposits", label: "Total deposits", parent: null, total: true, unit: "usd", pit: true, q: Object.fromEntries(Q.map((e) => [e, c(1e9)])), y: { "2025-12-31": c(1e9) } };
    const calc: PayloadSeries = { k: "r", cat: "income", met: "revenue", label: "Revenue", parent: null, total: true, unit: "usd", q: { ...Object.fromEntries(Q.slice(0, 3).map((e) => [e, c(1e9)])), "2025-12-31": c(2e9, { f: { formula: "Full year − Q1 − Q2 − Q3", parts: [{ label: "FY", v: 5e9, sign: 1, e: "2025-12-31", m: 12 }, { label: "Q1–Q3", v: 3e9, sign: -1, e: "2025-09-30", m: 9 }] } }) }, y: { "2025-12-31": c(5e9) } };
    const gap: PayloadSeries = { ...calc, k: "g", q: Object.fromEntries(Q.slice(0, 3).map((e) => [e, c(1e9)])) };
    expect(checkConsistency(p([bal, calc, gap], Q)).summary).toMatchObject({ years: 0, yearsFailed: 0 });
  });
  it("allows the rounding of figures printed in millions", () => {
    const s: PayloadSeries = { k: "r", cat: "income", met: "revenue", label: "Revenue", parent: null, total: true, unit: "usd", q: Object.fromEntries(Q.map((e) => [e, c(1_234e6)])), y: { "2025-12-31": c(4_938e6) } };
    expect(checkConsistency(p([s], Q)).summary.yearsFailed).toBe(0);
  });
});

describe("calculated values against the figures they were calculated from (review iracc L2)", () => {
  // LKQ FY2025 revenue ($M, EDGAR and LKQ releases): 10-K year 13,651; Q1 first filed 3,463 (recast
  // 3,327 in 2026), Q2 3,642, Q3 3,499. A Q4 calculated as FY − Q1 − Q2 − Q3 from the first-filed
  // quarters is 3,047; the 10-K's own Q4 is 3,312.
  const yq = ["2025-03-31", "2025-06-30", "2025-09-30"];
  const q4 = (q1Shown: number, v = 3_047e6) => {
    const f = { formula: "Full year − Q1 − Q2 − Q3", parts: [{ label: "FY", v: 13_651e6, sign: 1 as const, e: "2025-12-31", m: 12 }, ...yq.map((e, i) => ({ label: `Quarter ending ${e}`, v: [3_463e6, 3_642e6, 3_499e6][i], sign: -1 as const, e, m: 3 }))] };
    const s: PayloadSeries = { k: "r", cat: "segment", met: "revenue", label: "Total revenue", parent: null, total: true, unit: "usd", q: { "2025-03-31": c(q1Shown), "2025-06-30": c(3_642e6), "2025-09-30": c(3_499e6), "2025-12-31": c(v, { f }) }, y: { "2025-12-31": c(13_651e6) } };
    return checkConsistency(p([s], [...yq, "2025-12-31"]));
  };
  it("passes a value whose parts are the figures the line shows", () => {
    const { payload, summary } = q4(3_463e6);
    expect(summary).toMatchObject({ formulas: 1, formulasFailed: 0 });
    expect(payload.series[0].q["2025-12-31"].flags).toBeUndefined();
  });
  it("flags a value calculated from a printing the page no longer shows (Q1 recast)", () => {
    const { payload, summary } = q4(3_327e6);
    expect(summary).toMatchObject({ formulas: 1, formulasFailed: 1 });
    expect(payload.series[0].q["2025-12-31"].flags?.[0]).toMatchObject({ k: "formula", v: 3_183e6 });
    expect(payload.series[0].q["2025-12-31"].flags?.[0].why).toBe("Full year − Q1 − Q2 − Q3: calculated with $3.463B for the period ending 2025-03-31, but this line now shows $3.327B there; with the figures shown it would be $3.183B.");
    // Nothing is corrected.
    expect(payload.series[0].q["2025-12-31"].v).toBe(3_047e6);
  });
  it("does not count a value whose parts are not on the line (a nine-month part) as checked", () => {
    const ytd = c(2e9, { f: { formula: "Full year − nine-month YTD", parts: [{ label: "FY", v: 5e9, sign: 1, e: "2025-12-31", m: 12 }, { label: "Nine months", v: 3e9, sign: -1, e: "2025-09-30", m: 9 }] } });
    const s: PayloadSeries = { k: "r", cat: "income", met: "revenue", label: "Revenue", parent: null, total: true, unit: "usd", q: { "2025-12-31": ytd }, y: { "2025-12-31": c(5e9) } };
    expect(checkConsistency(p([s], ["2025-12-31"])).summary).toMatchObject({ formulas: 0, formulasFailed: 0 });
  });
});

describe("quarters against the year use one filing version (review iracc H2)", () => {
  // LKQ FY2025 revenue ($M, EDGAR): Q1 shows the 2026 recast 3,327 (first filed 3,463), Q2 shows the
  // first-filed 3,642 (recast 3,513 in a 2026 10-Q), Q3 3,499, Q4 3,312; the 10-K year is 13,651.
  // As recast throughout: 3,327 + 3,513 + 3,499 + 3,312 = 13,651, so the year is right.
  it("does not flag a correct year when the shown quarters mix the original and the recast", () => {
    const docs = [
      { id: "a", accn: null, doc: null, kind: null, filed: "2025-04-24" },
      { id: "b", accn: null, doc: null, kind: null, filed: "2025-07-24" },
      { id: "c", accn: null, doc: null, kind: null, filed: "2026-04-23" },
      { id: "d", accn: null, doc: null, kind: null, filed: "2026-07-23" },
    ];
    const q = {
      [Q[0]]: c(3_327e6, { d: 2, alt: { v: 3_463e6, d: 0, kind: "restated" } }),
      [Q[1]]: c(3_642e6, { d: 1, alt: { v: 3_513e6, d: 3, kind: "restated" } }),
      [Q[2]]: c(3_499e6, { d: 2 }),
      [Q[3]]: c(3_312e6, { d: 2 }),
    } as Record<string, PayloadCell>;
    const s: PayloadSeries = { k: "r", cat: "income", met: "revenue", label: "Revenue", parent: null, total: true, unit: "usd", q, y: { [Q[3]]: c(13_651e6, { d: 2 }) } };
    const { payload, summary } = checkConsistency({ ...p([s], Q), docs });
    expect(summary).toMatchObject({ years: 1, yearsFailed: 0 });
    expect(payload.series[0].y[Q[3]].flags).toBeUndefined();
  });
});
