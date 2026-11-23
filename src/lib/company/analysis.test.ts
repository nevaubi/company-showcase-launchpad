import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hydrateDataset } from "@/lib/financials/dataset";
import type { CompanyDataset, Statement } from "@/lib/financials/types";
import { analyze, figTarget, measureOf, vsMedian, vsPrior, type Fig, type FinancialAnalysis } from "./analysis";
import { company, eightQuarters, fill, period, type Lines } from "./fixtures/synthetic";

const load = (t: string) => hydrateDataset(JSON.parse(readFileSync(path.resolve(__dirname, `../../test/fixtures/companies/${t}.json`), "utf8")) as CompanyDataset);
// Firefly Aerospace (FLY, CIK 1860160): losses, a deficit in equity before its 2025 IPO, three fiscal years and several
// lines it does not report. Built on 2026-11-23 from SEC EDGAR (companyfacts and the submissions index) with this
// repo's statement builder (buildStatements), not by hand; segments are left empty.
const fly = () => hydrateDataset(JSON.parse(readFileSync(path.resolve(__dirname, "fixtures/FLY.json"), "utf8")) as CompanyDataset);
const FIXTURES = ["AAPL", "NVDA", "MSFT", "GOOGL", "META", "JPM", "BAC", "C", "GS", "MS", "WFC"];

const M = 1e6;
const now = (a: FinancialAnalysis, key: string) => measureOf(a, key)?.now?.v;
const prior = (a: FinancialAnalysis, key: string) => measureOf(a, key)?.prior?.v;
const fy = (a: FinancialAnalysis, key: string) => measureOf(a, key)?.history.at(-1)?.fig?.v;
const keyFig = (a: FinancialAnalysis, key: string) => a.keyFigures.find((k) => k.key === key);

/** Every figure an analysis holds. */
function figures(a: FinancialAnalysis): { where: string; fig: Fig }[] {
  const out: { where: string; fig: Fig }[] = [];
  const add = (where: string, fig: Fig | null | undefined) => {
    if (fig) out.push({ where, fig });
  };
  for (const k of a.keyFigures) {
    add(`${k.key}.now`, k.now);
    add(`${k.key}.prior`, k.prior);
  }
  for (const g of a.groups)
    for (const m of g.measures) {
      add(`${m.key}.now`, m.now);
      add(`${m.key}.prior`, m.prior);
      for (const h of m.history) add(`${m.key}.${h.label}`, h.fig);
    }
  if (a.dupont) for (const k of ["netMargin", "assetTurnover", "leverage", "roe"] as const) add(`dupont.${k}`, a.dupont[k]);
  for (const [k, f] of Object.entries(a.facts)) add(`facts.${k}`, f);
  return out;
}

describe("analyze: checked by hand against the filings", () => {
  // Inputs are the dollar figures (in millions) printed in the filings named in each test; the arithmetic is redone here.
  it("AAPL (fiscal year ends in September): trailing twelve months to Q3 FY26", () => {
    const a = analyze(load("AAPL"));
    expect(a).toMatchObject({ ticker: "AAPL", kind: "company", basis: "ttm", current: "TTM to Q3 FY26" });
    expect(a.quarter).toMatchObject({ label: "Q3 FY26", end: "2026-06-27" });
    expect(a.fiscalYear).toMatchObject({ label: "FY2025", end: "2025-09-27" });
    // 10-K FY2025 (0000320193-25-000079) + nine months of the Q3 FY26 10-Q (0000320193-26-000020) − the nine months a year earlier
    const revenue = 416_161 + 364_357 - 313_695;
    const operatingIncome = 133_050 + 122_432 - 100_623;
    const netIncome = 112_010 + 101_464 - 84_544;
    const cfo = 111_482 + 116_996 - 81_754;
    const capex = 12_715 + 6_799 - 9_473;
    expect(keyFig(a, "revenue")?.now?.v).toBe(revenue * M);
    expect(keyFig(a, "revenue")?.prior?.v).toBe((391_035 + 313_695 - 296_105) * M);
    expect(keyFig(a, "operatingIncome")?.now?.v).toBe(operatingIncome * M);
    expect(keyFig(a, "netIncome")?.now?.v).toBe(netIncome * M);
    expect(keyFig(a, "fcf")?.now?.v).toBe((cfo - capex) * M);
    // balance sheet at 27 June 2026: commercial paper + current and non-current term debt − cash − current marketable securities
    const debt = 1_997 + 11_007 + 71_340;
    expect(keyFig(a, "netDebt")?.now?.v).toBe((debt - 39_544 - 22_855) * M);
    expect(keyFig(a, "netDebt")?.now?.period).toBe("Q3 FY26");

    expect(now(a, "revenueGrowth")).toBeCloseTo(revenue / (391_035 + 313_695 - 296_105) - 1, 10);
    expect(now(a, "revenueYoY")).toBeCloseTo(109_417 / 94_036 - 1, 10);
    expect(now(a, "revenueSeq")).toBeCloseTo(109_417 / 111_184 - 1, 10); // Q2 FY26 from its own 10-Q (0000320193-26-000013)
    expect(now(a, "revenueCagr3")).toBeCloseTo((416_161 / 394_328) ** (1 / 3) - 1, 10);
    expect(now(a, "revenueCagr5")).toBeCloseTo((416_161 / 274_515) ** (1 / 5) - 1, 10);
    expect(measureOf(a, "revenueCagr3")?.now?.period).toBe("FY2025");

    expect(now(a, "grossMargin")).toBeCloseTo((195_201 + 178_782 - 146_860) / revenue, 10);
    expect(now(a, "operatingMargin")).toBeCloseTo(operatingIncome / revenue, 10);
    expect(now(a, "netMargin")).toBeCloseTo(netIncome / revenue, 10);
    expect(now(a, "fcfMargin")).toBeCloseTo((cfo - capex) / revenue, 10);
    // equity and assets at 27 June 2026 and at 28 June 2025 (10-Q 0000320193-25-000073)
    expect(now(a, "roe")).toBeCloseTo(netIncome / ((107_520 + 65_830) / 2), 10);
    expect(now(a, "roa")).toBeCloseTo(netIncome / ((383_266 + 331_495) / 2), 10);
    const taxRate = (20_719 + 21_638 - 15_381) / (132_729 + 123_102 - 99_925);
    const debtYearAgo = 9_923 + 9_345 + 82_430;
    expect(now(a, "roic")).toBeCloseTo((operatingIncome * (1 - taxRate)) / ((debt + 107_520 + debtYearAgo + 65_830) / 2), 10);
    expect(now(a, "netDebtToEbitda")).toBeCloseTo((debt - 39_544 - 22_855) / (operatingIncome + 11_698 + 9_973 - 8_571), 10);
    expect(now(a, "debtToEquity")).toBeCloseTo(debt / 107_520, 10);
    expect(now(a, "currentRatio")).toBeCloseTo(149_818 / 149_326, 10);
    expect(now(a, "quickRatio")).toBeCloseTo((39_544 + 22_855 + 31_398) / 149_326, 10);
    expect(now(a, "fcfConversion")).toBeCloseTo((cfo - capex) / netIncome, 10);
    expect(now(a, "accruals")).toBeCloseTo((netIncome - cfo) / ((383_266 + 331_495) / 2), 10);
    expect(now(a, "capexIntensity")).toBeCloseTo(capex / revenue, 10);
    expect(now(a, "sbcIntensity")).toBeCloseTo((12_863 + 10_523 - 9_680) / revenue, 10);
    expect(now(a, "dso")).toBeCloseTo((31_398 / revenue) * 365, 8);
    expect(now(a, "inventoryDays")).toBeCloseTo((11_092 / (220_960 + 185_575 - 166_835)) * 365, 8);
    expect(now(a, "receivablesGrowth")).toBeCloseTo(31_398 / 27_557 - 1, 10);
    expect(now(a, "inventoryGrowth")).toBeCloseTo(11_092 / 5_925 - 1, 10);
    expect(now(a, "fcfPerShare")).toBeCloseTo(((cfo - capex) * M) / 14_714_676_000, 8);
    expect(now(a, "bookPerShare")).toBeCloseTo((107_520 * M) / 14_608_963_000, 8);
    expect(now(a, "dividendPerShare")).toBeCloseTo(1.02 + 0.79 - 0.76, 10);
    expect(now(a, "shareChange")).toBeCloseTo(14_714_676 / 14_948_179 - 1, 10);
    expect(now(a, "buybacks")).toBe((90_711 + 62_094 - 70_579) * M);
    expect(now(a, "dividends")).toBe((15_421 + 11_778 - 11_559) * M);
    expect(now(a, "payout")).toBeCloseTo((15_421 + 11_778 - 11_559) / netIncome, 10);
    expect(now(a, "returnedToFcf")).toBeCloseTo((90_711 + 62_094 - 70_579 + 15_421 + 11_778 - 11_559) / (cfo - capex), 10);
    // EPS is filed to the cent: four quarters added give 8.71, the fiscal year plus the nine months less the nine months 8.72
    expect(now(a, "eps")).toBeCloseTo(8.71, 2);
    // interest expense is not on the face of Apple's income statement since FY2024
    expect(now(a, "interestCover")).toBeUndefined();
    expect(measureOf(a, "interestCover")?.note).toMatch(/not reported/);

    // the latest fiscal year, from the 10-K alone
    expect(fy(a, "grossMargin")).toBeCloseTo(195_201 / 416_161, 10);
    expect(fy(a, "roe")).toBeCloseTo(112_010 / ((73_733 + 56_950) / 2), 10);
    expect(fy(a, "roa")).toBeCloseTo(112_010 / ((359_241 + 364_980) / 2), 10);
    expect(fy(a, "revenueGrowth")).toBeCloseTo(416_161 / 391_035 - 1, 10);
    expect(fy(a, "eps")).toBe(7.46);
    expect(fy(a, "dividendPerShare")).toBe(1.02);
    expect(measureOf(a, "grossMargin")?.history.map((h) => h.label)).toEqual(["FY2020", "FY2021", "FY2022", "FY2023", "FY2024", "FY2025"]);
    expect(measureOf(a, "grossMargin")?.median).toMatchObject({ n: 5, from: "FY2021", to: "FY2025" });

    expect(a.dupont).not.toBeNull();
    const dp = a.dupont!;
    expect(dp.netMargin.v * dp.assetTurnover.v * dp.leverage.v).toBeCloseTo(dp.roe.v, 10);
    expect(dp.roe.v).toBeCloseTo(now(a, "roe")!, 12);
    expect(keyFig(a, "revenue")?.run).toHaveLength(8);
    expect(keyFig(a, "revenue")?.run.at(-1)).toBe(revenue * M);
  });

  it("NVDA (fiscal year ends in January): trailing twelve months to Q2 FY27", () => {
    const a = analyze(load("NVDA"));
    expect(a).toMatchObject({ kind: "company", basis: "ttm", current: "TTM to Q2 FY27" });
    expect(a.quarter).toMatchObject({ label: "Q2 FY27", end: "2026-07-26" });
    expect(a.fiscalYear).toMatchObject({ label: "FY2026", end: "2026-01-25" });
    // 10-K FY2026 (0001045810-26-000021) + six months of the Q2 FY27 10-Q (0001045810-26-000075) − the six months a year earlier
    // = 302,970; the four filed quarters add to 302,969 (each is rounded to the million)
    expect(Math.abs(keyFig(a, "revenue")!.now!.v - (215_938 + 177_837 - 90_805) * M)).toBeLessThanOrEqual(1 * M);
    expect(now(a, "revenueYoY")).toBeCloseTo(96_221 / 46_743 - 1, 10);
    expect(now(a, "debtToEquity")).toBeCloseTo((1_000 + 32_366) / 228_984, 10);
    expect(now(a, "currentRatio")).toBeCloseTo(197_412 / 43_019, 10);
    expect(now(a, "dso")).toBeCloseTo((63_059 * M * 365) / keyFig(a, "revenue")!.now!.v, 8);
    expect(now(a, "receivablesGrowth")).toBeCloseTo(63_059 / 27_808 - 1, 10);
    expect(now(a, "shareChange")).toBeCloseTo(24_285 / 24_532 - 1, 10);
    expect(fy(a, "operatingMargin")).toBeCloseTo(130_387 / 215_938, 10);
    expect(fy(a, "netMargin")).toBeCloseTo(120_067 / 215_938, 10);
    expect(fy(a, "interestCover")).toBeCloseTo(130_387 / 259, 8);
    expect(fy(a, "debtToEquity")).toBeCloseTo((999 + 7_469) / 157_293, 10);
    expect(fy(a, "eps")).toBe(4.9);
    expect(measureOf(a, "revenueCagr3")?.now?.period).toBe("FY2026");
    expect(now(a, "revenueCagr3")).toBeCloseTo((215_938 / 26_974) ** (1 / 3) - 1, 10);
  });

  it("NVDA: the balance sheet no longer carries short-term investments in the statements, so what nets them is withheld", () => {
    const a = analyze(load("NVDA"));
    // NVIDIA's balance sheet shows $34,143M of marketable debt securities at 26 July 2026 under a tag the statements do not
    // map: net debt computed without them would read as $10.9B of debt on a company with $66B more cash than debt
    for (const key of ["netDebtToEbitda", "quickRatio"]) {
      expect(now(a, key)).toBeUndefined();
      expect(measureOf(a, key)?.note).toMatch(/short-term investments are missing/);
    }
    expect(keyFig(a, "netDebt")).toBeUndefined();
    expect(a.facts.liquid).toBeNull();
    // a year earlier the line was there, and the figure with it
    expect(prior(a, "quickRatio")).toBeCloseTo((11_639 + 45_152 + 27_808) / 24_257, 10);
    expect(fy(a, "netDebtToEbitda")).toBeUndefined();
  });

  it("JPM (a bank): bank measures, no margins or cash conversion", () => {
    const a = analyze(load("JPM"));
    expect(a).toMatchObject({ kind: "bank", basis: "ttm", current: "TTM to Q2 FY26" });
    expect(a.groups.map((g) => g.id)).toEqual(["growth", "bankProfit", "returns", "bankBalance", "perShare", "capital"]);
    for (const key of ["grossMargin", "fcfMargin", "fcfGrowth", "roic", "currentRatio", "fcfConversion", "fcfPerShare", "returnedToFcf", "netDebtToEbitda"]) expect(measureOf(a, key)).toBeNull();
    expect(a.keyFigures.map((k) => k.key)).toEqual(["revenue", "netInterestIncome", "netIncome", "deposits", "loans"]);
    // 10-K 2025 (0001628280-26-008131) + six months of the Q2 2026 10-Q (0001628280-26-054343) − the six months a year earlier
    const revenue = 182_447 + 107_183 - 90_222;
    const netIncome = 57_048 + 37_649 - 29_630;
    expect(keyFig(a, "revenue")?.now?.v).toBe(revenue * M);
    expect(keyFig(a, "netInterestIncome")?.now?.v).toBe((95_443 + 50_877 - 46_482) * M);
    expect(keyFig(a, "netIncome")?.now?.v).toBe(netIncome * M);
    expect(keyFig(a, "deposits")?.now?.v).toBe(2_713_700 * M);
    expect(keyFig(a, "loans")?.now).toMatchObject({ v: 1_516_310 * M, period: "Q2 FY26" });
    expect(now(a, "efficiency")).toBeCloseTo((95_640 + 54_166 - 47_376) / revenue, 10);
    expect(now(a, "niiShare")).toBeCloseTo((95_443 + 50_877 - 46_482) / revenue, 10);
    expect(now(a, "provisionToRevenue")).toBeCloseTo((14_212 + 5_022 - 6_154) / revenue, 10);
    expect(now(a, "roe")).toBeCloseTo(netIncome / ((374_598 + 356_924) / 2), 10);
    expect(now(a, "roa")).toBeCloseTo(netIncome / ((5_015_069 + 4_552_482) / 2), 10);
    expect(now(a, "loansToDeposits")).toBeCloseTo(1_516_310 / 2_713_700, 10);
    expect(now(a, "equityToAssets")).toBeCloseTo(374_598 / 5_015_069, 10);
    expect(now(a, "dividendPerShare")).toBeCloseTo(5.8 + 3.0 - 2.8, 10);
    expect(now(a, "totalPayout")).toBeCloseTo((31_591 + 15_113 - 15_034 + 16_625 + 8_716 - 8_028) / netIncome, 10);
    expect(fy(a, "efficiency")).toBeCloseTo(95_640 / 182_447, 10);
    expect(fy(a, "roe")).toBeCloseTo(57_048 / ((362_438 + 344_758) / 2), 10);
    expect(measureOf(a, "roe")?.now?.formula).toMatch(/preferred stock/);
  });

  it("tangible equity nets other intangible assets only when every balance date has them", () => {
    // JPMorgan stops tagging its other intangible assets in 2026: goodwill only, at every date, and the formula says so
    const jpm = analyze(load("JPM"));
    expect(now(jpm, "rote")).toBeCloseTo((57_048 + 37_649 - 29_630) / ((374_598 - 52_711 + 356_924 - 52_747) / 2), 10);
    expect(fy(jpm, "rote")).toBeCloseTo(57_048 / ((362_438 - 52_731 + 344_758 - 52_565) / 2), 10);
    expect(measureOf(jpm, "rote")?.now?.formula).toMatch(/not netted/);
    expect(measureOf(jpm, "rote")?.now?.parts.some((p) => /Intangible/.test(p.label))).toBe(false);
    expect(now(jpm, "tangibleToAssets")).toBeCloseTo((374_598 - 52_711) / 5_015_069, 10);
    // Bank of America reports them every period: netted, with the line among the parts
    const bac = analyze(load("BAC"));
    expect(measureOf(bac, "rote")?.now?.formula).toMatch(/− goodwill − intangible assets/);
    expect(measureOf(bac, "rote")?.now?.parts.some((p) => /Intangible/.test(p.label))).toBe(true);
    expect(now(bac, "rote")!).toBeGreaterThan(now(bac, "roe")!);
  });
});

describe("analyze: a company with losses, a short history and missing lines (FLY)", () => {
  const a = analyze(fly());
  it("uses the trailing twelve months and keeps three fiscal years", () => {
    expect(a).toMatchObject({ kind: "company", basis: "ttm", current: "TTM to Q3 FY26" });
    expect(measureOf(a, "operatingMargin")?.history.map((h) => h.label)).toEqual(["FY2023", "FY2024", "FY2025"]);
    expect(measureOf(a, "operatingMargin")?.median).toMatchObject({ n: 3 });
    expect(measureOf(a, "revenueCagr3")).toBeNull(); // three fiscal years cannot span three years of growth
  });
  it("reports the loss and the burn, and withholds what a loss makes meaningless", () => {
    expect(keyFig(a, "netIncome")!.now!.v).toBeLessThan(0);
    expect(keyFig(a, "fcf")!.now!.v).toBeLessThan(0);
    expect(now(a, "operatingMargin")!).toBeLessThan(0);
    expect(now(a, "cashRunway")!).toBeGreaterThan(0);
    expect(now(a, "cashRunway")).toBeCloseTo(a.facts.liquid!.v / (-keyFig(a, "fcf")!.now!.v / 4), 8);
    for (const key of ["fcfConversion", "payout", "returnedToFcf", "interestCover", "netDebtToEbitda"]) expect(now(a, key)).toBeUndefined();
    expect(measureOf(a, "interestCover")?.note).toBe("operating income is negative");
    expect(measureOf(a, "netDebtToEbitda")?.note).toBe("EBITDA is negative");
  });
  it("withholds return on equity across a deficit and EPS across the IPO", () => {
    expect(now(a, "roe")).toBeUndefined();
    expect(measureOf(a, "roe")?.note).toMatch(/equity was negative/);
    expect(a.dupont).toBeNull();
    expect(now(a, "eps")).toBeUndefined();
    expect(measureOf(a, "eps")?.note).toMatch(/do not add up/);
    expect(now(a, "shareChange")!).toBeGreaterThan(0.5);
  });
  it("drops measures the company has no lines for", () => {
    for (const key of ["dividendPerShare", "dividends", "buybacks"]) expect(measureOf(a, key)).toBeNull();
  });
});

describe("analyze: gaps and missing lines", () => {
  it("returns an empty analysis for a company with no statements", () => {
    const a = analyze(company({}));
    expect(a).toMatchObject({ basis: "fy", current: null, quarter: null, fiscalYear: null, keyFigures: [], groups: [], dupont: null });
  });

  it("uses the trailing twelve months only when four consecutive quarters exist", () => {
    const years = [period(2023), period(2024), period(2025)];
    const annual = { income: { revenue: [300, 400, 500], netIncome: [30, 40, 50] } };
    const full = analyze(company({ quarters: eightQuarters, years, q: { income: { revenue: [90, 95, 100, 115, 110, 120, 130, 140], netIncome: fill(10) } }, a: annual }));
    expect(full).toMatchObject({ basis: "ttm", current: "TTM to Q4 FY25" });
    expect(keyFig(full, "revenue")?.now?.v).toBe(500);
    expect(keyFig(full, "revenue")?.prior?.v).toBe(400);
    expect(now(full, "revenueGrowth")).toBeCloseTo(0.25, 12);
    expect(now(full, "revenueSeq")).toBeCloseTo(140 / 130 - 1, 12);
    // a missing quarter breaks the run: fall back to the fiscal year and say so
    const gap = [period(2024, 4), period(2025, 1), period(2025, 3), period(2025, 4)];
    const broken = analyze(company({ quarters: gap, years, q: { income: { revenue: [115, 110, 130, 140], netIncome: fill(10, 4) } }, a: annual }));
    expect(broken).toMatchObject({ basis: "fy", current: "FY2025" });
    expect(keyFig(broken, "revenue")?.now).toMatchObject({ v: 500, period: "FY2025" });
    expect(now(broken, "revenueSeq")).toBeCloseTo(140 / 130 - 1, 12); // the last two quarters still follow each other
    expect(now(broken, "revenueYoY")).toBeCloseTo(140 / 115 - 1, 12);
    // fewer than four quarters
    const short = analyze(company({ quarters: gap.slice(2), years, q: { income: { revenue: [130, 140], netIncome: [10, 10] } }, a: annual }));
    expect(short.basis).toBe("fy");
  });

  it("keeps only the measures whose lines exist", () => {
    const a = analyze(company({ quarters: eightQuarters, q: { income: { revenue: fill(100), netIncome: fill(10) } } }));
    expect(a.groups.map((g) => g.id)).toEqual(["growth", "margins"]);
    expect(a.groups[1].measures.map((m) => m.key)).toEqual(["netMargin"]);
    expect(now(a, "netMargin")).toBeCloseTo(0.1, 12);
    expect(a.keyFigures.map((k) => k.key)).toEqual(["revenue", "netIncome"]);
    expect(a.dupont).toBeNull();
  });

  it("says why interest cover is missing", () => {
    const base = { revenue: fill(100), operatingIncome: fill(20), netIncome: fill(10) };
    const none = analyze(company({ quarters: eightQuarters, q: { income: base } }));
    expect(measureOf(none, "interestCover")).toMatchObject({ now: null, note: "interest expense is not reported as its own line" });
    const loss = analyze(company({ quarters: eightQuarters, q: { income: { ...base, operatingIncome: fill(-5), interestExpense: fill(2) } } }));
    expect(measureOf(loss, "interestCover")).toMatchObject({ now: null, note: "operating income is negative" });
    const ok = analyze(company({ quarters: eightQuarters, q: { income: { ...base, interestExpense: fill(2) } } }));
    expect(now(ok, "interestCover")).toBeCloseTo(10, 12);
    expect(measureOf(ok, "interestCover")?.note).toBeUndefined();
  });

  it("withholds net debt, the quick ratio and cash runway when short-term investments vanish from the balance sheet", () => {
    const income = { revenue: fill(100), netIncome: fill(-10), operatingIncome: fill(-8), ebitda: fill(5) };
    const balance = (sti: (number | null)[]): Lines => ({ cash: fill(50), shortTermInvestments: sti, receivables: fill(20), currentLiabilities: fill(40), totalDebt: fill(30), netDebt: sti.map((s) => 30 - 50 - (s ?? 0)) });
    const cashflow = { fcf: fill(-12) };
    const present = analyze(company({ quarters: eightQuarters, q: { income, balance: balance(fill(25)), cashflow } }));
    expect(keyFig(present, "netDebt")?.now?.v).toBe(-45);
    expect(now(present, "quickRatio")).toBeCloseTo(95 / 40, 12);
    expect(now(present, "cashRunway")).toBeCloseTo(75 / 12, 12);
    const vanished = analyze(company({ quarters: eightQuarters, q: { income, balance: balance([25, 25, 25, 25, 25, 25, null, null]), cashflow } }));
    expect(keyFig(vanished, "netDebt")).toBeUndefined();
    expect(measureOf(vanished, "quickRatio")).toMatchObject({ now: null, note: "short-term investments are missing from this period's balance sheet in the statements" });
    expect(measureOf(vanished, "netDebtToEbitda")?.note).toMatch(/short-term investments are missing/);
    expect(now(vanished, "cashRunway")).toBeUndefined();
    expect(vanished.facts.liquid).toBeNull();
    // a company that never reported the line simply has none: cash alone counts
    const never = analyze(company({ quarters: eightQuarters, q: { income, balance: balance(fill(0).map(() => null)), cashflow } }));
    expect(now(never, "quickRatio")).toBeCloseTo(70 / 40, 12);
    expect(now(never, "cashRunway")).toBeCloseTo(50 / 12, 12);
  });

  it("needs positive equity at both ends for return on equity", () => {
    const income = { revenue: fill(100), netIncome: fill(10) };
    const withEquity = (equity: number[]) => analyze(company({ quarters: eightQuarters, q: { income, balance: { equity, totalAssets: fill(400) } } }));
    expect(now(withEquity(fill(200)), "roe")).toBeCloseTo(40 / 200, 12);
    const deficit = withEquity([200, 200, 200, -50, 200, 200, 200, 300]);
    expect(measureOf(deficit, "roe")).toMatchObject({ now: null, note: "shareholders' equity was negative at the start or end of the period" });
    expect(deficit.dupont).toBeNull();
    expect(now(deficit, "roa")).toBeCloseTo(40 / 400, 12);
  });

  it("holds the tax rate between 0 and 50% in return on invested capital", () => {
    const roicWith = (tax: number) =>
      now(
        analyze(company({ quarters: eightQuarters, q: { income: { revenue: fill(100), operatingIncome: fill(25), incomeTax: fill(tax), pretaxIncome: fill(20), netIncome: fill(10) }, balance: { totalDebt: fill(100), equity: fill(300) } } })),
        "roic",
      );
    expect(roicWith(4)).toBeCloseTo((100 * 0.8) / 400, 12);
    expect(roicWith(15)).toBeCloseTo((100 * 0.5) / 400, 12);
    expect(roicWith(-3)).toBeCloseTo(100 / 400, 12);
  });

  it("drops EPS over twelve months when it disagrees in sign with net income or the share count moved a lot", () => {
    const income = (eps: number[], shares: number[]) => ({ revenue: fill(100), netIncome: fill(10), epsDiluted: eps, sharesDiluted: shares });
    const ok = analyze(company({ quarters: eightQuarters, q: { income: income(fill(0.5), fill(20)) } }));
    expect(now(ok, "eps")).toBeCloseTo(2, 12);
    const sign = analyze(company({ quarters: eightQuarters, q: { income: income(fill(-0.5), fill(20)) } }));
    expect(measureOf(sign, "eps")).toMatchObject({ now: null });
    const ipo = analyze(company({ quarters: eightQuarters, q: { income: income(fill(0.5), [20, 20, 20, 20, 20, 20, 20, 60]) } }));
    expect(measureOf(ipo, "eps")?.now).toBeNull();
    expect(measureOf(ipo, "eps")?.note).toMatch(/do not add up/);
  });

  it("takes the median over the newest five fiscal years and needs three", () => {
    const years = [2019, 2020, 2021, 2022, 2023, 2024, 2025].map((y) => period(y));
    const a = analyze(company({ years, a: { income: { revenue: fill(100, 7), netIncome: [1, 2, 30, 4, 50, 6, 7] } } }));
    const m = measureOf(a, "netMargin")!;
    expect(m.history.map((h) => h.label)).toEqual(["FY2020", "FY2021", "FY2022", "FY2023", "FY2024", "FY2025"]);
    expect(m.median).toEqual({ v: 0.07, n: 5, from: "FY2021", to: "FY2025" });
    expect(vsMedian(m)).toBeCloseTo(0, 12);
    expect(vsPrior(m)).toBeCloseTo(0.01, 12);
    const two = analyze(company({ years: years.slice(-2), a: { income: { revenue: [100, 100], netIncome: [6, 7] } } }));
    expect(measureOf(two, "netMargin")?.median).toBeNull();
  });

  it("gives a bank its own measures by industry", () => {
    const a = analyze(company({ industry: "Banks - Regional", quarters: eightQuarters, q: { income: { revenue: fill(100), netInterestIncome: fill(60), nonInterestExpense: fill(55), netIncome: fill(20) }, balance: { loans: fill(800), deposits: fill(1000), equity: fill(100), totalAssets: fill(1200) } } }));
    expect(a.kind).toBe("bank");
    expect(now(a, "efficiency")).toBeCloseTo(0.55, 12);
    expect(now(a, "loansToDeposits")).toBeCloseTo(0.8, 12);
    expect(measureOf(a, "grossMargin")).toBeNull();
  });
});

describe("analyze: every figure opens a source", () => {
  const all: [string, () => CompanyDataset][] = [...FIXTURES.map((t): [string, () => CompanyDataset] => [t, () => load(t)]), ["FLY", fly]];
  for (const [t, get] of all)
    it(`${t}: finite values, a period, a formula and filed parts on every figure`, () => {
      const d = get();
      // the analysis reads the balance sheet and cash flow by the income statement's period index
      for (const side of [d.statements.annual, d.statements.quarterly]) {
        const keys = (st: Statement) => st.periods.map((p) => p.key).join();
        expect(keys(side.balance)).toBe(keys(side.income));
        expect(keys(side.cashflow)).toBe(keys(side.income));
      }
      const a = analyze(d);
      const figs = figures(a);
      expect(figs.length).toBeGreaterThan(40);
      for (const { where, fig } of figs) {
        expect(Number.isFinite(fig.v), where).toBe(true);
        expect(fig.period, where).not.toBe("");
        expect(fig.formula, where).not.toBe("");
        expect(fig.parts.length, where).toBeGreaterThan(0);
        for (const p of fig.parts) {
          expect(p.accn, where).toMatch(/^\d{10}-\d{2}-\d{6}$/);
          expect(p.concept, where).toMatch(/:/);
          expect(p.end, where).toMatch(/^\d{4}-\d{2}-\d{2}$/);
          expect(Number.isFinite(p.value), where).toBe(true);
          expect(p.label, where).not.toBe("");
        }
        const target = figTarget(a.ticker, where, fig, "pct");
        expect(target.ticker).toBe(t);
        expect(target.periodLabel).toBe(fig.period);
        if (target.src) expect(target.src.value).toBe(fig.v);
        else expect(target.derived?.parts.length).toBeGreaterThan(0);
      }
      // the current figure and the same figure a year earlier never cover the same period
      for (const g of a.groups) for (const m of g.measures) if (m.now && m.prior) expect(m.prior.period, m.key).not.toBe(m.now.period);
    });

  it("opens a single filed number as that number, and a calculation with its parts", () => {
    const a = analyze(load("AAPL"));
    const filed = measureOf(a, "eps")!.history.at(-1)!.fig!;
    expect(figTarget("AAPL", "Diluted EPS", filed, "perShare")).toMatchObject({ unit: "usdPerShare", value: 7.46, periodLabel: "FY2025", src: { concept: "us-gaap:EarningsPerShareDiluted", value: 7.46 } });
    const computed = figTarget("AAPL", "Return on equity", measureOf(a, "roe")!.now!, "pct");
    expect(computed.src).toBeUndefined();
    expect(computed.derived?.formula).toMatch(/average shareholders' equity/);
    // four quarters of net income, and equity at both ends
    expect(computed.derived?.parts.map((p) => p.label)).toEqual(expect.arrayContaining(["Net income · Q3 FY26", "Shareholders' equity · Q3 FY26", "Shareholders' equity · Q3 FY25"]));
    expect(figTarget("AAPL", "Net debt to EBITDA", measureOf(a, "netDebtToEbitda")!.now!, "x").unit).toBe("ratio");
  });
});

describe("analyze: agrees with the statements' own annual ratios", () => {
  for (const t of FIXTURES)
    it(`${t}: latest fiscal year`, () => {
      const d = load(t);
      const a = analyze(d);
      const kpis = d.statements.annual.kpis;
      const i = kpis.periods.findIndex((p) => p.label === a.fiscalYear?.label);
      expect(i).toBeGreaterThanOrEqual(0);
      const kpi = (key: string) => kpis.rows.find((r) => r.key === key)?.cells[i]?.v;
      const pairs: [string, string][] = [
        ["grossMargin", "grossMargin"],
        ["operatingMargin", "operatingMargin"],
        ["netMargin", "netMargin"],
        ["fcfMargin", "fcfMargin"],
        ["roe", "roe"],
        ["roa", "roa"],
        ["roic", "roic"],
        ["revenueGrowth", "revenueGrowth"],
        ["efficiency", "efficiencyRatio"],
        ["loansToDeposits", "loansToDeposits"],
        ["equityToAssets", "equityToAssets"],
        ["currentRatio", "currentRatio"],
        ["capexIntensity", "capexIntensity"],
      ];
      let compared = 0;
      for (const [mine, theirs] of pairs) {
        const x = fy(a, mine);
        const y = kpi(theirs);
        if (x == null || y == null) continue;
        expect(x, `${t} ${mine}`).toBeCloseTo(y, 9);
        compared++;
      }
      expect(compared).toBeGreaterThanOrEqual(5);
    });
});
