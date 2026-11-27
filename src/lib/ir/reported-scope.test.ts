import { describe, expect, it } from "vitest";
import {
  isReportedMeasure,
  projectedMeasure,
  reportedChartAudit,
  scenarioDocument,
} from "./reported-scope";
import { planDocuments, type PlanDocRow } from "./doc-plan";

const doc = (
  id: string,
  title: string,
  source_url = "https://www.wellsfargo.com/ir.pdf",
): PlanDocRow => ({
  id,
  title,
  source_url,
  kind: "press-release",
  ext: "pdf",
  filed: null,
  period: null,
  extract_facts: 28,
});
describe("bank reporting scope", () => {
  it("retains source documents while selecting reported results from undated issuer PDFs", () => {
    const library = [
      doc("2026", "2026 Annual Company-Run Stress Test Results (PDF)"),
      doc(
        "2022",
        "Issuer disclosure",
        "https://www.wellsfargo.com/assets/pdf/about/investor-relations/stress-test-results/2022-annual-stress-test.pdf",
      ),
      doc("earn", "First quarter 2026 earnings"),
      doc("investor", "April investor presentation"),
    ];
    const plan = planDocuments(library);
    expect(plan.load.sort()).toEqual(["earn", "investor"]);
    expect(plan.counts.left.scenario).toBe(2);
    expect(library).toHaveLength(4);
    expect(
      scenarioDocument(doc("ordinary", "Quarterly earnings release mentions stress test results")),
    ).toBe(false);
  });
  it("retains FY25 reported ROTCE and excludes April's explicitly hypothetical target as a figure", () => {
    expect(
      isReportedMeasure({
        label: "Return on average tangible common equity",
        breakdown: "FY2025 financial performance",
        locator: { text: "14.61%" },
      }),
    ).toBe(true);
    expect(
      isReportedMeasure({
        label: "ROTCE",
        locator: { q: "Targeting a 17–18% ROTCE over the medium-term" },
      }),
    ).toBe(false);
    expect(
      isReportedMeasure({
        label: "CET1 Ratio",
        breakdown: "Company pro forma stressed capital ratio projections",
      }),
    ).toBe(false);
    expect(
      isReportedMeasure({
        label: "Retail bank household cross-sell",
        value: 5.73,
        locator: {
          q: "Record retail bank household cross-sell of 5.73 products per household, 24 percent of our retail bank households had 8 or more products, our long-term goal",
        },
      }),
    ).toBe(true);
    expect(
      isReportedMeasure({
        label: "ROTCE",
        value: 14.61,
        locator: {
          q: "Reported ROTCE was 14.61%, targeting a 17–18% return over the medium-term.",
        },
      }),
    ).toBe(true);
    expect(
      isReportedMeasure({
        label: "ROTCE",
        value: 18,
        locator: {
          q: "Reported ROTCE was 14.61%, targeting a 17–18% return over the medium-term.",
        },
      }),
    ).toBe(false);
    expect(projectedMeasure("Increased target market share")).toBe(false);
    expect(
      reportedChartAudit(
        {
          docs: [{ id: "stress" }, { id: "earn" }],
          series: [
            { label: "CET1", bd: "Pro forma stressed capital ratio projections" },
            { label: "Historical ROTCE" },
          ],
        },
        new Set(["stress"]),
      ),
    ).toEqual({ scenarioSources: ["stress"], projectionSeries: 1 });
  });
});
