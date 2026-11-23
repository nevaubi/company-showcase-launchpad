import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { assessCurrency, dayLabel, filingCik, filingUrl } from "./currency";
import { hydrateDataset } from "./dataset";
import type { CompanyDataset, EarningsRelease, Filing, Period, Statement } from "./types";

const q = (key: string, end: string, fy: number, fq: number): Period => ({ key, label: key, fy, fq, end });
const st = (periods: Period[], accns: string[]): Statement => ({
  periods,
  rows: [{ key: "revenue", label: "Revenue", unit: "usd", kind: "reported", cells: periods.map((p, i) => ({ v: 1, src: { accn: accns[i], concept: "us-gaap:Revenues", end: p.end, value: 1 } })) }],
});

/** A December-year filer whose statements run through Q2 2026 (10-Q 0000000001-26-000002). */
function dataset(over: { filings?: Filing[]; releases?: EarningsRelease[]; cik?: string; quarters?: Period[]; years?: Period[]; qAccns?: string[]; aAccns?: string[] } = {}): CompanyDataset {
  const quarters = over.quarters ?? [q("FY2026Q1", "2026-03-31", 2026, 1), q("FY2026Q2", "2026-06-30", 2026, 2)];
  const years = over.years ?? [{ key: "FY2025", label: "FY2025", fy: 2025, end: "2025-12-31", start: "2025-01-01" }];
  const qa = over.qAccns ?? ["0000000001-26-000001", "0000000001-26-000002"];
  const aa = over.aAccns ?? ["0000000001-26-000000"];
  const Q = st(quarters, qa);
  const A = st(years, aa);
  return {
    generatedAt: "2026-08-10T00:00:00Z",
    profile: { ticker: "TEST", cik: over.cik ?? "0000000001", name: "Test", fiscalYearEnd: "1231" } as CompanyDataset["profile"],
    filings: over.filings ?? [
      { accn: "0000000001-26-000002", form: "10-Q", filed: "2026-08-05", report: "2026-06-30", doc: "q2.htm" },
      { accn: "0000000001-26-000001", form: "10-Q", filed: "2026-05-05", report: "2026-03-31", doc: "q1.htm" },
      { accn: "0000000001-26-000000", form: "10-K", filed: "2026-02-20", report: "2025-12-31", doc: "k.htm" },
    ],
    statements: {
      annual: { income: A, balance: { periods: years, rows: [] }, cashflow: { periods: years, rows: [] }, kpis: { periods: years, rows: [] } },
      quarterly: { income: Q, balance: { periods: quarters, rows: [] }, cashflow: { periods: quarters, rows: [] }, kpis: { periods: quarters, rows: [] } },
    },
    segments: [],
    insiders: [],
    earningsReleases: over.releases ?? [{ accn: "0000000001-26-000010", filed: "2026-07-28", doc: "ex99.htm", title: "Earnings release" }],
  };
}

describe("assessCurrency", () => {
  it("is current when the newest report is the one the statements cite", () => {
    const c = assessCurrency(dataset());
    expect(c.status).toBe("current");
    expect(c.newer).toEqual([]);
    expect(c.included?.accn).toBe("0000000001-26-000002");
    expect(c.text).toBe("Statements run through the quarter ended 30 Jun 2026. The latest report on file is the 10-Q filed on 5 Aug 2026.");
  });

  it("names a newer 10-Q with its period, filing date and link", () => {
    const d = dataset();
    d.filings = [{ accn: "0000000001-26-000003", form: "10-Q", filed: "2026-11-04", report: "2026-09-30", doc: "q3.htm" }, ...d.filings];
    const c = assessCurrency(d);
    expect(c.status).toBe("behind");
    expect(c.newer.map((n) => [n.kind, n.accn])).toEqual([["quarterly", "0000000001-26-000003"]]);
    expect(c.newer[0].url).toBe("https://www.sec.gov/Archives/edgar/data/1/000000000126000003/q3.htm");
    expect(c.text).toBe(
      "Statements run through the quarter ended 30 Jun 2026. A quarterly report (10-Q) for the quarter ended 30 Sep 2026 was filed on 4 Nov 2026 and is not in these tables yet.",
    );
  });

  it("flags an earnings release for the next quarter before its 10-Q is filed", () => {
    const d = dataset({ releases: [{ accn: "0000000001-26-000020", filed: "2026-10-27", doc: "ex99.htm", title: "r" }, { accn: "0000000001-26-000010", filed: "2026-07-28", doc: "ex99.htm", title: "r" }] });
    const c = assessCurrency(d);
    expect(c.status).toBe("behind");
    expect(c.newer.map((n) => n.kind)).toEqual(["release"]);
    expect(c.text).toContain("Results for the next period were released on 27 Oct 2026 (Form 8-K)");
  });

  it("does not count the release about the latest quarter, even when filed after the 10-Q", () => {
    // Same quarter: released 6 Aug (a day after the 10-Q) and only 37 days after the quarter ended.
    const c = assessCurrency(dataset({ releases: [{ accn: "0000000001-26-000011", filed: "2026-08-06", doc: "ex99.htm", title: "r" }] }));
    expect(c.status).toBe("current");
  });

  it("handles a fiscal year that does not end in December (52/53-week calendar)", () => {
    // Apple-like: FY ends late September; statements through Q3 FY26 (27 Jun 2026); 10-K for 26 Sep 2026 filed 3 Nov.
    const quarters = [q("FY2026Q2", "2026-03-28", 2026, 2), q("FY2026Q3", "2026-06-27", 2026, 3)];
    const years = [{ key: "FY2025", label: "FY2025", fy: 2025, start: "2024-09-29", end: "2025-09-27" }];
    const filings: Filing[] = [
      { accn: "0000320193-26-000026", form: "10-K", filed: "2026-11-03", report: "2026-09-26", doc: "aapl-20260926.htm" },
      { accn: "0000320193-26-000020", form: "10-Q", filed: "2026-07-31", report: "2026-06-27", doc: "aapl-20260627.htm" },
      { accn: "0000320193-26-000010", form: "10-Q", filed: "2026-05-01", report: "2026-03-28", doc: "aapl-20260328.htm" },
    ];
    const releases = [{ accn: "0000320193-26-000024", filed: "2026-11-02", doc: "ex99.htm", title: "r" }];
    const c = assessCurrency(dataset({ cik: "0000320193", quarters, years, filings, releases, qAccns: ["0000320193-26-000010", "0000320193-26-000020"], aAccns: ["0000320193-25-000079"] }));
    expect(c.status).toBe("behind");
    // The release (2 Nov) came before the 10-K (3 Nov), so only the annual report is named.
    expect(c.newer.map((n) => n.kind)).toEqual(["annual"]);
    expect(c.text).toBe(
      "Statements run through the quarter ended 27 Jun 2026. An annual report (10-K) for the year ended 26 Sep 2026 was filed on 3 Nov 2026 and is not in these tables yet.",
    );
    // A 10-Q whose period of report is a day off the statement end (53-week year) counts as included.
    const d2 = dataset({ cik: "0000320193", quarters, years, filings: filings.slice(1).map((f, i) => (i === 0 ? { ...f, report: "2026-06-28" } : f)), releases: [], qAccns: ["x", "y"], aAccns: ["z"] });
    expect(assessCurrency(d2).status).toBe("current");
  });

  it("links a new registrant's filing under the CIK that holds it (formerCiks)", () => {
    // XOM: statements from Exxon Mobil Corp (34088); the Q3 2026 10-Q was filed by ExxonMobil Holdings (2115436).
    const d = dataset({ cik: "0000034088", qAccns: ["0000034088-26-000020", "0000034088-26-000030"] });
    d.filings = [
      { accn: "0002115436-26-000012", form: "10-Q", filed: "2026-11-02", report: "2026-09-30", doc: "xom-20260930.htm" },
      { accn: "0000034088-26-000030", form: "10-Q", filed: "2026-08-03", report: "2026-06-30", doc: "q2.htm" },
    ];
    const c = assessCurrency(d, { ciks: ["2115436", "34088"] });
    expect(c.newer[0].url).toBe("https://www.sec.gov/Archives/edgar/data/2115436/000211543626000012/xom-20260930.htm");
    // Filed by an agent: a company with a former registrant files new reports under its current CIK.
    expect(filingCik("0001193125-26-000001", "0000034088", ["2115436", "34088"])).toBe("2115436");
    expect(filingCik("0000034088-26-000030", "0000034088", ["2115436", "34088"])).toBe("34088");
    expect(filingCik("0001193125-26-000001", "0000034088")).toBe("34088");
  });

  it("uses the filing date when SEC gives no period of report", () => {
    const d = dataset();
    d.filings = [{ accn: "0000000001-26-000003", form: "10-Q", filed: "2026-11-04", doc: "q3.htm" }, ...d.filings];
    const c = assessCurrency(d);
    expect(c.text).toContain("A newer 10-Q was filed on 4 Nov 2026 and is not in these tables yet.");
  });

  it("ignores amendments and reports for periods already in the tables", () => {
    const d = dataset();
    d.filings = [{ accn: "0000000001-26-000004", form: "10-Q/A", filed: "2026-09-01", report: "2026-09-30", doc: "a.htm" }, { accn: "0000000001-26-000005", form: "10-K", filed: "2026-09-02", report: "2025-12-31", doc: "k2.htm" }, ...d.filings];
    expect(assessCurrency(d).status).toBe("current");
  });

  it("reads the year end when the latest quarter is the fiscal fourth quarter", () => {
    const quarters = [q("FY2025Q4", "2025-12-31", 2025, 4)];
    const c = assessCurrency(dataset({ quarters, qAccns: ["0000000001-26-000000"], releases: [], filings: [{ accn: "0000000001-26-000000", form: "10-K", filed: "2026-02-20", report: "2025-12-31", doc: "k.htm" }] }));
    expect(c.text).toBe("Statements run through the fiscal year ended 31 Dec 2025. The latest report on file is the 10-K filed on 20 Feb 2026.");
  });
});

describe("assessCurrency on stored datasets", () => {
  const load = (t: string) => hydrateDataset(JSON.parse(readFileSync(`src/test/fixtures/companies/${t}.json`, "utf8")) as CompanyDataset);

  it("AAPL (built 3 Nov 2026) holds the 2 Nov release but not the 10-K filed later that day", () => {
    const d = load("AAPL");
    const before = assessCurrency(d);
    expect(before.newer.map((n) => [n.kind, n.filed])).toEqual([["release", "2026-11-02"]]);
    expect(before.text).toBe(
      "Statements run through the quarter ended 27 Jun 2026. Results for the next period were released on 2 Nov 2026 (Form 8-K); the tables add them from the 10-Q or 10-K once it is filed.",
    );
    d.filings = [{ accn: "0000320193-26-000026", form: "10-K", filed: "2026-11-03", report: "2026-09-26", doc: "aapl-20260926.htm" }, ...d.filings];
    const c = assessCurrency(d);
    expect(c.newer.map((n) => n.kind)).toEqual(["annual"]);
    expect(c.text).toMatch(/^Statements run through the quarter ended 27 Jun 2026\. An annual report \(10-K\) for the year ended 26 Sep 2026 was filed on 3 Nov 2026/);
  });

  it("C's statements stop at FY2025 although its 2026 10-Qs are in its filing list", () => {
    const c = assessCurrency(load("C"));
    expect(c.status).toBe("behind");
    expect(c.year?.end).toBe("2025-12-31");
    expect(c.newer.find((n) => n.kind === "quarterly")?.report).toBe("2026-06-30");
  });
});

describe("helpers", () => {
  it("formats days and URLs", () => {
    expect(dayLabel("2026-01-05")).toBe("5 Jan 2026");
    expect(filingUrl("0000320193", "0000320193-26-000026")).toBe("https://www.sec.gov/Archives/edgar/data/320193/000032019326000026/0000320193-26-000026-index.htm");
  });
});
