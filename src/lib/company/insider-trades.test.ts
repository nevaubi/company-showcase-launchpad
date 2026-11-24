import { describe, expect, it } from "vitest";
import type { InsiderTrade } from "@/lib/financials/types";
import { fmtFig } from "./read";
import { fmtTradeUsd, insiderSummary, insiderWindowCaption, openMarketTrades, roleLabel, tradeAmount } from "./insider-trades";
import hcc from "./fixtures/HCC-insiders.json";

// Real Form 4 rows of Warrior Met Coal (HCC) as the company kit builds them from SEC. Checked on EDGAR:
// 0001494489-26-000016 (Aug 24, 2026) is one sale row, 50,000 sh at $110; 0001494489-26-000013 (Aug 19) 50,000 sh at $105.
const rows = hcc.insiders as InsiderTrade[];
const fmt = (d: string) => d;

describe("openMarketTrades on HCC's rows", () => {
  const trades = openMarketTrades(rows);

  it("values a sale at shares x price of the filing's rows, with one rounding", () => {
    const aug24 = trades.find((t) => t.accn === "0001494489-26-000016")!;
    const aug19 = trades.find((t) => t.accn === "0001494489-26-000013")!;
    expect(aug24.usd).toBe(5_500_000);
    expect(aug19.usd).toBe(5_250_000);
    expect(tradeAmount(aug24)).toBe("sold $5.5M");
    expect(tradeAmount(aug19)).toBe("sold $5.3M");
    // the Ownership block used to round with fmtFig, which printed the same sales as $6M and $5M
    expect(fmtFig(aug24.usd!, "usd")).toBe("$6M");
    expect(fmtFig(aug19.usd!, "usd")).toBe("$5M");
  });

  it("is one trade per filing, summed over its rows and dated by its latest row", () => {
    const chopin = trades.filter((t) => t.accn === "0001642193-25-000003");
    expect(chopin).toHaveLength(1);
    expect(chopin[0].rows).toBe(2);
    expect(chopin[0].usd).toBeCloseTo(585 * 84.75 + 1498 * 80.54, 6);
    expect(chopin[0].date).toBe("2025-11-13");
    expect(chopin[0].firstDate).toBe("2025-11-12");
  });

  it("leaves out awards, exercises and tax withholding, and sorts newest first", () => {
    expect(trades.every((t) => t.kind === "sale" || t.kind === "purchase")).toBe(true);
    expect(trades.length).toBe(10);
    expect(trades[0].accn).toBe("0001494489-26-000016");
    expect(trades.map((t) => t.date)).toEqual([...trades.map((t) => t.date)].sort().reverse());
  });

  it("keeps a sale and a purchase in one filing apart, and never values an unpriced row", () => {
    const base = rows.find((t) => t.code === "S")!;
    const mixed = openMarketTrades([
      { ...base, accn: "x", code: "S", shares: 100, price: 10 },
      { ...base, accn: "x", code: "P", shares: 50, price: 12 },
      { ...base, accn: "y", code: "S", shares: 70, price: null },
      { ...base, accn: "y", code: "S", shares: 30, price: 0 },
    ]);
    expect(mixed.find((t) => t.accn === "x" && t.kind === "sale")!.usd).toBe(1000);
    expect(mixed.find((t) => t.accn === "x" && t.kind === "purchase")!.usd).toBe(600);
    const y = mixed.find((t) => t.accn === "y")!;
    expect(y.usd).toBeNull();
    expect(y.unpriced).toBe(2);
    expect(tradeAmount(y)).toBe("sold 100 sh");
  });
});

describe("insiderSummary on HCC's rows", () => {
  it("never shows totals of an empty window above a list of sales (review M5, 24 Nov 2026)", () => {
    const s = insiderSummary(rows, new Date("2026-11-24T12:00:00Z"));
    expect(s.inWindow).toHaveLength(0);
    expect(s.sold).toBe(0);
    expect(s.listTitle).toBe("Latest trades on file");
    expect(s.list.map((t) => t.accn)).toEqual(["0001494489-26-000016", "0001642193-26-000008", "0001494489-26-000013", "0001702386-26-000006"]);
    expect(insiderWindowCaption(s, fmt)).toBe("Open-market trades, last 90 days");
  });

  it("totals exactly the trades the list shows when the window holds them", () => {
    const s = insiderSummary(rows, new Date("2026-08-31T12:00:00Z"));
    // Aug 24, Aug 19 (three sellers) and Jun 2 are inside the 90 days to Aug 31 (from Jun 2)
    expect(s.inWindow.map((t) => t.date)).toEqual(["2026-08-24", "2026-08-19", "2026-08-19", "2026-08-19", "2026-06-02"]);
    const total = 5_500_000 + 5_250_000 + 3232 * 104.02 + 4800 * 104.23 + 20000 * 110;
    expect(s.sold).toBeCloseTo(total, 4);
    expect(s.sales).toBe(5);
    expect(s.purchases).toBe(0);
    expect(fmtTradeUsd(s.sold)).toBe("$13.8M");
    expect(s.list).toHaveLength(4);
    expect(s.listTitle).toBe("Latest 4 of 5 in the window");
    for (const t of s.list) expect(t.date >= s.since).toBe(true);
  });

  it("names the start of the records when they begin inside the window", () => {
    const s = insiderSummary(rows.filter((t) => t.date >= "2026-08-01"), new Date("2026-09-01T12:00:00Z"));
    expect(s.partial).toBe(true);
    expect(insiderWindowCaption(s, fmt)).toBe("Open-market trades since 2026-08-19");
  });
});

describe("roleLabel", () => {
  it("puts upper-case officer titles in sentence case and leaves the rest", () => {
    expect(roleLabel("CHIEF EXECUTIVE OFFICER, Director")).toBe("Chief executive officer, Director");
    expect(roleLabel("CHIEF ACCOUNTING OFFICER")).toBe("Chief accounting officer");
    expect(roleLabel("CEO, 10% owner")).toBe("CEO, 10% owner");
    expect(roleLabel("See remarks")).toBe("See remarks");
    // DGII's CFO as filed
    expect(roleLabel("SR VP, CFO AND TREASURER")).toBe("SR VP, CFO and treasurer");
    expect(roleLabel("EVP & GENERAL COUNSEL")).toBe("EVP & general counsel");
  });
});
