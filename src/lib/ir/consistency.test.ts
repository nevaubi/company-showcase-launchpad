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

describe("calculated values against their formula", () => {
  it("passes a correct formula and flags a wrong one", () => {
    const good = c(2e9, { f: { formula: "Full year − Q1 − Q2 − Q3", parts: [{ label: "FY", v: 5e9, sign: 1, e: "x", m: 12 }, { label: "Q1–Q3", v: 3e9, sign: -1, e: "y", m: 9 }] } });
    const bad = c(2.5e9, { f: { formula: "Full year − Q1 − Q2 − Q3", parts: [{ label: "FY", v: 5e9, sign: 1, e: "x", m: 12 }, { label: "Q1–Q3", v: 3e9, sign: -1, e: "y", m: 9 }] } });
    const s: PayloadSeries = { k: "r", cat: "income", met: "revenue", label: "Revenue", parent: null, total: true, unit: "usd", q: { "2025-12-31": good, "2024-12-31": bad }, y: {} };
    const { payload, summary } = checkConsistency(p([s], ["2024-12-31", "2025-12-31"]));
    expect(summary).toMatchObject({ formulas: 2, formulasFailed: 1 });
    expect(payload.series[0].q["2024-12-31"].flags?.[0].why).toBe("Full year − Q1 − Q2 − Q3: $5.000B − $3.000B = $2.000B, but the cell shows $2.500B.");
    expect(payload.series[0].q["2025-12-31"].flags).toBeUndefined();
  });
});
