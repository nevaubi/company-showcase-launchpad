import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hydrateDataset } from "@/lib/financials/dataset";
import type { CompanyDataset } from "@/lib/financials/types";
import { analyze } from "./analysis";
import { company, eightQuarters, fill, period, step, type Lines } from "./fixtures/synthetic";
import { financialRead, fmtFig, READ_RULES, readText, type FinancialRead } from "./read";

const load = (t: string) => hydrateDataset(JSON.parse(readFileSync(path.resolve(__dirname, `../../test/fixtures/companies/${t}.json`), "utf8")) as CompanyDataset);
const fly = () => hydrateDataset(JSON.parse(readFileSync(path.resolve(__dirname, "fixtures/FLY.json"), "utf8")) as CompanyDataset);
const read = (d: CompanyDataset) => financialRead(analyze(d));
const ids = (r: FinancialRead) => ({ strengths: r.strengths.map((x) => x.id), concerns: r.concerns.map((x) => x.id) });
const sentence = (r: FinancialRead, id: string) => {
  const item = [...r.strengths, ...r.concerns].find((x) => x.id === id);
  return item ? readText(item) : undefined;
};

describe("financialRead: real companies", () => {
  it("AAPL: strengths and concerns side by side, each showing its numbers", () => {
    const r = read(load("AAPL"));
    expect(r.span).toBe("TTM to Q3 FY26");
    expect(ids(r)).toEqual({ strengths: ["roic", "growth", "profitLead", "marginUp"], concerns: ["inventory", "roeLeverage"] });
    expect(sentence(r, "growth")).toBe("Revenue grew 14.2% over the trailing twelve months, against 6.0% a year earlier.");
    expect(sentence(r, "marginUp")).toBe("Operating margin widened to 33.2% from 31.9% a year earlier; the five-year median is 30.3%.");
    expect(sentence(r, "inventory")).toBe("Inventories grew 87.2% over a year while revenue grew 14.2%.");
    expect(sentence(r, "roeLeverage")).toBe("Return on equity of 148.8% rests on a thin equity base: assets are 4.1× equity.");
  });

  it("NVDA: profit running ahead of cash and working capital growing faster than revenue are flagged", () => {
    const r = read(load("NVDA"));
    expect(ids(r).concerns).toEqual(["accruals", "conversionWeak", "receivables", "inventory"]);
    expect(sentence(r, "receivables")).toBe("Receivables grew 126.8% over a year while revenue grew 83.4%; days sales outstanding went from 61 days to 76 days.");
    expect(sentence(r, "conversionWeak")).toBe("Free cash flow was only 65.8% of net income.");
  });

  it("JPM: a bank is read with bank rules", () => {
    const r = read(load("JPM"));
    expect(ids(r)).toEqual({ strengths: ["growth", "efficiency", "accelerating", "roe"], concerns: [] });
    expect(sentence(r, "efficiency")).toBe("The efficiency ratio improved to 51.4% from 52.8% a year earlier (expenses took a smaller share of revenue).");
    expect(sentence(r, "roe")).toBe("Return on equity is 17.8%, and 20.8% on tangible equity; the five-year median is 16.1%.");
    for (const bank of ["BAC", "C", "GS", "MS", "WFC"]) {
      const b = read(load(bank));
      for (const item of [...b.strengths, ...b.concerns]) expect(item.id, bank).not.toMatch(/^(margin|grossMargin|roic|conversion|accruals|leverage|cover|receivables|inventory|stockComp|burn|netCash)/);
    }
  });

  it("FLY: a loss-making company gets its burn, runway and dilution, and a negative margin improves rather than widens", () => {
    const r = read(fly());
    expect(ids(r)).toEqual({ strengths: ["growth", "marginUp", "accelerating", "netCash"], concerns: ["burn", "dilution", "loss", "receivables"] });
    expect(sentence(r, "marginUp")).toBe("Operating margin improved to −103.0% from −226.9% a year earlier; the three-year median is −238.8%.");
    expect(sentence(r, "burn")).toMatch(/^Free cash flow was −\$\d+M over the trailing twelve months; cash and short-term investments cover \d+\.\d quarters at that rate\.$/);
    expect(sentence(r, "loss")).toMatch(/^Net loss of \$\d+M over the trailing twelve months\.$/);
    expect(sentence(r, "growth")).toBe("Revenue grew 229.9% over the trailing twelve months."); // no year-earlier figure to compare with
  });

  for (const t of ["AAPL", "NVDA", "MSFT", "GOOGL", "META", "JPM", "BAC", "C", "GS", "MS", "WFC", "FLY"])
    it(`${t}: every sentence is plain, capped per side and carries sourced figures`, () => {
      const a = analyze(t === "FLY" ? fly() : load(t));
      const r = financialRead(a);
      expect(r.span).toBe(a.current);
      expect(r.strengths.length).toBeLessThanOrEqual(READ_RULES.perSide);
      expect(r.concerns.length).toBeLessThanOrEqual(READ_RULES.perSide);
      for (const side of [r.strengths, r.concerns]) {
        expect(side.map((x) => x.weight)).toEqual([...side.map((x) => x.weight)].sort((x, y) => y - x));
        expect(new Set(side.map((x) => x.id)).size).toBe(side.length);
      }
      for (const item of [...r.strengths, ...r.concerns]) {
        const text = readText(item);
        expect(text).toMatch(/^[A-Z].*\.$/);
        expect(text).not.toMatch(/[—!]|NaN|Infinity|undefined|null/);
        const numbers = item.parts.filter((p) => p.fig);
        expect(numbers.length, text).toBeGreaterThan(0);
        for (const p of numbers) {
          expect(p.fig!.parts.length, text).toBeGreaterThan(0);
          expect(p.label, text).toBeTruthy();
          expect([fmtFig(p.fig!.v, p.unit!), fmtFig(p.fig!.v, p.unit!, { abs: true })], text).toContain(p.text);
        }
        expect(item.side === "strength" ? r.strengths : r.concerns).toContain(item);
      }
    });
});

/* ---- thresholds, on a synthetic company whose lines are set to sit just on either side of each rule */
const base = (over: Lines = {}): Lines => ({ revenue: step(100, 104), netIncome: step(10, 10.4), operatingIncome: step(20, 20.8), ...over });
const co = (income: Lines, balance: Lines = {}, cashflow: Lines = {}) => read(company({ quarters: eightQuarters, q: { income, balance, cashflow } }));

describe("financialRead: rule thresholds", () => {
  it("says nothing for a company that sits inside every threshold", () => {
    expect(ids(co(base()))).toEqual({ strengths: [], concerns: [] });
    expect(read(company({}))).toEqual({ span: null, strengths: [], concerns: [] });
  });

  it("growth: strong at 10%, a decline below zero", () => {
    expect(ids(co(base({ revenue: step(100, 110), netIncome: step(10, 11), operatingIncome: step(20, 22) }))).strengths).toEqual(["growth"]);
    expect(ids(co(base({ revenue: step(100, 109.9), netIncome: step(10, 10.99), operatingIncome: step(20, 21.98) }))).strengths).toEqual([]);
    const down = co(base({ revenue: step(100, 95), netIncome: step(10, 9.6), operatingIncome: step(20, 19) }));
    expect(ids(down).concerns).toEqual(["decline"]);
    expect(sentence(down, "decline")).toBe("Revenue fell 5.0% over the trailing twelve months.");
  });

  it("growth slowing or picking up: the latest quarter against twelve months, five points apart", () => {
    const slowing = co(base({ revenue: [100, 100, 100, 100, 130, 125, 115, 108], netIncome: fill(10), operatingIncome: fill(20) }));
    expect(ids(slowing).concerns).toContain("slowing");
    expect(sentence(slowing, "slowing")).toBe("Growth slowed: revenue in the latest quarter rose 8.0% on a year earlier, against growth of 19.5% over twelve months.");
    const faster = co(base({ revenue: [100, 100, 100, 100, 100, 102, 106, 112], netIncome: fill(10), operatingIncome: fill(20) }));
    expect(ids(faster).strengths).toContain("accelerating");
  });

  it("margins: a move of a point up, a point and a half down", () => {
    const up = co(base({ operatingIncome: step(20, 21.9) })); // 20.0% to 21.06%
    expect(ids(up).strengths).toEqual(["marginUp"]);
    expect(sentence(up, "marginUp")).toBe("Operating margin widened to 21.1% from 20.0% a year earlier.");
    expect(ids(co(base({ operatingIncome: step(20, 21.8) }))).strengths).toEqual([]); // 20.96%: under a point
    const downMargin = co(base({ operatingIncome: step(20, 19.2) })); // 18.46%
    expect(ids(downMargin).concerns).toEqual(["marginDown"]);
    expect(ids(co(base({ operatingIncome: step(20, 19.3) }))).concerns).toEqual([]); // 18.56%: under a point and a half
    const gross = co(base({ grossProfit: step(50, 50.4) })); // 50.0% to 48.46%
    expect(ids(gross).concerns).toEqual(["grossMarginDown"]);
  });

  it("net income: a fall of 5% is a concern, growth 5 points ahead of revenue a strength", () => {
    expect(ids(co(base({ netIncome: step(10, 9.5) }))).concerns).toEqual(["profitDown"]);
    expect(ids(co(base({ netIncome: step(10, 9.6) }))).concerns).toEqual([]);
    const lead = co(base({ netIncome: step(10, 12) }));
    expect(ids(lead).strengths).toEqual(["profitLead"]);
    expect(sentence(lead, "profitLead")).toBe("Net income grew 20.0% over the trailing twelve months, faster than revenue at 4.0%.");
  });

  it("cash: conversion under 70% and accruals over 5% of assets are concerns, conversion over 100% a strength", () => {
    expect(ids(co(base(), {}, { fcf: fill(1.7), cfo: fill(2.6) })).concerns).toEqual(["conversionWeak"]); // 6.8 ÷ 41.6 = 16%
    expect(ids(co(base(), {}, { fcf: fill(7.4), cfo: fill(10.4) })).concerns).toEqual([]); // 71%
    expect(ids(co(base(), {}, { fcf: fill(10.5), cfo: fill(11) })).strengths).toEqual(["conversion"]);
    const accruals = co(base(), { totalAssets: fill(100) }, { cfo: fill(9), fcf: fill(8) }); // (41.6 − 36) ÷ 100 = 5.6%
    expect(ids(accruals).concerns).toEqual(["accruals"]);
    expect(sentence(accruals, "accruals")).toBe("Net income ran ahead of cash from operations by 5.6% of average assets.");
    expect(ids(co(base(), { totalAssets: fill(100) }, { cfo: fill(9.5), fcf: fill(8) })).concerns).toEqual([]); // 3.6%
  });

  it("balance sheet: net debt over three times EBITDA, interest cover under three, a current ratio under one", () => {
    const levered = co(base({ ebitda: fill(25) }), { totalDebt: fill(350), netDebt: fill(310), cash: fill(40) });
    expect(sentence(levered, "leverage")).toBe("Net debt is 3.1× EBITDA.");
    expect(ids(co(base({ ebitda: fill(25) }), { totalDebt: fill(300), netDebt: fill(290), cash: fill(10) })).concerns).toEqual([]); // 2.9×
    expect(sentence(co(base(), { netDebt: fill(-50), totalDebt: fill(10), cash: fill(60) }), "netCash")).toBe("Cash and short-term investments exceed total debt by $50.");
    expect(ids(co(base({ interestExpense: fill(8) }))).concerns).toEqual(["coverWeak"]); // 83.2 ÷ 32 = 2.6×
    expect(ids(co(base({ interestExpense: fill(1.9) }))).strengths).toEqual(["cover"]); // 10.9×
    expect(ids(co(base({ interestExpense: fill(4) }))).strengths).toEqual([]); // 5.2×
    expect(ids(co(base(), { currentAssets: fill(90), currentLiabilities: fill(100) })).concerns).toEqual(["liquidity"]);
  });

  it("working capital: receivables or inventories growing ten points faster than revenue, when they are material", () => {
    const fast = co(base(), { receivables: step(40, 46.4) }); // +16% against +4%
    expect(ids(fast).concerns).toEqual(["receivables"]);
    expect(sentence(fast, "receivables")).toBe("Receivables grew 16.0% over a year while revenue grew 4.0%; days sales outstanding went from 37 days to 41 days.");
    expect(ids(co(base(), { receivables: step(40, 45) })).concerns).toEqual([]); // +12.5%: under ten points ahead
    expect(ids(co(base(), { receivables: step(4, 8) })).concerns).toEqual([]); // doubled, but under 5% of revenue
    expect(ids(co(base({ costOfRevenue: fill(50) }), { inventory: step(20, 26) })).concerns).toEqual(["inventory"]);
    expect(ids(co(base({ costOfRevenue: fill(50) }), { inventory: step(2, 6) })).concerns).toEqual([]); // under 2% of revenue
  });

  it("share count and stock compensation", () => {
    expect(ids(co(base({ sharesDiluted: step(100, 103) }))).concerns).toEqual(["dilution"]);
    expect(ids(co(base({ sharesDiluted: step(100, 102.9) }))).concerns).toEqual([]);
    expect(sentence(co(base({ sharesDiluted: step(100, 99) })), "buyback")).toBe("The diluted share count fell 1.0% over a year.");
    expect(ids(co(base(), {}, { sbc: fill(10.5) })).concerns).toEqual(["stockComp"]); // 42 ÷ 416 = 10.1% of revenue
    expect(ids(co(base(), {}, { sbc: fill(10.3) })).concerns).toEqual([]); // 9.9%
  });

  it("losses: the loss, the burn and the runway", () => {
    const r = co(base({ netIncome: fill(-5), operatingIncome: fill(-4) }), { cash: fill(30) }, { fcf: fill(-6), cfo: fill(-5) });
    expect(ids(r).concerns).toEqual(["burn", "loss"]);
    expect(sentence(r, "burn")).toBe("Free cash flow was −$24 over the trailing twelve months; cash and short-term investments cover 5.0 quarters at that rate.");
    expect(sentence(r, "loss")).toBe("Net loss of $20 over the trailing twelve months.");
  });

  it("a bank: efficiency, return on equity, provisions and capital", () => {
    const bank = (income: Lines, balance: Lines = {}) => read(company({ industry: "Banks - Diversified", quarters: eightQuarters, q: { income: { revenue: step(100, 103), netIncome: step(20, 20.5), ...income }, balance } }));
    expect(ids(bank({}))).toEqual({ strengths: [], concerns: [] });
    expect(ids(bank({ revenue: step(100, 106), netIncome: step(20, 21) })).strengths).toEqual(["growth"]); // 6% is strong for a bank
    const better = bank({ nonInterestExpense: step(60, 60.7) }); // 60.0% to 58.9%
    expect(sentence(better, "efficiency")).toBe("The efficiency ratio improved to 58.9% from 60.0% a year earlier (expenses took a smaller share of revenue).");
    expect(ids(bank({ nonInterestExpense: step(60, 63.4) })).concerns).toEqual(["efficiencyWorse"]); // 61.6%
    expect(ids(bank({}, { equity: fill(600) })).strengths).toEqual(["roe"]); // 82 ÷ 600 = 13.7%
    expect(ids(bank({}, { equity: fill(1100) })).concerns).toEqual(["roeWeak"]); // 7.5%
    // provisions are measured against average loans, so the year-earlier figure needs a third year of balances
    const twelve = [1, 2, 3, 4].map((q) => period(2023, q)).concat(eightQuarters);
    const provisions = read(
      company({ industry: "Banks - Diversified", quarters: twelve, q: { income: { revenue: fill(100, 12), netIncome: fill(20, 12), provisionCreditLosses: [...fill(1, 8), ...fill(2, 4)] }, balance: { loans: fill(1000, 12) } } }),
    );
    expect(ids(provisions).concerns).toEqual(["provisions"]);
    expect(sentence(provisions, "provisions")).toBe("Provisions for credit losses rose to 0.8% of average loans from 0.4% a year earlier.");
    expect(ids(bank({}, { deposits: step(1000, 1060) })).strengths).toEqual(["deposits"]);
    expect(ids(bank({}, { deposits: step(1000, 990) })).concerns).toEqual(["depositsLower"]);
  });

  it("keeps the four heaviest per side", () => {
    const r = co(base({ revenue: step(100, 80), netIncome: fill(-5), operatingIncome: step(20, -4), grossProfit: step(50, 30), interestExpense: fill(8), sharesDiluted: step(100, 120) }), { cash: fill(10), currentAssets: fill(50), currentLiabilities: fill(100) }, { fcf: fill(-6), cfo: fill(-5), sbc: fill(12) });
    expect(r.concerns).toHaveLength(4);
    expect(r.concerns.map((x) => x.weight)).toEqual([...r.concerns.map((x) => x.weight)].sort((x, y) => y - x));
    expect(r.concerns[0].id).toBe("decline");
  });
});

/* ---- every rule that compares with revenue, read with revenue falling, flat and growing (review company-H3) */
describe("financialRead: true for negative, zero and positive growth", () => {
  const flat = (r: FinancialRead) => [...r.strengths, ...r.concerns].map(readText);
  const twelve = [1, 2, 3, 4].map((q) => period(2023, q)).concat(eightQuarters);

  it("a decline that eases in the latest quarter is not called growth and is not a strength", () => {
    // reviewer's case A: −20% over twelve months, −10% in the latest quarter
    const r = co(base({ revenue: [100, 100, 100, 100, 76, 77, 77, 90], netIncome: fill(10), operatingIncome: fill(20) }));
    expect(ids(r).strengths).not.toContain("accelerating");
    expect(ids(r).strengths).not.toContain("returnToGrowth");
    expect(sentence(r, "decline")).toBe("Revenue fell 20.0% over the trailing twelve months.");
    for (const t of flat(r)) expect(t).not.toMatch(/picked up|rose −|grew −/);
  });

  it("a quarter that grows after a falling year is a return to growth, stated with both figures", () => {
    const r = co(base({ revenue: [100, 100, 100, 100, 90, 90, 90, 104], netIncome: fill(10), operatingIncome: fill(20) }));
    expect(ids(r).strengths).toContain("returnToGrowth");
    expect(sentence(r, "returnToGrowth")).toBe("Revenue returned to growth: the latest quarter rose 4.0% on a year earlier, while twelve-month revenue fell 6.5%.");
  });

  it("growth that turns into a falling quarter says the quarter fell", () => {
    const r = co(base({ revenue: [100, 100, 100, 100, 131, 125, 115, 95], netIncome: fill(10), operatingIncome: fill(20) }));
    expect(sentence(r, "slowing")).toBe("Growth slowed: revenue in the latest quarter fell 5.0% on a year earlier, against growth of 16.5% over twelve months.");
  });

  it("net income ahead of falling or flat revenue says revenue fell or was flat (reviewer's case B)", () => {
    const down = co(base({ revenue: step(100, 92), netIncome: step(10, 12), operatingIncome: fill(20) }));
    expect(sentence(down, "profitLead")).toBe("Net income grew 20.0% over the trailing twelve months while revenue fell 8.0%.");
    const level = co(base({ revenue: fill(100), netIncome: step(10, 12), operatingIncome: fill(20) }));
    expect(sentence(level, "profitLead")).toBe("Net income grew 20.0% over the trailing twelve months while revenue was flat at 0.0%.");
    expect(ids(level).concerns).not.toContain("decline");
  });

  it("receivables and inventories growing while revenue falls say revenue fell", () => {
    const rec = co(base({ revenue: step(100, 92), netIncome: fill(10), operatingIncome: fill(20) }), { receivables: step(40, 46.4) });
    expect(sentence(rec, "receivables")).toMatch(/^Receivables grew 16\.0% over a year while revenue fell 8\.0%; days sales outstanding went from \d+ days to \d+ days\.$/);
    const inv = co(base({ revenue: step(100, 92), netIncome: fill(10), operatingIncome: fill(20), costOfRevenue: fill(50) }), { inventory: step(20, 26) });
    expect(sentence(inv, "inventory")).toBe("Inventories grew 30.0% over a year while revenue fell 8.0%.");
  });

  it("a decline after a growing year says what the year before did", () => {
    const r = read(company({ quarters: twelve, q: { income: { revenue: [...fill(100, 4), ...fill(110, 4), ...fill(99, 4)], netIncome: fill(10, 12), operatingIncome: fill(20, 12) } } }));
    expect(sentence(r, "decline")).toBe("Revenue fell 10.0% over the trailing twelve months, after it grew 10.0% a year earlier.");
  });

  it("no sentence calls a negative figure a rise, growth or a widening, across falling, flat and growing revenue", () => {
    for (const rev of [step(100, 80), step(100, 92), fill(100), step(100, 108), step(100, 125), [100, 100, 100, 100, 76, 77, 77, 90], [100, 100, 100, 100, 131, 125, 115, 95]])
      for (const ni of [step(10, 7), fill(10), step(10, 13)]) {
        const r = co(base({ revenue: rev, netIncome: ni, operatingIncome: fill(20), costOfRevenue: fill(50) }), { receivables: step(40, 47), inventory: step(20, 26) });
        for (const t of flat(r)) expect(t).not.toMatch(/(rose|grew|picked up|widened|narrowed|faster than revenue at) −/);
        if (rev[7] <= rev[3]) expect(ids(r).strengths).not.toContain("accelerating");
      }
  });
});

describe("fmtFig", () => {
  it("formats each unit plainly, with a real minus sign", () => {
    expect(fmtFig(0.1424, "pct")).toBe("14.2%");
    expect(fmtFig(-0.0159, "pct")).toBe("−1.6%");
    expect(fmtFig(10.0029, "pct")).toBe("1,000.3%");
    expect(fmtFig(-0.05, "pct", { abs: true })).toBe("5.0%");
    expect(fmtFig(4.12, "x")).toBe("4.1×");
    expect(fmtFig(426.7, "x")).toBe("427×");
    expect(fmtFig(-0.4, "x")).toBe("−0.4×");
    expect(fmtFig(466.823e9, "usd")).toBe("$466.8B");
    expect(fmtFig(4.42e12, "usd")).toBe("$4.42T");
    expect(fmtFig(-350e6, "usd")).toBe("−$350M");
    expect(fmtFig(12_500, "usd")).toBe("$12,500");
    expect(fmtFig(8.714, "perShare")).toBe("$8.71");
    expect(fmtFig(-13.05, "perShare")).toBe("−$13.05");
    expect(fmtFig(24.55, "days")).toBe("25 days");
    expect(fmtFig(6.12, "quarters")).toBe("6.1 quarters");
  });
});
