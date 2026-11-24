import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hydrateDataset } from "@/lib/financials/dataset";
import type { CompanyDataset, EarningsRelease, Filing } from "@/lib/financials/types";
import { newerFilings } from "./staleness";

const filing = (form: string, filed: string, report?: string): Filing => ({ accn: `0000000000-26-${filed.replace(/-/g, "").slice(2)}`, form, filed, report, doc: `${form.toLowerCase()}.htm` });
const release = (filed: string): EarningsRelease => ({ accn: `0000000000-26-9${filed.replace(/-/g, "").slice(3)}`, filed, doc: "ex99.htm", title: "Results" });

describe("newerFilings", () => {
  it("lists a 10-K or 10-Q for a period after the latest in the statements", () => {
    const d = { filings: [filing("10-K", "2026-11-03", "2026-09-26"), filing("10-Q", "2026-07-31", "2026-06-27"), filing("8-K", "2026-10-20")], earningsReleases: [] };
    expect(newerFilings(d, "2026-06-27")).toEqual([{ accn: "0000000000-26-261103", doc: "10-k.htm", form: "10-K", filed: "2026-11-03", report: "2026-09-26", kind: "report" }]);
    expect(newerFilings(d, "2026-09-26")).toEqual([]);
    expect(newerFilings(d, null)).toEqual([]);
  });

  it("treats a period end a few days apart as the same period (52/53-week years)", () => {
    const d = { filings: [filing("10-Q", "2026-08-01", "2026-06-30")], earningsReleases: [] };
    expect(newerFilings(d, "2026-06-27")).toEqual([]);
  });

  it("lists an earnings release for a later quarter only while its report is not out", () => {
    // the release for the quarter itself (four weeks after its end) is not newer
    expect(newerFilings({ filings: [], earningsReleases: [release("2026-07-28")] }, "2026-06-30")).toEqual([]);
    // the next quarter's release is
    const next = newerFilings({ filings: [], earningsReleases: [release("2026-10-27"), release("2026-07-28")] }, "2026-06-30");
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ form: "8-K", filed: "2026-10-27", kind: "release" });
    // once the 10-Q for that quarter is listed, the release is not repeated
    const both = newerFilings({ filings: [filing("10-Q", "2026-11-02", "2026-09-30")], earningsReleases: [release("2026-10-27")] }, "2026-06-30");
    expect(both.map((f) => f.form)).toEqual(["10-Q"]);
  });

  it("finds the results a fixture's statements do not hold yet", () => {
    const of = (tk: string) => {
      const d = hydrateDataset(JSON.parse(readFileSync(path.resolve(__dirname, `../../test/fixtures/companies/${tk}.json`), "utf8")) as CompanyDataset);
      return newerFilings(d, d.statements.quarterly.income.periods.at(-1)!.end);
    };
    // Apple released its fiscal fourth quarter on 2 Nov 2026; the statements stop at the quarter ended 27 Jun 2026
    expect(of("AAPL")).toMatchObject([{ form: "8-K", filed: "2026-11-02", kind: "release" }]);
    // JPMorgan released the third quarter on 13 Oct 2026; the statements stop at 30 Jun 2026
    expect(of("JPM")).toMatchObject([{ form: "8-K", filed: "2026-10-13", kind: "release" }]);
    // NVIDIA, Microsoft and Bank of America: the newest report is in the statements
    for (const tk of ["NVDA", "MSFT", "BAC"]) expect(of(tk), tk).toEqual([]);
  });
});
