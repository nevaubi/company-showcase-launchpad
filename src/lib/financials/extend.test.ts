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
