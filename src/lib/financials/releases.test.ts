import { describe, expect, it } from "vitest";
import { withFiledReleases } from "./releases";
import { dataVersionOf } from "@/lib/reports/facts";
import type { CompanyDataset } from "./types";
const base = (filings: object[]) => ({ filings, earningsReleases: [{ accn: "old", filed: "2026-08-01", doc: "ex99.htm", title: "Q2" }] }) as unknown as CompanyDataset;
describe("report data version keys on the latest filed earnings 8-K", () => {
  it("a newly discovered 2.02 8-K becomes the latest release and changes the version", () => {
    const d = base([{ accn: "new", form: "8-K", filed: "2026-11-18", doc: "a.htm", items: "2.02,9.01" }]);
    const merged = withFiledReleases(d);
    expect(merged.earningsReleases[0].accn).toBe("new");
    expect(dataVersionOf(merged, "2026-11-19").split("|")[1]).toBe("new");
  });
  it("ignores 8-Ks without item 2.02 and older ones", () => {
    const d = base([{ accn: "x", form: "8-K", filed: "2026-11-18", doc: "a.htm", items: "7.01" }, { accn: "y", form: "8-K", filed: "2026-07-01", doc: "b.htm", items: "2.02" }]);
    expect(withFiledReleases(d).earningsReleases.map((r) => r.accn)).toEqual(["old"]);
  });
});
