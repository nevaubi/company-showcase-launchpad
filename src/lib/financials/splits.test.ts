import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hydrateDataset } from "./dataset";
import { hasSplitRestatement, isSplitRestated, splitFactors, splitStep } from "./splits";
import type { CompanyDataset, Statement } from "./types";

const load = (t: string) => hydrateDataset(JSON.parse(readFileSync(path.resolve(__dirname, `../../test/fixtures/companies/${t}.json`), "utf8")) as CompanyDataset);
const cells = (st: Statement, key: string) => st.rows.find((r) => r.key === key)!.cells;
const at = (st: Statement, key: string, label: string) => cells(st, key)[st.periods.findIndex((p) => p.label === label)];

describe("splitStep", () => {
  it("reads a round multiple as a split and ignores drift", () => {
    expect(splitStep(2504, 622, 0.04)).toBe(4);
    expect(splitStep(24994, 2490, 0.04)).toBe(10);
    expect(splitStep(2975, 29334, 0.04)).toBeCloseTo(0.1);
    expect(splitStep(1030, 1000, 0.04)).toBe(1);
    expect(splitStep(2450, 1000, 0.04)).toBe(1);
  });
  it("takes 3-for-2 only on a near-exact match, since a 50% issuance looks the same", () => {
    expect(splitStep(1500, 1000, 0.04)).toBe(1.5);
    expect(splitStep(1540, 1000, 0.04)).toBe(1);
  });
  it("lets a factor proven on the quarterly series drift more across a year", () => {
    expect(splitStep(20000, 5252, 0.04)).toBe(1);
    expect(splitStep(20000, 5252, 0.04, [4])).toBe(4);
  });
});

describe("splitFactors", () => {
  it("accumulates splits back through the series", () => {
    expect(splitFactors([600, 610, 2440, 2460, 24700, 24500])).toEqual([40, 40, 10, 10, 1, 1]);
  });
  it("leaves share issuance alone: the weighted count keeps moving after the jump", () => {
    expect(splitFactors([5953, 5968, 12216, 29334, 30000])).toEqual([1, 1, 1, 1, 1]);
  });
  it("carries a period without a count on the next period's basis", () => {
    expect(splitFactors([4601, null, 17818, 17619])).toEqual([4, 1, 1, 1]);
  });
  it("handles one period that a later filing already restated among unrestated ones", () => {
    expect(splitFactors([4532, 17773, 4385, 4324, 17136, 16977])).toEqual([4, 1, 4, 4, 1, 1]);
  });
});

describe("hydrateDataset restates for stock splits", () => {
  const nvda = load("NVDA");
  const aapl = load("AAPL");

  it("puts ten years of NVIDIA EPS on one share basis", () => {
    const a = nvda.statements.annual.income;
    // Filed as 6.63, 1.13 and 0.17 across a 4-for-1 and a 10-for-1 split.
    expect(at(a, "epsDiluted", "FY2019")!.v).toBeCloseTo(0.1658, 3);
    expect(at(a, "epsDiluted", "FY2020")!.v).toBeCloseTo(0.113, 3);
    expect(at(a, "epsDiluted", "FY2023")!.v).toBeCloseTo(0.17, 3);
    expect(at(a, "epsDiluted", "FY2026")!.v).toBeCloseTo(4.9, 2);
    const shares = cells(a, "sharesDiluted").slice(-8).map((c) => c!.v);
    expect(Math.max(...shares) / Math.min(...shares)).toBeLessThan(1.1);
    expect(hasSplitRestatement(a)).toBe(true);
  });

  it("keeps the filed figure as the source of a restated cell", () => {
    const c = at(nvda.statements.annual.income, "epsDiluted", "FY2019")!;
    expect(isSplitRestated(c)).toBe(true);
    expect(c.derived!.formula).toContain("As filed 6.63 ÷ 40");
    expect(c.derived!.parts[0].value).toBe(6.63);
    expect(c.derived!.parts[0].accn).toMatch(/^\d{10}-\d{2}-\d{6}$/);
  });

  it("recomputes EPS growth from the restated row", () => {
    const k = nvda.statements.annual.kpis;
    // 0.17 to 1.19 is about +600%; on the filed figures the split years showed falls of 80% and more.
    expect(at(k, "epsGrowth", "FY2024")!.v).toBeGreaterThan(5);
    expect(at(k, "epsGrowth", "FY2020")!.v).toBeGreaterThan(-0.5);
    expect(at(k, "epsGrowth", "FY2023")!.v).toBeGreaterThan(-0.7);
  });

  it("redoes a derived quarter whose year and quarters sat on different bases", () => {
    const q = nvda.statements.quarterly.income;
    const eps = cells(q, "epsDiluted");
    // The filed mix gave a fourth quarter of about -1.00 in a year that earned 0.17.
    let redone = 0;
    q.periods.forEach((p, i) => {
      if (!eps[i]?.derived?.formula.includes("today's share basis")) return;
      redone++;
      const a = nvda.statements.annual.income;
      const year = cells(a, "epsDiluted")[a.periods.findIndex((y) => y.fy === p.fy)]!;
      const sum = q.periods.reduce((s, x, k) => (x.fy === p.fy ? s + eps[k]!.v : s), 0);
      expect(sum).toBeCloseTo(year.v, 6);
      expect(Math.abs(eps[i]!.v)).toBeLessThan(Math.abs(year.v) + 0.05);
    });
    expect(redone).toBeGreaterThan(0);
  });

  it("restates Apple through its 7-for-1 and 4-for-1 splits", () => {
    const a = aapl.statements.annual.income;
    const eps = cells(a, "epsDiluted").map((c) => c?.v ?? null);
    // Filed: 27.68 (FY2012), then 6.31 and 9.21, then 2.98.
    const raw = JSON.parse(readFileSync(path.resolve(__dirname, "../../test/fixtures/companies/AAPL.json"), "utf8")) as CompanyDataset;
    const filed = cells(raw.statements.annual.income, "epsDiluted").map((c) => c?.v ?? null);
    expect(eps[filed.indexOf(27.68)]).toBeCloseTo(27.68 / 28, 3);
    expect(eps[filed.indexOf(9.21)]).toBeCloseTo(9.21 / 4, 3);
    expect(eps[filed.indexOf(2.98)]).toBe(2.98);
    expect(Math.max(...(eps.filter((v) => v != null) as number[]))).toBeLessThan(8);
    const shares = cells(aapl.statements.quarterly.balance, "sharesOutstanding").filter(Boolean).slice(-40).map((c) => c!.v);
    for (let i = 1; i < shares.length; i++) expect(shares[i] / shares[i - 1]).toBeLessThan(1.3);
  });

  it("changes nothing for companies without a split in the data", () => {
    for (const t of ["MSFT", "JPM", "META", "GS", "BAC", "WFC", "MS"]) {
      const d = load(t);
      for (const f of ["annual", "quarterly"] as const) {
        expect(hasSplitRestatement(d.statements[f].income), `${t} ${f} income`).toBe(false);
        expect(hasSplitRestatement(d.statements[f].balance), `${t} ${f} balance`).toBe(false);
      }
    }
  });
});
