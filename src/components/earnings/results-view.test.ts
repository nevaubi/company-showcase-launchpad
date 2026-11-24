// Which quarter the Earnings tab's Results sections show, on Apple's real fixture (statements through Q3 FY26,
// release of 2 Nov 2026 not yet in them) and the reduced copy of the FY26 10-K filed on 3 Nov 2026
// (src/lib/company/fixtures/docs/, the same documents the Overview's tests read).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readPlan } from "@/components/financials/currency";
import { assessCurrency } from "@/lib/financials/currency";
import { hydrateDataset } from "@/lib/financials/dataset";
import { extendStatements } from "@/lib/financials/extend";
import type { CompanyDataset, Filing } from "@/lib/financials/types";
import { isDerivedQuarter, readFromOf, resultsModel, resultsReadNote } from "./results-view";

const K26: Filing = { accn: "0000320193-26-000026", form: "10-K", filed: "2026-11-03", report: "2026-09-26", doc: "aapl-20260926.htm", ixbrl: true };
const DOCS: Record<string, string> = {
  "aapl-20260926.htm": "src/lib/company/fixtures/docs/aapl-20260926.reduced.htm",
  "aapl-20260627.htm": "src/lib/company/fixtures/docs/aapl-20260627.reduced.htm",
};

function apple(): CompanyDataset {
  const d = hydrateDataset(JSON.parse(readFileSync("src/test/fixtures/companies/AAPL.json", "utf8")) as CompanyDataset);
  return { ...d, filings: [K26, ...d.filings] };
}

describe("resultsModel: the Results tab's latest quarter", () => {
  const served = apple();
  const plan = readPlan(served, assessCurrency(served));
  const ext = extendStatements(
    served,
    plan.map((f) => ({ filing: { accn: f.accn, form: f.form, filed: f.filed, report: f.report, doc: f.doc }, html: readFileSync(DOCS[f.doc], "utf8") })),
  );

  it("shows Q3 FY26 with the newer release pending while the 10-K is read", () => {
    const m = resultsModel(served, { extension: undefined, reading: true, failed: false }, plan);
    expect(m.state).toBe("reading");
    expect(m.latest?.period.label).toBe("Q3 FY26");
    expect(m.pending?.release.filed.slice(0, 10)).toBe("2026-11-02");
    expect(resultsReadNote(m)).toBe("Reading the 10-K filed on Nov 3, 2026 from SEC.");
  });

  it("moves to Q4 FY26 once the 10-K read lands: marked as read at view time, derived, no pending release", () => {
    const m = resultsModel(served, { extension: ext, reading: false, failed: false }, plan);
    expect(m.state).toBe("extended");
    expect(m.latest?.period.label).toBe("Q4 FY26");
    expect(m.latest?.period.end).toBe("2026-09-26");
    expect(readFromOf(m.latest?.period)?.accn).toBe(K26.accn);
    expect(isDerivedQuarter(m.latest?.period)).toBe(true);
    // the 2 Nov release is now the Q4 quarter's own release, so nothing is pending
    expect(m.latest?.release?.filed.slice(0, 10)).toBe("2026-11-02");
    expect(m.pending).toBeNull();
    // Q4 revenue is the fiscal year less the first nine months, every part sourced
    const fy = ext.dataset.statements.annual.income.rows.find((r) => r.key === "revenue")!.cells.at(-1)!.v;
    const nine = m.records.filter((r) => r.period.fy === 2026 && r.period.fq! < 4).reduce((s, r) => s + r.revenue!.v, 0);
    expect(m.latest!.revenue!.v).toBeCloseTo(fy - nine, -3);
    expect(m.recent[1].period.label).toBe("Q3 FY26");
    expect(m.recent.length).toBeLessThanOrEqual(12);
    expect(resultsReadNote(m)).toBe(
      "Q4 FY26 is read at view time from the 10-K filed on Nov 3, 2026; the scheduled rebuild has not added it yet. A 10-K states the full year, so Q4 FY26 is derived: the year less the first nine months.",
    );
  });

  it("keeps Q3 FY26 and says so when the read fails", () => {
    const m = resultsModel(served, { extension: undefined, reading: false, failed: true }, plan);
    expect(m.latest?.period.label).toBe("Q3 FY26");
    expect(m.pending).not.toBeNull();
    expect(resultsReadNote(m)).toBe("The 10-K filed on Nov 3, 2026 could not be read here; the scheduled rebuild will add it.");
  });

  it("says nothing when the served statements are current", () => {
    const d = hydrateDataset(JSON.parse(readFileSync("src/test/fixtures/companies/AAPL.json", "utf8")) as CompanyDataset);
    const m = resultsModel(d, { extension: undefined, reading: false, failed: false }, []);
    expect(m.state).toBe("served");
    expect(resultsReadNote(m)).toBeNull();
  });
});
