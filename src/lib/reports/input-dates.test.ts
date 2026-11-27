import { expect, it } from "vitest";
import { normalizeEstimates } from "@/lib/estimates/core";
import type { Bar } from "@/lib/financials/types";
import { hasReportDate, reportBars, reportEstimates } from "./input-dates";

it("drops undated or invalid observations instead of assigning them another date", () => {
  const ok: Bar = ["2026-09-30", 2, 3, 1, 2, 2, 100];
  expect(reportBars([[null,2,3,1,2,2,100] as unknown as Bar,ok])).toEqual([ok]);
  expect(reportBars([])).toBeNull();
  expect(hasReportDate("2026-02-31")).toBe(false);
  const est = normalizeEstimates("BY", {}, "2026-11-27T04:30:02.151Z");
  const surprise = { quarter: "2026-09-30", actual: 0.85, estimate: 0.83, surprisePct: null };
  expect(reportEstimates({ ...est, surprises: [{ ...surprise, quarter: null as unknown as string }, surprise] }, "BY")?.surprises).toEqual([surprise]);
  expect(reportEstimates({ ...est, asOf: null as unknown as string }, "BY")).toBeNull();
  expect(reportEstimates(est, "MIAX")).toBeNull();
});

it("retains published nonzero EPS while excluding contradictory dispersion and missing revenue from reports", () => {
  const est = normalizeEstimates("AMG", { earningsTrend: { trend: [{ period: "+1q",
    earningsEstimate: { avg: 10.49, low: 10.49, high: 0, numberOfAnalysts: 0 },
    revenueEstimate: { avg: 0, low: 0, high: 0, numberOfAnalysts: 0, growth: -1 },
  }] } }, "2026-11-27");
  const [period] = reportEstimates(est, "AMG")!.periods;
  expect(period.eps).toMatchObject({ avg: 10.49, low: null, high: null, analysts: null });
  expect(period.revenue).toMatchObject({ avg: null, low: null, high: null, growth: null });
  expect(est.periods[0].eps.high).toBe(0);
});
