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
import type { Surprise } from "@/lib/estimates/core";
import type { Reaction } from "@/lib/markets/core";
import { isDerivedQuarter, latestFigures, nextQuarterLabel, readFromOf, resultsModel, resultsReadNote } from "./results-view";

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

describe("latestFigures: every EPS-vs-the-Street and reaction figure names its quarter (p5-shots M1)", () => {
  const served = apple();
  const plan = readPlan(served, assessCurrency(served));
  const ext = extendStatements(
    served,
    plan.map((f) => ({ filing: { accn: f.accn, form: f.form, filed: f.filed, report: f.report, doc: f.doc }, html: readFileSync(DOCS[f.doc], "utf8") })),
  );
  // the provider's records for Q3 FY26 (quarter ended 27 Jun 2026) and Q4 FY26 (26 Sep 2026), as in the review's shot
  const surprises: Surprise[] = [
    { quarter: "2026-06-30", actual: 2.02, estimate: 1.89, surprisePct: 0.067 },
    { quarter: "2026-09-30", actual: 2.1, estimate: 1.98, surprisePct: 0.058 },
  ];
  const base = resultsModel(served, { extension: undefined, reading: false, failed: true }, plan);
  const q3Release = base.latest!.release!.filed.slice(0, 10);
  const q4Release = base.pending!.release.filed.slice(0, 10);
  const r = (date: string, move: number): Reaction => ({ date, accn: "", doc: "", move, excess: null, gap: 0, preRun: null, drift5: null, drift20: null, volRatio: null, sigma: null });
  const reactions = [r(q3Release, -0.087), r(q4Release, -0.038)];

  it("read failed: the side tiles are Q3 FY26, the release figures Q4 FY26, and one line says why", () => {
    const m = resultsModel(served, { extension: undefined, reading: false, failed: true }, plan, { surprises, reactions });
    const f = latestFigures(m.latest!, m.pending);
    expect(f.side.label).toBe("Q3 FY26");
    expect(f.side.surprise?.actual).toBe(2.02);
    expect(f.side.reaction?.move).toBe(-0.087);
    expect(f.release?.label).toBe("Q4 FY26");
    expect(f.release?.surprise?.actual).toBe(2.1);
    expect(f.release?.reaction?.move).toBe(-0.038);
    expect(f.why).toBe(
      "The figures above are Q4 FY26, from the newest release; the table and the tiles beside it are Q3 FY26, the newest quarter in the filed statements.",
    );
  });

  it("read succeeded: one quarter, Q4 FY26, with its own consensus and reaction, and no second set", () => {
    const m = resultsModel(served, { extension: ext, reading: false, failed: false }, plan, { surprises, reactions });
    const f = latestFigures(m.latest!, m.pending);
    expect(f.side.label).toBe("Q4 FY26");
    expect(f.side.surprise?.actual).toBe(2.1);
    expect(f.side.reaction?.move).toBe(-0.038);
    expect(f.release).toBeNull();
    expect(f.why).toBeNull();
  });

  it("names the next fiscal quarter across a year end", () => {
    expect(nextQuarterLabel({ key: "Q4", label: "Q4 FY26", fy: 2026, fq: 4, end: "2026-09-26" })).toBe("Q1 FY27");
    expect(nextQuarterLabel({ key: "Q2", label: "Q2 FY26", fy: 2026, fq: 2, end: "2026-03-28" })).toBe("Q3 FY26");
    expect(nextQuarterLabel({ key: "FY", label: "FY2026", fy: 2026, end: "2026-09-26" })).toBeNull();
  });
});
