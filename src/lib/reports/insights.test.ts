import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { hydrateDataset } from "@/lib/financials/dataset";
import type { Bar, CompanyDataset } from "@/lib/financials/types";
import { buildReportData } from "./facts";
import { chartFactIds, keptFactIds } from "./chart-facts";
import { lastClose, ols, peerSnapshot, quantile, selectPeers, withLivePrice } from "./peers";

const load = (t: string) => hydrateDataset(JSON.parse(readFileSync(`src/test/fixtures/companies/${t}.json`, "utf8")) as CompanyDataset);
const bars = (t: string) => (JSON.parse(readFileSync((t === "SPY" ? "public/data/prices/SPY.json" : `src/test/fixtures/prices/${t}.json`), "utf8")) as { bars: Bar[] }).bars;

describe("peer selection", () => {
  const u = [
    { ticker: "AAA", sector: "Tech", industry: "Software", revenueTTM: 100e9 },
    { ticker: "BBB", sector: "Tech", industry: "Software", revenueTTM: 90e9 },
    { ticker: "CCC", sector: "Tech", industry: "Semiconductors", revenueTTM: 110e9 },
    { ticker: "DDD", sector: "Tech", industry: "Software", revenueTTM: 1e9 },
    { ticker: "EEE", sector: "Financials", industry: "Banks", revenueTTM: 100e9 },
    { ticker: "FFF", sector: "Tech", industry: "Hardware", revenueTTM: 50e9 },
  ];
  it("puts the same industry first (closest in size), then curated, then companies listing it, then the sector", () => {
    expect(selectPeers("AAA", u, ["FFF"], ["CCC"], 6)).toEqual(["BBB", "DDD", "FFF", "CCC"]);
  });
  it("never compares a lender with a non-financial company", () => {
    expect(selectPeers("AAA", u, ["EEE"], [], 6)).not.toContain("EEE");
    expect(selectPeers("EEE", u, ["AAA"], [], 6)).toEqual([]);
  });
  it("caps the peer count", () => {
    expect(selectPeers("AAA", u, [], [], 2)).toHaveLength(2);
  });
});

describe("statistics", () => {
  it("fits a line and reports R²", () => {
    const f = ols([0, 1, 2, 3, 4], [1, 3, 5, 7, 9])!;
    expect(f.a).toBeCloseTo(1);
    expect(f.b).toBeCloseTo(2);
    expect(f.r2).toBeCloseTo(1);
    expect(ols([1, 2, 3], [1, 2, 3])).toBeNull();
  });
  it("interpolates quantiles", () => {
    expect(quantile([1, 2, 3, 4, 5], 0.25)).toBe(2);
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
  });
  it("extends stored closes with today's price, keeping the adjusted ratio", () => {
    const b: Bar[] = [["2026-11-02", 10, 10, 10, 100, 50, 1]];
    const out = withLivePrice(b, { price: 110, asOf: "2026-11-06" })!;
    expect(out).toHaveLength(2);
    expect(out[1][4]).toBe(110);
    expect(out[1][5]).toBe(55);
    expect(withLivePrice(b, { price: 110, asOf: "2026-11-01" })).toHaveLength(1);
  });
});

describe("peer metrics", () => {
  const msft = peerSnapshot(load("MSFT"), bars("MSFT"), lastClose(bars("MSFT")));
  it("tags every metric with the peer's ticker so its own filings open", () => {
    for (const v of Object.values(msft.m)) {
      if (v!.ref.kind === "derived" || v!.ref.kind === "sec") expect(v!.ref.tk).toBe("MSFT");
    }
    expect(msft.m.opMargin!.v).toBeGreaterThan(0.2);
  });
  it("prices multiples with a dated price", () => {
    const pe = msft.m.pe!;
    expect(pe.ref.kind === "derived" && pe.ref.market?.[0].asOf).toBe(lastClose(bars("MSFT"))!.asOf);
  });
  it("uses price ÷ TTM diluted EPS for P/E, the same definition as the valuation table", () => {
    const d = load("MSFT");
    const q = d.statements.quarterly.income;
    const row = q.rows.find((r) => r.key === "epsDiluted")!;
    let last = q.periods.length - 1;
    while (last >= 0 && row.cells[last] == null) last--;
    const ttmEps = [0, 1, 2, 3].reduce((s, k) => s + row.cells[last - k]!.v, 0);
    const px = lastClose(bars("MSFT"))!.price;
    expect(msft.m.pe!.ref.kind === "derived" && msft.m.pe!.ref.formula).toBe("Share price ÷ TTM diluted EPS");
    expect(msft.m.pe!.v).toBeCloseTo(px / ttmEps, 6);
  });
});

describe("report insights", () => {
  const d = load("AAPL");
  const peers = ["MSFT", "GOOGL", "NVDA", "META"].map((t) => peerSnapshot(load(t), bars(t), lastClose(bars(t))));
  const built = buildReportData({ today: "2026-11-06", data: d, price: { price: 260, asOf: "2026-11-06" }, estimates: null, promises: null, reactions: null, coverage: null, peers, prices: { self: bars("AAPL"), spy: bars("SPY") } });

  it("plots only values that point at a real fact", () => {
    const ids = new Set(built.facts.map((f) => f.id));
    expect(built.charts.length).toBeGreaterThan(6);
    for (const c of built.charts) for (const id of chartFactIds(c)) expect(ids.has(id)).toBe(true);
  });
  it("builds peer rankings from each company's own sourced figure", () => {
    const rank = built.facts.find((f) => f.area === "peers" && f.text.includes("ranks") && f.text.includes("operating margin"))!;
    expect(rank.ref.kind).toBe("composite");
    if (rank.ref.kind !== "composite") return;
    expect(rank.ref.members.length).toBe(5);
    const members = rank.ref.members.map((m) => built.facts.find((f) => f.id === m)!);
    expect(new Set(members.map((m) => (m.ref.kind === "derived" ? m.ref.tk : null)))).toEqual(new Set(["AAPL", "MSFT", "GOOGL", "NVDA", "META"]));
  });
  it("keeps composite members with the saved report", () => {
    const rank = built.facts.find((f) => f.ref.kind === "composite")!;
    const keep = keptFactIds([{ id: "s", title: "S", paragraphs: [{ text: "x", factIds: [rank.id] }], bullets: [], tables: [] }], [], [], built.facts);
    if (rank.ref.kind === "composite") for (const m of rank.ref.members) expect(keep.has(m)).toBe(true);
  });
  it("hides plot-only facts from the writer", () => {
    expect(built.facts.some((f) => f.chart)).toBe(true);
  });
  it("adds a peer table with the company first and a median row", () => {
    const t = built.tables.find((x) => x.id === "peers")!;
    expect(t.rows[0].label.startsWith("AAPL")).toBe(true);
    expect(t.rows.at(-1)!.label).toBe("Peer median");
  });
  it("compares returns over the same window as the index", () => {
    const rel = built.facts.find((f) => f.area === "performance" && f.text.startsWith("Over the past year"));
    expect(rel?.ref.kind).toBe("composite");
  });
});

describe("segment and fit charts", () => {
  const jpm = load("JPM");
  const peers = ["BAC", "WFC", "C", "GS", "MS"].map((t) => peerSnapshot(load(t), bars(t), lastClose(bars(t))));
  const built = buildReportData({ today: "2026-11-06", data: jpm, price: { price: 337, asOf: "2026-11-06" }, estimates: null, promises: null, reactions: null, coverage: null, peers, prices: { self: bars("JPM"), spy: bars("SPY") } });
  it("plots only years in which every shown segment is reported", () => {
    const mix = built.charts.find((c) => c.id === "segment-mix");
    expect(mix && mix.type === "stacked").toBe(true);
    if (!mix || mix.type !== "stacked") return;
    for (const s of mix.series) for (const pt of s.points) expect(pt.v).not.toBeNull();
  });
  it("draws a trend line only when the peer fit explains something", () => {
    const sc = built.charts.find((c) => c.id === "peer-scatter");
    if (!sc || sc.type !== "scatter") return;
    const fact = built.facts.find((f) => f.area === "peers" && f.text.includes("R²"))!;
    const r2 = Number(/R² ([\d.]+)/.exec(fact.text)![1]);
    expect(!!sc.fit).toBe(r2 >= 0.15);
  });
});
