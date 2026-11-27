import { describe, expect, it } from "vitest";
import { buildPayload } from "./payload";
import { tidyPayload } from "./tidy";
import { isPeriodComparison } from "./comparison-column";

describe("comparison columns in earnings presentation quotes", () => {
  const q =
    "Expense of $648mm, up $98mm YoY $ O/(U) 4Q25 3Q25 4Q24 Revenue $1,480 ($223) ($520) Net interest income 1,568 162 (462) Noninterest revenue (88) (385) (58)";
  it("recognizes decreases and increases without treating the quarter's actual revenue as a change", () => {
    expect(isPeriodComparison(q, "Corporate — Revenue", 223e6, "usd")).toBe(true);
    expect(isPeriodComparison(q, "Corporate — Revenue", -520e6, "usd")).toBe(true);
    expect(isPeriodComparison(q, "Net interest income", 162e6, "usd")).toBe(true);
    expect(isPeriodComparison(q, "Revenue", 1480e6, "usd")).toBe(false);
  });
  it("keeps original reported levels in new builds and holds the misread amount in previously stored payloads", () => {
    const date = "2025-09-30";
    const good = {
      category: "kpi",
      metric: "revenue",
      parent: null,
      label: "Corporate — Revenue",
      is_total: false,
      period_start: "2025-07-01",
      period_end: date,
      months: 3,
      value: 1703e6,
      unit: "usd",
      accn: "0001628280-25-044845",
      doc: "a3q25erfex992supplement.htm",
      filed: "2025-10-14",
      document_kind: "supplement",
      document_id: "supp",
      locator: { t: 23, r: 16, c: 1, text: "1,703" },
    };
    const change = {
      ...good,
      value: 223e6,
      doc: "a4q25_earningsxpresentat.htm",
      document_kind: "presentation",
      document_id: "slides",
      filed: "2026-01-13",
      locator: { q, text: "$223" },
    };
    const p = buildPayload("JPM", [good, change]);
    expect(p.series.flatMap((s) => Object.values(s.q).map((c) => c.v))).toEqual([1703e6]);
    const current = p.series[0];
    const before = {
      ...p,
      tidy: 13,
      series: [{ ...current, q: { [date]: { v: 223e6, x: q, d: 0, e: date, m: 3 } } }],
    };
    const after = tidyPayload(before);
    expect(after.series[0].q[date]).toBeUndefined();
    expect(after.series[0].held?.q?.[date]?.why).toContain("change versus");
    expect(change.value).toBe(223e6);
  });

  it("retains genuine levels, explicitly labeled change measures, and ambiguous repeated values", () => {
    expect(isPeriodComparison(q.replace("O/(U)", "Trends"), "Revenue", 223e6, "usd")).toBe(false);
    expect(
      isPeriodComparison(q.replace("Revenue $1,480", "Revenue ($223)"), "Revenue", 223e6, "usd"),
    ).toBe(false);
    expect(
      isPeriodComparison(
        q.replace("Revenue $1,480", "Revenue growth $1,480"),
        "Revenue growth",
        223e6,
        "usd",
      ),
    ).toBe(false);
  });
});
