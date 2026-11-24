import { describe, expect, it } from "vitest";
import type { Measure, MeasureGroup } from "./analysis";
import { readFileSync } from "node:fs";
import path from "node:path";
import { hydrateDataset } from "@/lib/financials/dataset";
import type { CompanyDataset } from "@/lib/financials/types";
import { analyze } from "./analysis";
import { changeTone, fmtChange, fmtValue, fmtWithUnit, groupUnit, rowUnitLabel, TABLE_LABEL_MAX, tableLabel, unitLabel, usdScale } from "./analysis-format";

describe("analysis table formatting", () => {
  it("prints bare numbers with one convention per unit", () => {
    expect(fmtValue(0.48653, "pct")).toBe("48.7");
    expect(fmtValue(-1.0303, "pct")).toBe("−103.0");
    expect(fmtValue(10.0029, "pct")).toBe("1,000.3");
    expect(fmtValue(-0.0002, "pct")).toBe("0.0");
    expect(fmtValue(0.13066, "x")).toBe("0.13");
    expect(fmtValue(34.91, "x")).toBe("34.9");
    expect(fmtValue(426.7, "x")).toBe("427");
    expect(fmtValue(8.714, "perShare")).toBe("8.71");
    expect(fmtValue(24.55, "days")).toBe("25");
    expect(fmtValue(6.12, "quarters")).toBe("6.1");
  });

  it("scales a dollar row once, from its largest figure", () => {
    expect(usdScale([82.226e9, 95.6e9, null])).toBe("B");
    expect(usdScale([2.7e12, 900e9])).toBe("T");
    expect(usdScale([350e6, -510e6])).toBe("M");
    expect(usdScale([12_000])).toBe("");
    expect(usdScale([])).toBe("");
    expect(fmtValue(82.226e9, "usd", "B")).toBe("82.2");
    expect(fmtValue(466.823e9, "usd", "B")).toBe("467");
    expect(fmtValue(6.729e9, "usd", "B")).toBe("6.73");
    expect(fmtValue(-350e6, "usd", "M")).toBe("−350");
    expect(fmtValue(2.7137e12, "usd", "T")).toBe("2.71");
    expect(fmtValue(12_345, "usd", "")).toBe("12,345");
  });

  it("signs a change and never prints a negative zero", () => {
    expect(fmtChange(0.0197, "pct")).toBe("+2.0");
    expect(fmtChange(-0.0141, "pct")).toBe("−1.4");
    expect(fmtChange(0.0001, "pct")).toBe("0.0");
    expect(fmtChange(-0.0001, "pct")).toBe("0.0");
    expect(fmtChange(-13.4e9, "usd", "B")).toBe("−13.4");
    expect(fmtChange(0.05, "x")).toBe("+0.05");
  });

  it("states the unit once", () => {
    expect(unitLabel("pct")).toBe("%");
    expect(unitLabel("usd", "B")).toBe("$B");
    expect(unitLabel("usd", "")).toBe("$");
    expect(unitLabel("perShare")).toBe("$ per share");
    const group = (units: Measure["unit"][]): MeasureGroup => ({ id: "margins", title: "", measures: units.map((unit) => ({ unit }) as Measure) });
    expect(groupUnit(group(["pct", "pct"]))).toBe("pct");
    expect(groupUnit(group(["pct", "days"]))).toBeNull();
    expect(groupUnit(group(["usd", "usd"]))).toBeNull(); // dollar rows carry their own scale
  });

  it("writes a figure with its unit for sentences and tooltips", () => {
    expect(fmtWithUnit(0.48653, "pct")).toBe("48.7%");
    expect(fmtWithUnit(4.123, "x")).toBe("4.12×");
    expect(fmtWithUnit(466.823e9, "usd")).toBe("$467B");
    expect(fmtWithUnit(-350e6, "usd")).toBe("−$350M");
    expect(fmtWithUnit(-13.05, "perShare")).toBe("−$13.05");
    expect(fmtWithUnit(24.55, "days")).toBe("25 days");
  });

  it("colours a change only when it matters and has a direction", () => {
    expect(changeTone(0.02, "high", "pct")).toBe("positive");
    expect(changeTone(0.02, "low", "pct")).toBe("negative");
    expect(changeTone(-0.02, "low", "pct")).toBe("positive");
    expect(changeTone(0.02, null, "pct")).toBeNull();
    expect(changeTone(0.0002, "high", "pct")).toBeNull();
    expect(changeTone(null, "high", "pct")).toBeNull();
  });
});

describe("analysis table row labels (review company-L5)", () => {
  const load = (t: string) => hydrateDataset(JSON.parse(readFileSync(path.resolve(__dirname, `../../test/fixtures/companies/${t}.json`), "utf8")) as CompanyDataset);
  it("every row label with its unit fits one line of the label column at 1280 px", () => {
    for (const t of ["AAPL", "NVDA", "MSFT", "GOOGL", "META", "JPM", "BAC", "C", "GS", "MS", "WFC"]) {
      const a = analyze(load(t));
      for (const g of a.groups)
        for (const m of g.measures) {
          const text = tableLabel(m.key, m.label);
          expect(text.length, `${t} ${m.key}: ${text}`).toBeLessThanOrEqual(TABLE_LABEL_MAX);
          const shared = groupUnit(g);
          // the row's own unit, when the table has none in common, is short ("%", "×", "$B", "$", "days")
          if (!shared) expect(rowUnitLabel(m.unit, "B").length, `${t} ${m.key}`).toBeLessThanOrEqual(8);
        }
    }
  });
  it("a per-share row's unit is a plain dollar sign", () => {
    expect(rowUnitLabel("perShare")).toBe("$");
    expect(rowUnitLabel("pct")).toBe("%");
    expect(tableLabel("revenueYoY", "Revenue, latest quarter, year on year")).toBe("Revenue, quarter y/y");
    expect(tableLabel("grossMargin", "Gross margin")).toBe("Gross margin");
  });
});

describe("fmtMultiple", () => {
  it("prints one decimal with a true minus and no negative zero", async () => {
    const { fmtMultiple } = await import("./analysis-format");
    expect(fmtMultiple(12.345)).toBe("12.3×");
    expect(fmtMultiple(-0.8)).toBe("−0.8×");
    expect(fmtMultiple(-0.04)).toBe("0.0×");
    expect(fmtMultiple(-0.1)).not.toContain("-");
  });
});
