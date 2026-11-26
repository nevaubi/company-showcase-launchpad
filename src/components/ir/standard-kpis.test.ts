import { describe, expect, it } from "vitest";
import { fmtChange, fmtStd, standardRows } from "./standard-kpis";

// Shapes of the pipeline's kpistd files (kpistd/t/T.json, latest.json, taxonomy.json), values made up for the arithmetic.
const point = (end: string, v: number, label: string) =>
  [end, v, label, "d1", 3, `ROE ${v}%`, null, null, null, v] as [
    string,
    number,
    string,
    string,
    number,
    string,
    null,
    null,
    null,
    number,
  ];
const co = {
  ticker: "AAA",
  sector: "Financials",
  industry: "Banks",
  docs: { d1: ["Supplement", "p", ".htm", "https://www.sec.gov/x.htm", "supplement", "Q3", null] },
  series: {
    roe: {
      kpi_id: "k1",
      name: "Return on common equity (ROE)",
      unit: "%",
      Q: [
        point("2025-09-30", 15, "Q3 FY25"),
        point("2026-06-30", 18, "Q2 FY26"),
        point("2026-09-30", 17, "Q3 FY26"),
      ],
      A: [],
      alts: [{}],
      current: true,
    },
    old: {
      kpi_id: "k2",
      name: "Old basis",
      unit: "%",
      Q: [point("2019-09-30", 9, "Q3 FY19")],
      A: [],
      alts: [],
      current: false,
    },
  },
};
const latest = {
  kpis: {
    roe: {
      AAA: { q: ["2026-09-30", 17, "Q3 FY26", null], a: null, ind: "Banks", sec: "Financials" },
      BBB: { q: ["2026-09-30", 12, "Q3 FY26", null], a: null, ind: "Banks", sec: "Financials" },
      CCC: { q: ["2026-09-30", 20, "Q3 FY26", null], a: null, ind: "Banks", sec: "Financials" },
      DDD: { q: ["2026-09-30", 10, "Q3 FY26", null], a: null, ind: "Banks", sec: "Financials" },
    },
  },
};
const tax = [
  {
    id: "roe",
    name: "Return on common equity",
    family: "Banks",
    uclass: "pct",
    unit: "%",
    definition: "Net income to common over average common equity.",
    higher_is_better: true,
  },
];

describe("standardized KPI rows", () => {
  it("current series only, with the company's name, the latest point, the change from a year before and the peer percentile", () => {
    const rows = standardRows("AAA", co as never, latest as never, tax);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect([r.measure, r.name, r.point[0], r.point[1], r.alts]).toEqual([
      "Return on common equity",
      "Return on common equity (ROE)",
      "2026-09-30",
      17,
      1,
    ]);
    expect(r.yoy).toBe(2); // points: 17 against 15 a year before
    // Among four banks (10, 12, 17, 20): two below, so (2 + 0) / 3 = 67th.
    expect([r.pct, r.peers, r.scope]).toEqual([67, 4, "industry"]);
  });
  it("formats by measure class", () => {
    expect(fmtStd(13.9, "pct")).toBe("13.9%");
    expect(fmtStd(132.3, "usd_ps")).toBe("$132.30");
    expect(fmtStd(19e9, "usd")).toBe("$19.0B");
    expect(fmtChange(-0.9, "pct")).toBe("−0.9 pt");
    expect(fmtChange(0.149, "usd")).toBe("+14.9%");
    expect(fmtChange(null, "pct")).toBe("–");
  });
});
