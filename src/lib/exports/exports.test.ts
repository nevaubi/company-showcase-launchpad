import { describe, expect, it } from "vitest";
import { jsPDF } from "jspdf";
import type { CompanyDataset, Row, Statement } from "@/lib/financials/types";
import { SourceRegister, insiderSummary, type Dossier } from "./dossier";
import { buildTearSheet } from "./tear-sheet";
import { buildMemoDocx } from "./memo-docx";
import { buildModelWorkbook } from "./model-xlsx";
import { buildDeck } from "./deck";

const bytesOf = (b: Blob) =>
  new Promise<Uint8Array>((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(new Uint8Array(fr.result as ArrayBuffer));
    fr.onerror = () => rej(fr.error);
    fr.readAsArrayBuffer(b);
  });

const filings = Array.from({ length: 8 }, (_, i) => ({ accn: `0000000001-26-00000${i}`, form: i === 7 ? "10-K" : "10-Q", filed: `2026-0${(i % 9) + 1}-15`, doc: `d${i}.htm`, report: `2026Q${(i % 4) + 1}` }));
const periods = Array.from({ length: 8 }, (_, i) => ({ key: `FY${2025 + Math.floor(i / 4)}Q${(i % 4) + 1}`, label: `Q${(i % 4) + 1} FY${25 + Math.floor(i / 4)}`, fy: 2025 + Math.floor(i / 4), fq: (i % 4) + 1, end: `2026-0${(i % 9) + 1}-28` }));
const row = (key: string, label: string, base: number, unit: Row["unit"] = "usd"): Row => ({
  key,
  label,
  unit,
  cells: periods.map((_, i) => ({ v: base * (1 + i * 0.05), src: { accn: filings[i].accn, concept: `us-gaap:${key}`, end: periods[i].end, value: base * (1 + i * 0.05) } })),
});
const income: Statement = { periods, rows: [row("revenue", "Revenue", 1e9), row("grossProfit", "Gross profit", 4e8), row("operatingIncome", "Operating income", 2e8), row("netIncome", "Net income", 1.5e8), row("epsDiluted", "Diluted EPS", 1.2, "usdPerShare")] };
const cash: Statement = { periods, rows: [row("cfo", "Operating cash flow", 3e8), row("capex", "Capital expenditures", 5e7)] };
const empty: Statement = { periods, rows: [] };
const annual: Statement = { periods: periods.slice(0, 2).map((p, i) => ({ ...p, key: `FY${2024 + i}`, label: `FY${24 + i}`, fq: undefined })), rows: [{ key: "revenue", label: "Revenue", unit: "usd", cells: [{ v: 3.8e9, src: { accn: filings[7].accn, concept: "r", end: "2025", value: 3.8e9 } }, { v: 4.2e9, src: { accn: filings[7].accn, concept: "r", end: "2026", value: 4.2e9 } }] }] };

const d: CompanyDataset = {
  generatedAt: "2026-11-06T00:00:00Z",
  profile: { ticker: "TEST", cik: "123", name: "Test Corp", exchange: "NASDAQ", sic: "", sicDescription: "", sector: "Technology", industry: "Software", fiscalYearEnd: "1231", stateOfIncorporation: "", ein: "", phone: "", address: { street: "", city: "Austin", state: "TX", zip: "" }, website: "", investorRelations: "", description: "Test Corp makes test software.", logo: "", founded: 2000, ceo: "A. Person", sharesOutstanding: 1e8, sharesOutstandingAsOf: null, sharesOutstandingAccn: null, filerCategory: "", formerNames: [] },
  filings,
  statements: { quarterly: { income, balance: empty, cashflow: cash, kpis: empty }, annual: { income: annual, balance: { ...empty, periods: annual.periods }, cashflow: { ...empty, periods: annual.periods }, kpis: { ...empty, periods: annual.periods } } },
  segments: [{ axis: "srt:SegmentsAxis", axisLabel: "Segments", member: "Cloud", label: "Cloud", metric: "revenue", concept: "us-gaap:Revenues", end: "2026-09-30", value: 5e8, accn: filings[6].accn }],
  insiders: [{ accn: filings[6].accn, filed: "2026-10-20", owner: "Jane Doe", role: "CFO", date: "2026-10-18", code: "P", security: "Common", shares: 1000, price: 50, acquired: true, ownedAfter: 5000, direct: true, plan10b5: false, doc: "f4.xml" }],
  earningsReleases: [],
};

const dossier: Dossier = {
  ticker: "TEST",
  d,
  price: 52.1,
  priceDate: "2026-11-06",
  changePct: 1.2,
  screen: { ticker: "TEST", name: "Test Corp", sector: "Technology", industry: "Software", mcap: 5.2e9, ev: 5e9, pe: 30, pe_p5: 0.2, fcf_yield: 0.04, rev_g_q: 0.12, gm: 0.4, om: 0.2 },
  screenAsOf: "2026-11-04",
  estimates: { ticker: "TEST", next_earnings: "2027-01-30", consensus_as_of: null, eps_0q: 1.6, earnings: { date: "2027-01-30", is_estimate: false, call_date: null, eps: 1.6, revenue: null, provider: "Yahoo Finance", url: "https://finance.yahoo.com", last: { quarter_end: "2026-09-30", eps_actual: 1.55, eps_estimate: 1.5, surprise_pct: 0.033, beat: 1, report: { filed: "2026-10-30", accn: filings[7].accn, url: "" } } } },
  bars: Array.from({ length: 30 }, (_, i) => [`2026-10-${String(i + 1).padStart(2, "0")}`, 50, 51, 49, 50 + i * 0.1, 50 + i * 0.1, 1e6]),
  links: [
    { id: "1", ticker: "TEST", counterparty: "Big Customer Inc", counterparty_ticker: "BIG", counterparty_domain: null, relation: "customer", detail: "", share_pct: 22, quote: "Big Customer accounted for 22% of revenue.", accn: filings[7].accn, doc: "d7.htm", form: "10-K", filed: "2026-08-15" },
    { id: "2", ticker: "TEST", counterparty: "TSMC", counterparty_ticker: "TSM", counterparty_domain: null, relation: "supplier", detail: "Foundry", share_pct: null, quote: "We rely on TSMC as our sole foundry.", accn: filings[7].accn, doc: "d7.htm", form: "10-K", filed: "2026-08-15", single_source: true },
  ],
  alt: [{ dataset: "contracts", date: "2026-10-01", title: "Federal award $12M", value: 1.2e7, unit: "usd", source: "USAspending.gov", source_url: "https://usaspending.gov/x" }],
  generated: "2026-11-07T12:00:00Z",
};

describe("source register", () => {
  it("numbers each filing once and labels it", () => {
    const r = new SourceRegister("123", new Map(filings.map((f) => [f.accn, f])));
    expect(r.filing(filings[0].accn)).toBe(1);
    expect(r.dataset("x", "X")).toBe(2);
    expect(r.filing(filings[0].accn)).toBe(1);
    expect(r.list()[0].label).toContain("10-Q filed");
    expect(r.list()[0].url).toContain("/Archives/edgar/data/123/");
  });
  it("summarizes 90-day insider activity", () => {
    expect(insiderSummary(d, 90, "2026-11-07")).toMatchObject({ buys: 1, buyers: 1, buyValue: 50_000, sells: 0 });
  });
});

describe("deliverables", () => {
  it("builds a tear sheet PDF with sources", async () => {
    const r = await buildTearSheet(dossier, jsPDF);
    const head = new TextDecoder().decode((await bytesOf(r.blob)).slice(0, 5));
    expect(head).toBe("%PDF-");
    expect(r.sources).toBeGreaterThan(5);
    expect(r.pages).toBeGreaterThanOrEqual(1);
    expect(r.filename).toBe("TEST-tear-sheet-2026-11-07.pdf");
  });
  it("builds an IC fact base DOCX", async () => {
    const r = await buildMemoDocx(dossier);
    const bytes = await bytesOf(r.blob);
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe("PK");
    expect(r.sources).toBeGreaterThan(3);
  });
  it("builds the model workbook with notes, segments, IR KPIs and the formula list", async () => {
    const { wb, stats } = await buildModelWorkbook(d, {
      irKpis: [{ metric: "arr", label: "Annual recurring revenue", category: "kpi", breakdown: null, period_label: "Q3 2026", period_end: "2026-09-30", value: 1.1e9, unit: "usd", accn: filings[7].accn, doc: "ex99.htm", filed: "2026-10-30", document_kind: "press release", derived: false }],
    });
    expect(stats.layoutMismatch).toEqual([]);
    expect(stats.notes).toBeGreaterThan(30);
    expect(stats.segments).toBe(1);
    expect(stats.irKpis).toBe(1);
    expect(wb.getWorksheet("Inputs & formulas")).toBeTruthy();
    const inc = wb.getWorksheet("Income statement")!;
    const note = inc.getRow(7).getCell(3).note as unknown as { texts: { text: string }[] };
    expect(note.texts[0].text).toContain("Reported");
    expect(note.texts[0].text).toContain(filings[0].accn);
  });
  it("builds a deck from canvas views", async () => {
    const r = await buildDeck(
      [
        { type: "kpis", title: "Snapshot", items: [{ label: "Revenue", value: 1.2e9, unit: "$" }] },
        { type: "chart", title: "Revenue", chart: "bar", x: "q", series: ["rev"], data: [{ q: "Q1", rev: 1 }, { q: "Q2", rev: 2 }] },
        { type: "table", title: "Peers", columns: ["Ticker", "P/E"], rows: [["A", 10], ["B", 12]] },
        { type: "dashboard", title: "Dash", sections: [{ columns: 2, items: [{ type: "note", markdown: "**Hello** world" }, { type: "donut", parts: [{ label: "a", value: 1 }, { label: "b", value: 2 }] }] }] },
        { type: "heatmap", title: "Heat", rows: ["a"], cols: ["x", "y"], values: [[1, 2]] },
      ],
      { title: "Test deck" },
    );
    expect(r.slides).toBe(7);
    expect(r.native).toBe(2);
    expect(r.tables).toBe(2);
    const bytes = await bytesOf(r.blob);
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe("PK");
  });
});
