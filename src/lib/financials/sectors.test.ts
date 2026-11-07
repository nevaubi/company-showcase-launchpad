import { describe, expect, it } from "vitest";
import { aggregateSectors, type CompanyMetrics } from "./sectors";

const m = (over: Partial<CompanyMetrics>): CompanyMetrics => ({
  ticker: "X",
  name: "X",
  sector: "Tech",
  industry: "Software",
  bank: false,
  mcap: 100,
  revenue: 50,
  netIncome: 10,
  operatingIncome: 15,
  fcf: 8,
  ebitda: 20,
  netDebt: 10,
  growth: 0.1,
  cagr3y: 0.08,
  pe: 10,
  fcfYield: 0.08,
  opMargin: 0.3,
  ...over,
});

describe("sector roll-ups", () => {
  const [tech] = aggregateSectors([
    m({
      ticker: "A",
      mcap: 900,
      revenue: 100,
      netIncome: 30,
      operatingIncome: 40,
      fcf: 25,
      growth: 0.2,
    }),
    m({
      ticker: "B",
      mcap: 100,
      revenue: 100,
      netIncome: -10,
      operatingIncome: -5,
      fcf: -2,
      growth: -0.1,
    }),
  ]);

  it("weights margins by revenue, like an index", () => {
    // (30 − 10) ÷ (100 + 100)
    expect(tech.netMargin).toBeCloseTo(0.1);
  });
  it("prices sector P/E over profitable members only", () => {
    // B loses money, so only A counts: 900 ÷ 30
    expect(tech.pe).toBeCloseTo(30);
  });
  it("sorts members by market cap and counts them", () => {
    expect(tech.members.map((x) => x.ticker)).toEqual(["A", "B"]);
    expect(tech.count).toBe(2);
  });
  it("leaves banks out of free-cash-flow yield", () => {
    const [fin] = aggregateSectors([
      m({ sector: "Fin", bank: true, fcf: null, mcap: 500 }),
      m({ sector: "Fin", mcap: 100, fcf: 5 }),
    ]);
    expect(fin.fcfYield).toBeCloseTo(0.05);
  });
});

describe("sharesFor", () => {
  it("prefers diluted shares unless they disagree with the cover page by more than 3x", async () => {
    const { sharesFor } = await import("./sectors");
    expect(sharesFor({ sharesOutstanding: 100, f: { dilutedShares: 102 } } as never)).toBe(102);
    expect(
      sharesFor({ sharesOutstanding: 98_248_111, f: { dilutedShares: 98_204_000_000 } } as never),
    ).toBe(98_248_111);
    expect(sharesFor({ sharesOutstanding: null, f: { dilutedShares: 50 } } as never)).toBe(50);
    expect(sharesFor({ sharesOutstanding: 70, f: undefined } as never)).toBe(70);
  });
});
