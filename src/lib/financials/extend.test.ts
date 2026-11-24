import { describe, expect, it } from "vitest";
import { buildStatements, type CompanyFacts, type RawFact } from "./build";
import { extendStatements, factsFromInline, inlineNumbers } from "./extend";
import type { CompanyDataset, Filing } from "./types";

const f = (start: string | undefined, end: string, val: number, form: string, filed: string, accn: string): RawFact => ({ start, end, val, form, filed, accn });
const K24 = "0000000001-25-000001";
const Q1 = "0000000001-25-000002";
const Q2 = "0000000001-25-000003";
const Q3 = "0000000001-25-000004";

/** Calendar-year filer through Q2 2025: what the scheduled build served. */
function served(): CompanyDataset {
  const cf: CompanyFacts = {
    facts: {
      "us-gaap": {
        Revenues: { units: { USD: [
          f("2024-01-01", "2024-12-31", 400, "10-K", "2025-02-01", K24),
          f("2025-01-01", "2025-03-31", 100, "10-Q", "2025-04-30", Q1),
          f("2025-04-01", "2025-06-30", 110, "10-Q", "2025-07-30", Q2),
          f("2025-01-01", "2025-06-30", 210, "10-Q", "2025-07-30", Q2),
        ] } },
        NetCashProvidedByUsedInOperatingActivities: { units: { USD: [
          f("2024-01-01", "2024-12-31", 90, "10-K", "2025-02-01", K24),
          f("2025-01-01", "2025-03-31", 20, "10-Q", "2025-04-30", Q1),
          f("2025-01-01", "2025-06-30", 45, "10-Q", "2025-07-30", Q2),
        ] } },
        Assets: { units: { USD: [f(undefined, "2024-12-31", 1000, "10-K", "2025-02-01", K24), f(undefined, "2025-06-30", 1100, "10-Q", "2025-07-30", Q2)] } },
      },
    },
  };
  const filings: Filing[] = [
    { accn: Q2, form: "10-Q", filed: "2025-07-30", report: "2025-06-30", doc: "q2.htm" },
    { accn: Q1, form: "10-Q", filed: "2025-04-30", report: "2025-03-31", doc: "q1.htm" },
    { accn: K24, form: "10-K", filed: "2025-02-01", report: "2024-12-31", doc: "k.htm" },
  ];
  return {
    generatedAt: "2025-08-01T00:00:00Z",
    profile: { ticker: "TEST", cik: "0000000001", industry: "Software" } as CompanyDataset["profile"],
    filings,
    statements: buildStatements(cf),
    segments: [],
    insiders: [],
    earningsReleases: [],
  };
}

const ctx = (id: string, period: string, dims = "") =>
  `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">0000000001</xbrli:identifier>${dims ? `<xbrli:segment>${dims}</xbrli:segment>` : ""}</xbrli:entity><xbrli:period>${period}</xbrli:period></xbrli:context>`;
const dur = (s: string, e: string) => `<xbrli:startDate>${s}</xbrli:startDate><xbrli:endDate>${e}</xbrli:endDate>`;
const num = (name: string, c: string, text: string, extra = "") => `<ix:nonFraction unitRef="usd" contextRef="${c}" name="${name}" decimals="-6" scale="0"${extra}>${text}</ix:nonFraction>`;

/** The Q3 2025 10-Q's inline XBRL: three months, nine months, a balance, a segment fact, a nested tag. */
const Q3_HTML = `<html><body><ix:header><ix:resources>
${ctx("q3", dur("2025-07-01", "2025-09-30"))}${ctx("ytd", dur("2025-01-01", "2025-09-30"))}${ctx("bs", "<xbrli:instant>2025-09-30</xbrli:instant>")}
${ctx("seg", dur("2025-07-01", "2025-09-30"), '<xbrldi:explicitMember dimension="us-gaap:StatementBusinessSegmentsAxis">x:CloudMember</xbrldi:explicitMember>')}
<xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>
</ix:resources></ix:header>
<table><tr><td>Revenue</td><td>${num("us-gaap:Revenues", "q3", "125")}</td><td>${num("us-gaap:Revenues", "ytd", "335")}</td></tr>
<tr><td>Cloud</td><td>${num("us-gaap:Revenues", "seg", "60")}</td></tr>
<tr><td>Cash from operations</td><td>${num("us-gaap:NetCashProvidedByUsedInOperatingActivities", "ytd", "75")}</td></tr>
<tr><td>Total assets</td><td>${num("us-gaap:LiabilitiesAndStockholdersEquity", "bs", num("us-gaap:Assets", "bs", "1,180"))}</td></tr></table></body></html>`;
const Q3_FILING = { accn: Q3, form: "10-Q", filed: "2025-10-30", report: "2025-09-30", doc: "q3.htm" };

describe("extendStatements", () => {
  it("adds the quarter a newer 10-Q reports, every value sourced to that filing", () => {
    const d = served();
    const { dataset, added } = extendStatements(d, [{ filing: Q3_FILING, html: Q3_HTML }]);
    expect(added).toEqual([{ accn: Q3, form: "10-Q", filed: "2025-10-30", annual: [], quarterly: ["FY2025Q3"] }]);
    const q = dataset.statements.quarterly;
    const i = q.income.periods.findIndex((p) => p.key === "FY2025Q3");
    expect(i).toBe(q.income.periods.length - 1);
    expect((q.income.periods[i] as { readFrom?: { accn: string } }).readFrom?.accn).toBe(Q3);
    const rev = q.income.rows.find((r) => r.key === "revenue")!.cells[i]!;
    expect(rev.v).toBe(125); // the three-month fact, not the segment member (60) or nine months
    expect(rev.src).toMatchObject({ accn: Q3, concept: "us-gaap:Revenues", start: "2025-07-01", end: "2025-09-30" });
    // Cash flow is year to date in a 10-Q: Q3 = 9M (this filing) − 6M (the Q2 10-Q, kept in the served cell's parts).
    const cfo = q.cashflow.rows.find((r) => r.key === "cfo")!.cells[i]!;
    expect(cfo.v).toBe(30);
    expect(cfo.derived?.parts.map((p) => [p.accn, p.value, p.sign])).toEqual([[Q3, 75, 1], [Q2, 45, -1]]);
    // A nested tag (Assets inside LiabilitiesAndStockholdersEquity) is read.
    expect(q.balance.rows.find((r) => r.key === "totalAssets")!.cells[i]!.v).toBe(1180);
    // KPIs follow the new column.
    expect(q.kpis.periods.at(-1)?.key).toBe("FY2025Q3");
  });

  it("leaves the served columns untouched", () => {
    const d = served();
    const { dataset } = extendStatements(d, [{ filing: Q3_FILING, html: Q3_HTML }]);
    const before = d.statements.quarterly.income;
    const after = dataset.statements.quarterly.income;
    for (const row of before.rows) expect(after.rows.find((r) => r.key === row.key)!.cells.slice(0, before.periods.length)).toEqual(row.cells);
  });

  it("ignores a filing that adds no later period", () => {
    const d = served();
    const old = { accn: Q2, form: "10-Q", filed: "2025-07-30", report: "2025-06-30", doc: "q2.htm" };
    const html = Q3_HTML.replace(/2025-09-30/g, "2025-06-30").replace(/2025-07-01/g, "2025-04-01");
    const r = extendStatements(d, [{ filing: old, html }]);
    expect(r.added).toEqual([]);
    expect(r.dataset.statements).toBe(d.statements);
  });

  it("reads nested and dimensional tags correctly", () => {
    const facts = inlineNumbers(Q3_HTML);
    expect(facts.filter((x) => x.concept === "us-gaap:Assets").map((x) => x.value)).toEqual([1180]);
    const cf = factsFromInline(Q3_HTML, Q3_FILING);
    expect(cf.facts["us-gaap"].Revenues.units.USD.map((x) => x.val).sort((a, b) => a - b)).toEqual([125, 335]);
  });
});

describe("factsFromInline precision", () => {
  it("keeps the most precise of two tags for the same figure", () => {
    const html = `${ctx("q", dur("2025-07-01", "2025-09-30"))}<xbrli:unit id="shares"><xbrli:measure>xbrli:shares</xbrli:measure></xbrli:unit>
      <ix:nonFraction unitRef="shares" contextRef="q" name="us-gaap:WeightedAverageNumberOfDilutedSharesOutstanding" decimals="-6" scale="6">395</ix:nonFraction>
      <ix:nonFraction unitRef="shares" contextRef="q" name="us-gaap:WeightedAverageNumberOfDilutedSharesOutstanding" decimals="-5" scale="6">395.5</ix:nonFraction>`;
    const cf = factsFromInline(html, Q3_FILING);
    expect(cf.facts["us-gaap"].WeightedAverageNumberOfDilutedSharesOutstanding.units.shares.map((x) => x.val)).toEqual([395_500_000]);
  });
});

// Real filings: JPMorgan served through Q3 2025, its FY2025 10-K read at view time with the Q3 2025
// 10-Q. The documents are 12.9 MB and 11.5 MB on EDGAR; the fixtures keep what extend.ts reads from
// them (contexts without dimensions, units and the tagged numbers that use those contexts), and give
// the same statements as the full documents.
import { readFileSync } from "node:fs";
import { hydrateDataset } from "./dataset";
import type { Statement } from "./types";
const JPM_K = "src/lib/financials/fixtures/docs/jpm-20251231.reduced.htm";
const JPM_Q3 = "src/lib/financials/fixtures/docs/jpm-20250930.reduced.htm";
describe("JPMorgan 10-K read at view time", () => {
  const full = hydrateDataset(JSON.parse(readFileSync("src/test/fixtures/companies/JPM.json", "utf8")) as CompanyDataset);
  const cut = (s: Statement, end: string): Statement => {
    const n = s.periods.filter((p) => p.end <= end).length;
    return { periods: s.periods.slice(0, n), rows: s.rows.map((r) => ({ ...r, cells: r.cells.slice(0, n) })) };
  };
  const servedThroughQ3 = (filings: Filing[]): CompanyDataset => ({
    ...full,
    filings,
    statements: {
      annual: Object.fromEntries(Object.entries(full.statements.annual).map(([k, s]) => [k, cut(s, "2024-12-31")])) as CompanyDataset["statements"]["annual"],
      quarterly: Object.fromEntries(Object.entries(full.statements.quarterly).map(([k, s]) => [k, cut(s, "2025-09-30")])) as CompanyDataset["statements"]["quarterly"],
    },
  });
  const k = full.filings.find((f) => f.accn === "0001628280-26-008131")!;
  const q3 = full.filings.find((f) => f.accn === "0001628280-25-048859")!;
  const reads = [
    { filing: q3, html: readFileSync(JPM_Q3, "utf8") },
    { filing: k, html: readFileSync(JPM_K, "utf8") },
  ];

  for (const [name, filings] of [
    ["with its full filing list", full.filings.filter((f) => f.accn !== k.accn)],
    // The served cells for Q1 to Q3 2025 cite later 10-Qs (latest filing to disclose them); a list
    // that lacks those accessions used to drop the facts, so the year's quarters could not be placed.
    ["with a filing list that lacks the accessions its cells cite", full.filings.filter((f) => f.filed < "2026-02-13")],
  ] as const)
    it(`adds FY2025 and its derived fourth quarter (${name})`, () => {
      const ext = extendStatements(servedThroughQ3([...filings]), reads);
      expect(ext.added.map((a) => [a.form, a.annual, a.quarterly])).toEqual([["10-K", ["FY2025"], ["FY2025Q4"]]]);
      const inc = ext.dataset.statements.quarterly.income;
      const i = inc.periods.findIndex((p) => p.key === "FY2025Q4");
      const nii = inc.rows.find((r) => r.key === "netInterestIncome")!.cells[i]!;
      // Same figure and rule as the scheduled build: FY2025 less the nine months to 30 Sep 2025.
      const built = full.statements.quarterly.income;
      expect(nii.v).toBe(built.rows.find((r) => r.key === "netInterestIncome")!.cells[built.periods.findIndex((p) => p.key === "FY2025Q4")]!.v);
      expect(nii.derived?.parts.map((p) => p.accn).sort()).toEqual([q3.accn, k.accn].sort());
    });
});
