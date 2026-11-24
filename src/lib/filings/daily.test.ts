import { describe, expect, it } from "vitest";
import { byImportance, familyCounts, feedRows, filterFeed, indexUrl, type FeedFiling } from "./daily";

// Real rows from sec_filings (2026-11-20 and 2026-11-23).
const r = (accn: string, ticker: string, cik: string, form: string, filed: string, items: string | null, doc: string, description: string | null): FeedFiling => ({ accn, ticker, cik, form, filed, report: null, items, doc, description });
const ROWS = [
  r("0001225208-26-009109", "NSC", "702165", "4", "2026-11-23", null, "xslF345X06/doc4.xml", null),
  r("0001225208-26-009110", "NSC", "702165", "4", "2026-11-23", null, "xslF345X06/doc4.xml", null),
  r("0001225208-26-009111", "NSC", "702165", "4", "2026-11-23", null, "xslF345X06/doc4.xml", null),
  r("0001959173-26-008210", "AMZN", "1018724", "144", "2026-11-23", null, "xsl144X01/primary_doc.xml", null),
  r("0001959173-26-008212", "AMZN", "1018724", "144/A", "2026-11-23", null, "xsl144X01/primary_doc.xml", null),
  r("0001535527-26-000035", "CRWD", "1535527", "8-K", "2026-11-23", "2.02,9.01", "crwd-20261123.htm", "8-K"),
  r("0001104659-26-130785", "CRWD", "1535527", "8-K", "2026-11-23", "1.01,7.01,9.01", "tm2630454d1_8k.htm", "FORM 8-K"),
  r("0000070145-26-000042", "NFG", "70145", "10-K", "2026-11-20", null, "nfg-20260930.htm", "10-K"),
  r("0001104659-26-130801", "ZS", "1713683", "425", "2026-11-23", null, "tm2630454d2_425.htm", "425"),
];

describe("filings feed rows", () => {
  it("folds same-day insider bursts by company and form, keeps every 8-K", () => {
    const rows = feedRows(ROWS);
    const nsc = rows.find((x) => x.ticker === "NSC")!;
    expect(nsc.filings).toHaveLength(3);
    expect(nsc.title).toBe("Insider transaction · 3 filings");
    // 144 and 144/A are different forms: two rows
    expect(rows.filter((x) => x.ticker === "AMZN")).toHaveLength(2);
    const crwd = rows.filter((x) => x.ticker === "CRWD");
    expect(crwd.map((x) => x.title).sort()).toEqual(["Earnings release", "Material agreement"]);
    expect(crwd.find((x) => x.title === "Material agreement")!.detail).toBe("Regulation FD disclosure");
    expect(rows).toHaveLength(7);
  });

  it("filters by family, sector, watchlist and words", () => {
    const rows = feedRows(ROWS);
    const sector = (t: string) => ({ NSC: "Industrials", AMZN: "Consumer Discretionary", CRWD: "Information Technology", NFG: "Utilities", ZS: "Information Technology" })[t];
    const name = (t: string) => ({ CRWD: "CrowdStrike", ZS: "Zscaler" })[t as "CRWD"];
    const base = { family: "all" as const, sector: "all", watch: false, q: "" };
    expect(filterFeed(rows, { ...base, family: "ownership" }, sector, name, new Set()).map((x) => x.ticker).sort()).toEqual(["AMZN", "AMZN", "NSC"]);
    expect(filterFeed(rows, { ...base, sector: "Information Technology" }, sector, name, new Set())).toHaveLength(3);
    expect(filterFeed(rows, { ...base, watch: true }, sector, name, new Set(["NFG"])).map((x) => x.ticker)).toEqual(["NFG"]);
    expect(filterFeed(rows, { ...base, q: "crowdstrike earnings" }, sector, name, new Set()).map((x) => x.title)).toEqual(["Earnings release"]);
    expect(filterFeed(rows, { ...base, q: "zs" }, sector, name, new Set()).map((x) => x.ticker)).toEqual(["ZS"]);
  });

  it("counts families and orders reports before insider forms", () => {
    const rows = feedRows(ROWS);
    expect(familyCounts(rows)).toMatchObject({ all: 7, ownership: 3, current: 2, periodic: 1, offerings: 1 });
    expect([...rows].sort(byImportance).map((x) => x.family)).toEqual(["periodic", "current", "current", "offerings", "ownership", "ownership", "ownership"]);
    expect(indexUrl("0000070145", "0000070145-26-000042")).toBe("https://www.sec.gov/Archives/edgar/data/70145/000007014526000042/0000070145-26-000042-index.htm");
  });
});
