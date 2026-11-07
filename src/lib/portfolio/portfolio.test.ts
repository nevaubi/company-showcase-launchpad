import { describe, expect, it } from "vitest";
import { normTicker, parseHoldings, holdingsToCsv } from "./parse";
import {
  averageDollarVolume,
  buildPositions,
  concentration,
  exposureBy,
  factorExposure,
  governmentExposure,
  hiddenOverlap,
  liquidity,
  shockBook,
  type PositionMeta,
} from "./analytics";
import type { RiskLink } from "@/lib/supply/core";

const link = (o: Partial<RiskLink>): RiskLink => ({
  id: Math.random().toString(36).slice(2),
  ticker: "A",
  counterparty: "X",
  counterparty_ticker: null,
  counterparty_domain: null,
  relation: "supplier",
  detail: "",
  share_pct: null,
  quote: "quote",
  accn: "0000000000-26-000001",
  doc: "doc.htm",
  form: "10-K",
  filed: "2026-02-01",
  ...o,
});

describe("parseHoldings", () => {
  it("reads a CSV with a header in any column order", () => {
    const r = parseHoldings("Symbol,Quantity,Avg Cost\nAAPL,100,150.5\nmsft,\"1,200\",300\n");
    expect(r.holdings).toEqual([
      { ticker: "AAPL", shares: 100, weight: null, cost: 150.5 },
      { ticker: "MSFT", shares: 1200, weight: null, cost: 300 },
    ]);
    expect(r.errors).toEqual([]);
  });
  it("reads pasted lines with weights, merges duplicates and normalizes class tickers", () => {
    const r = parseHoldings("NVDA 12%\nbrk.b 5%\nNVDA 3%\n$AMD\n");
    expect(r.holdings.find((h) => h.ticker === "NVDA")?.weight).toBeCloseTo(0.15);
    expect(r.holdings.find((h) => h.ticker === "BRK-B")?.weight).toBeCloseTo(0.05);
    expect(r.holdings.find((h) => h.ticker === "AMD")).toEqual({ ticker: "AMD", shares: null, weight: null, cost: null });
  });
  it("separates tickers outside the universe and reports bad lines", () => {
    const r = parseHoldings("AAPL 10\nZZZZ 5\nAAPL -3\n12345", new Set(["AAPL"]));
    expect(r.holdings.map((h) => h.ticker)).toEqual(["AAPL"]);
    expect(r.unknown).toEqual(["ZZZZ"]);
    expect(r.errors.length).toBe(2);
  });
  it("weight column given as fractions or percents", () => {
    const a = parseHoldings("ticker,weight\nAAPL,0.25\nMSFT,75");
    expect(a.holdings.map((h) => h.weight)).toEqual([0.25, 0.75]);
  });
  it("normTicker strips exchange prefixes", () => {
    expect(normTicker("NASDAQ:aapl")).toBe("AAPL");
    expect(normTicker("BRK/B")).toBe("BRK-B");
  });
  it("round-trips through CSV", () => {
    const h = parseHoldings("AAPL 10 150\nMSFT 20%").holdings;
    expect(parseHoldings(holdingsToCsv(h)).holdings).toEqual(h);
  });
});

const meta = new Map<string, PositionMeta>([
  ["A", { name: "Alpha", sector: "Tech", industry: "Chips", mcap: 1e9 }],
  ["B", { name: "Beta", sector: "Tech", industry: "Software", mcap: 5e9 }],
  ["C", { name: "Gamma", sector: "Health", industry: "Pharma", mcap: null }],
]);

describe("buildPositions", () => {
  it("uses market value when every holding has shares and a price", () => {
    const { positions, basis, total } = buildPositions(
      [
        { ticker: "A", shares: 10, weight: null, cost: null },
        { ticker: "B", shares: 30, weight: null, cost: null },
      ],
      new Map([["A", 10], ["B", 10]]),
      meta,
    );
    expect(basis).toBe("value");
    expect(total).toBe(400);
    expect(positions.map((p) => [p.ticker, p.weight])).toEqual([["B", 0.75], ["A", 0.25]]);
  });
  it("normalizes given weights", () => {
    const { positions, basis } = buildPositions(
      [
        { ticker: "A", shares: null, weight: 0.2, cost: null },
        { ticker: "B", shares: null, weight: 0.6, cost: null },
      ],
      new Map(),
      meta,
    );
    expect(basis).toBe("weights");
    expect(positions.find((p) => p.ticker === "A")!.weight).toBeCloseTo(0.25);
  });
  it("falls back to equal weights", () => {
    const { positions, basis } = buildPositions([{ ticker: "A", shares: null, weight: null, cost: null }, { ticker: "C", shares: null, weight: null, cost: null }], new Map(), meta);
    expect(basis).toBe("equal");
    expect(positions.every((p) => p.weight === 0.5)).toBe(true);
  });
  it("mixed basis still sums to one", () => {
    const { positions, basis } = buildPositions(
      [
        { ticker: "A", shares: null, weight: 0.5, cost: null },
        { ticker: "B", shares: 10, weight: null, cost: null },
        { ticker: "C", shares: null, weight: null, cost: null },
      ],
      new Map([["B", 10]]),
      meta,
    );
    expect(basis).toBe("mixed");
    expect(positions.reduce((s, p) => s + p.weight, 0)).toBeCloseTo(1);
  });
});

describe("exposure, concentration, factors", () => {
  const { positions } = buildPositions(
    [
      { ticker: "A", shares: null, weight: 0.5, cost: null },
      { ticker: "B", shares: null, weight: 0.3, cost: null },
      { ticker: "C", shares: null, weight: 0.2, cost: null },
    ],
    new Map(),
    meta,
  );
  it("groups by sector", () => {
    const s = exposureBy(positions, "sector");
    expect(s[0]).toMatchObject({ key: "Tech", count: 2 });
    expect(s[0].weight).toBeCloseTo(0.8);
  });
  it("computes HHI and effective N", () => {
    const c = concentration(positions);
    expect(c.hhi).toBeCloseTo(0.25 + 0.09 + 0.04);
    expect(c.effectiveN).toBeCloseTo(1 / 0.38);
    expect(c.top1).toBeCloseTo(0.5);
  });
  it("re-weights factor averages to covered positions and ranks contributors", () => {
    const f = factorExposure(positions, new Map([["A", { beta: 2 }], ["B", { beta: 1 }]]), [{ id: "beta", label: "Beta", unit: "ratio", source: "q" }]);
    expect(f[0].coverage).toBeCloseTo(0.8);
    expect(f[0].value).toBeCloseTo((0.5 * 2 + 0.3 * 1) / 0.8);
    expect(f[0].contributors[0].ticker).toBe("A");
  });
});

describe("supply-chain overlap", () => {
  const { positions } = buildPositions(
    [
      { ticker: "A", shares: null, weight: 0.5, cost: null },
      { ticker: "B", shares: null, weight: 0.5, cost: null },
    ],
    new Map(),
    meta,
  );
  const links = [
    link({ ticker: "A", counterparty: "Amazon Web Services", counterparty_ticker: "AMZN", relation: "supplier", single_source: true }),
    link({ ticker: "B", counterparty: "AWS", counterparty_ticker: "AMZN", relation: "supplier", single_source: true }),
    link({ ticker: "A", counterparty: "TSMC", counterparty_ticker: "TSM", relation: "supplier", single_source: true }),
    link({ ticker: "A", counterparty: "U.S. Government", relation: "customer", share_pct: 40 }),
    link({ ticker: "B", counterparty: "U.S. Department of Defense", relation: "customer", share_pct: 10 }),
    link({ ticker: "B", counterparty: "Walmart", counterparty_ticker: "WMT", relation: "customer", share_pct: 15 }),
    link({ ticker: "A", counterparty: "Walmart Inc.", counterparty_ticker: "WMT", relation: "customer", share_pct: 12 }),
  ];
  it("finds single-source suppliers and major customers shared by 2+ holdings", () => {
    const g = hiddenOverlap(positions, links);
    expect(g.map((x) => [x.kind, x.counterpartyTicker, x.holdings.length])).toEqual([
      ["single-source supplier", "AMZN", 2],
      ["major customer", "WMT", 2],
    ]);
    expect(g[0].holdings[0].accn).toBeTruthy();
  });
  it("weights disclosed government shares", () => {
    const gov = governmentExposure(positions, links);
    expect(gov.weighted).toBeCloseTo(0.5 * 0.4 + 0.5 * 0.1);
    expect(gov.rows.map((r) => r.ticker)).toEqual(["A", "B"]);
  });
  it("puts a shock on the book with first- and second-order paths", () => {
    const shockLinks = [
      link({ ticker: "A", counterparty: "Big Customer", counterparty_ticker: "BIG", relation: "customer", share_pct: 30 }),
      link({ ticker: "B", counterparty: "Alpha", counterparty_ticker: "A", relation: "customer", share_pct: 20 }),
    ];
    const s = shockBook("BIG", 0.2, positions, shockLinks, { A: "Alpha", B: "Beta", BIG: "Big" }, {});
    const a = s.rows.find((r) => r.ticker === "A")!;
    expect(a.hop).toBe(1);
    expect(a.revenuePct).toBeCloseTo(0.06);
    expect(a.bookPct).toBeCloseTo(0.03);
    const b = s.rows.find((r) => r.ticker === "B")!;
    expect(b.hop).toBe(2);
    expect(b.revenuePct).toBeCloseTo(0.012);
    expect(s.quantified).toBeCloseTo(0.03 + 0.006);
  });
});

describe("liquidity", () => {
  it("averages dollar volume and converts to days at 20% participation", () => {
    const bars = Array.from({ length: 25 }, (_, i) => [`2026-10-${String(i + 1).padStart(2, "0")}`, 10, 10, 10, 10, 10, 1000] as [string, number, number, number, number, number, number]);
    expect(averageDollarVolume(bars)).toBe(10_000);
    const { positions } = buildPositions([{ ticker: "A", shares: 4000, weight: null, cost: null }], new Map([["A", 10]]), meta);
    const l = liquidity(positions, new Map([["A", 10_000]]));
    expect(l[0].days).toBeCloseTo(20);
    expect(l[0].ofMcap).toBeCloseTo(40_000 / 1e9);
  });
});
