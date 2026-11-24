import { describe, expect, it } from "vitest";
import { edgarListUrl, listCoverage, liveToList, mergeFilings, scopeFilings, searchText, yearCount, yearTotals, type ListFiling } from "./list";

const f = (accn: string, form: string, filed: string, o: Partial<ListFiling> = {}): ListFiling => ({ accn, form, filed, doc: "d.htm", ...o });

describe("what the Filings tab covers", () => {
  const live = [liveToList({ accn: "L1", form: "4/A", filed: "2026-11-01", report: null, doc: "x.xml", description: null, items: null }), f("L2", "144", "2026-10-20"), f("L3", "144", "2026-10-02")];
  const record = [f("R1", "10-K", "2025-10-31"), f("L2", "144", "2026-10-20")];
  const insider = [f("L1", "4", "2026-11-01"), f("I1", "4", "2025-03-01"), f("I2", "4", "2024-06-01")];
  const rows = mergeFilings(live, record, insider);

  it("lists every live row, once, with the live form (4/A, not 4)", () => {
    expect(rows.map((r) => r.accn)).toEqual(["L1", "L2", "L3", "R1", "I1", "I2"]);
    expect(rows.find((r) => r.accn === "L1")?.form).toBe("4/A");
  });

  it("states the real window and what before it comes from the trade record only", () => {
    const c = listCoverage(rows, insider, "2026-09-24");
    expect(c).toEqual({ total: 6, first: "2024-06-01", last: "2026-11-01", liveSince: "2026-09-24", insiderBefore: 2, insiderFirst: "2024-06-01" });
  });

  it("links EDGAR's own list, by form and year", () => {
    expect(edgarListUrl("320193", { type: "4", year: 2025 })).toBe("https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000320193&owner=include&count=100&type=4&dateb=20251231");
  });

  it("counts a year across the whole list, not one page", () => {
    const t = yearTotals(rows);
    expect(t.get("2026")).toBe(3);
    expect(yearCount(1, t.get("2026"))).toBe("1 of 3");
    expect(yearCount(3, 3)).toBe("3");
  });

  it("does not match a year inside an accession number", () => {
    const old = f("0001628280-16-020258", "8-K", "2016-11-01", { items: "2.02" });
    expect(searchText(old)).not.toContain("2025");
    expect(scopeFilings([old], { kind: "all", year: null, q: "earnings 2025" })).toEqual([]);
  });
});
