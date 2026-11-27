import { describe, expect, it } from "vitest";
import { buildStatements, type CompanyFacts } from "./build";
import { factsFromInline } from "./extend";
import { accessionsInFacts, filingsMissingFromFacts, mergeFactsInto } from "./ingest-facts";
import pld from "./fixtures/dps-opex-pld-facts.json";
// Verbatim excerpt of Prologis' 10-Q for Q3 2026, which SEC's company facts do not carry.
import html from "./fixtures/inline-pld-q3.htm?raw";

// Prologis' periodic filings as SEC's submissions list them (26 Nov 2026).
const FILINGS = [
  { accn: "0001193125-26-436160", form: "10-Q", filed: "2026-10-28", ixbrl: true, doc: "pld-20260930.htm" },
  { accn: "0001193125-26-323746", form: "10-Q", filed: "2026-07-29", ixbrl: true, doc: "pld-20260630.htm" },
  { accn: "0001193125-26-051453", form: "10-K", filed: "2026-02-13", ixbrl: true, doc: "pld-20251231.htm" },
];

describe("filings company facts lack (finaud-01)", () => {
  it("finds Prologis' two newest 10-Qs, which have no fact in company facts", () => {
    const cf = pld as CompanyFacts;
    expect(accessionsInFacts(cf).has("0001193125-26-051453")).toBe(true);
    expect(filingsMissingFromFacts(FILINGS, cf, "2026-11-26").map((f) => f.accn)).toEqual(["0001193125-26-436160", "0001193125-26-323746"]);
  });

  it("builds the Q3 2026 column from the filing's own inline XBRL once merged", () => {
    const cf = structuredClone(pld) as CompanyFacts;
    expect(buildStatements(cf).quarterly.income.periods.some((p) => p.label === "Q3 FY26")).toBe(false);
    mergeFactsInto(cf, factsFromInline(html, FILINGS[0]));
    const inc = buildStatements(cf).quarterly.income;
    const i = inc.periods.findIndex((p) => p.label === "Q3 FY26");
    expect(i).toBeGreaterThanOrEqual(0);
    // Statement of income, $ thousands: total revenues 2,387,518; operating income 1,044,720.
    const rev = inc.rows.find((r) => r.key === "revenue")!.cells[i]!;
    expect(rev.v).toBe(2_387_518_000);
    expect(rev.src?.accn).toBe("0001193125-26-436160");
    expect(inc.rows.find((r) => r.key === "operatingIncome")!.cells[i]!.v).toBe(1_044_720_000);
  });

  it("keeps a fact already in the set once", () => {
    const cf = structuredClone(pld) as CompanyFacts;
    const n = (cf.facts["us-gaap"].Revenues.units.USD ?? []).length;
    mergeFactsInto(cf, structuredClone(pld) as CompanyFacts);
    expect(cf.facts["us-gaap"].Revenues.units.USD.length).toBe(n);
  });
});
