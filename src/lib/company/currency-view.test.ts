// Which statements feed the Overview's analysis, and which newer filings it still lists, on Apple's real fixture
// (statements through Q3 FY26) and the 10-K for FY26 filed 3 Nov 2026. The filing documents are reduced copies of
// the EDGAR primary documents the financials unit's preview reads (src/lib/company/fixtures/docs/, made by keeping
// the non-dimensional contexts, units and ix:nonFraction facts; extend.ts reads nothing else).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readPlan } from "@/components/financials/currency";
import { assessCurrency } from "@/lib/financials/currency";
import { hydrateDataset } from "@/lib/financials/dataset";
import { extendStatements } from "@/lib/financials/extend";
import type { CompanyDataset, Filing } from "@/lib/financials/types";
import { analyze } from "./analysis";
import { statementView, stillMissing } from "./currency-view";

const K26: Filing = { accn: "0000320193-26-000026", form: "10-K", filed: "2026-11-03", report: "2026-09-26", doc: "aapl-20260926.htm", ixbrl: true };
const DOCS: Record<string, string> = {
  "aapl-20260926.htm": "src/lib/company/fixtures/docs/aapl-20260926.reduced.htm",
  "aapl-20260627.htm": "src/lib/company/fixtures/docs/aapl-20260627.reduced.htm",
};

/** Apple as the app holds it: the served dataset plus the 10-K the sec job found since the rebuild. */
function apple(): CompanyDataset {
  const d = hydrateDataset(JSON.parse(readFileSync("src/test/fixtures/companies/AAPL.json", "utf8")) as CompanyDataset);
  return { ...d, filings: [K26, ...d.filings] };
}

function extended(d: CompanyDataset) {
  const plan = readPlan(d, assessCurrency(d));
  const ext = extendStatements(
    d,
    plan.map((f) => ({ filing: { accn: f.accn, form: f.form, filed: f.filed, report: f.report, doc: f.doc }, html: readFileSync(DOCS[f.doc], "utf8") })),
  );
  return { plan, ext };
}

const endOf = (d: CompanyDataset) => {
  const a = analyze(d);
  return a.quarter?.end ?? a.fiscalYear?.end ?? null;
};

describe("statementView: which dataset feeds the analysis", () => {
  const served = apple();
  const { plan, ext } = extended(served);

  it("plans the 10-K and the Q3 10-Q its fourth quarter needs", () => {
    expect(plan.map((f) => f.accn)).toEqual(["0000320193-26-000020", K26.accn]);
    expect(ext.added.map((a) => a.accn)).toEqual([K26.accn]);
    expect(ext.added[0].annual).toEqual(["FY2026"]);
    expect(ext.added[0].quarterly).toEqual(["FY2026Q4"]);
  });

  it("uses the served statements while reading and after a failed read", () => {
    expect(statementView(served, { extension: undefined, reading: true, failed: false }, plan)).toMatchObject({ dataset: served, state: "reading" });
    expect(statementView(served, { extension: undefined, reading: false, failed: true }, plan)).toMatchObject({ dataset: served, state: "failed" });
  });

  it("uses the extended statements once the read added a period, and the analysis moves to Q4 FY26", () => {
    const v = statementView(served, { extension: ext, reading: false, failed: false }, plan);
    expect(v.state).toBe("extended");
    expect(v.dataset).toBe(ext.dataset);
    const before = analyze(served);
    const after = analyze(v.dataset);
    expect(before.quarter?.label).toBe("Q3 FY26");
    expect(after.quarter?.label).toBe("Q4 FY26");
    expect(after.quarter?.end).toBe("2026-09-26");
    // TTM to Q4 equals the fiscal year the 10-K reports (four quarters ending 26 Sep 2026)
    const rev = after.keyFigures.find((k) => k.key === "revenue")!;
    const fyRev = v.dataset.statements.annual.income.rows.find((r) => r.key === "revenue")!.cells.at(-1)!.v;
    expect(rev.now!.v).toBeCloseTo(fyRev!, -6);
    // every part of the new figure cites a filing (click-to-source), the new quarter cites the 10-K
    expect(rev.now!.parts.every((p) => !!p.accn && !!p.concept)).toBe(true);
    expect(rev.now!.parts.some((p) => p.accn === K26.accn)).toBe(true);
  });

  it("keeps the served statements when no read is needed", () => {
    const current = ext.dataset;
    const none = readPlan(current, assessCurrency(current));
    expect(none).toEqual([]);
    expect(statementView(current, { extension: undefined, reading: false, failed: false }, none)).toMatchObject({ dataset: current, state: "served" });
  });

  it("keeps the served statements when the read added nothing", () => {
    const empty = { dataset: served, added: [] };
    expect(statementView(served, { extension: empty, reading: false, failed: false }, plan)).toMatchObject({ dataset: served, state: "served" });
  });
});

describe("stillMissing: which filings remain not yet included", () => {
  const served = apple();
  const { plan, ext } = extended(served);

  it("lists the 10-K before any read and after a failed read", () => {
    const failed = statementView(served, { extension: undefined, reading: false, failed: true }, plan);
    expect(stillMissing(failed, endOf(served)).map((f) => f.accn)).toEqual([K26.accn]);
    const none = statementView(served, { extension: undefined, reading: false, failed: false }, []);
    expect(stillMissing(none, endOf(served)).map((f) => f.accn)).toEqual([K26.accn]);
  });

  it("leaves out the filing being read, and the list is the same before and after the read lands", () => {
    const reading = statementView(served, { extension: undefined, reading: true, failed: false }, plan);
    const done = statementView(served, { extension: ext, reading: false, failed: false }, plan);
    const during = stillMissing(reading, endOf(served));
    const after = stillMissing(done, endOf(done.dataset), ext);
    expect(during).toEqual([]);
    expect(after).toEqual(during);
  });

  it("still lists a later report the extension did not cover", () => {
    const Q1: Filing = { accn: "0000320193-27-000001", form: "10-Q", filed: "2027-01-30", report: "2026-12-26", doc: "aapl-20261226.htm", ixbrl: true };
    const withQ1 = { ...ext.dataset, filings: [Q1, ...ext.dataset.filings] };
    const done = statementView(served, { extension: { ...ext, dataset: withQ1 }, reading: false, failed: false }, plan);
    expect(stillMissing(done, endOf(withQ1), ext).map((f) => f.accn)).toEqual([Q1.accn]);
  });
});
