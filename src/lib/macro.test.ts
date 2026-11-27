import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { macroDef } from "./coverage";
import type { MacroSeries } from "./financials/types";
import { preferCloudSummary, type MacroSummary, readingOf, sharedCurveDates, transformed, type Obs } from "./macro";

describe("agency series definitions and published snapshots", () => {
  const cases = [
    ["TOTALSA", "Total vehicle sales (SAAR)", "Millions of units"],
    ["CES6562000001", "Health care and social assistance employment", "Thousands of persons"],
    ["IPG2211A2N", "Electric and gas utilities output", "Index 2022=100"],
    ["IPG3344S", "Semiconductor and other electronic component production", "Index 2022=100"],
    ["INDPRO", "Industrial production", "Index 2022=100"],
    ["IPMAN", "Manufacturing output", "Index 2022=100"],
    ["IPG325S", "Chemical production", "Index 2022=100"],
    ["MSPUS", "Median price of new houses sold", "Dollars"],
    ["DRTSCILM", "Domestic banks tightening C&I standards for large and middle-market firms", "Net % of banks"],
    ["MTSDS133FMS", "Federal budget balance (surplus +, deficit −)", "Millions of dollars"],
  ] as const;

  it.each(cases)("%s matches the published series scope and source units", (id, title, units) => {
    const def = macroDef(id);
    const snapshot = JSON.parse(readFileSync(`public/data/macro/${id}.json`, "utf8")) as MacroSeries;
    expect(def).toMatchObject({ id, title, units, source: `https://fred.stlouisfed.org/series/${id}` });
    expect(snapshot).toMatchObject({ id, title, units });
    if (units === "Index 2022=100") {
      const baseYear = snapshot.observations.filter(([day]) => day.startsWith("2022-"));
      expect(baseYear).toHaveLength(12);
      expect(baseYear.reduce((sum, [, level]) => sum + level, 0) / 12).toBeCloseTo(100, 2);
    }
  });
});

describe("calendar-aligned macro readings", () => {
  it("protects validated monthly baselines while older workers roll forward", () => {
    const base = { date: "2026-09-01", calculationVersion: 2 } as MacroSummary;
    const legacy = { date: "2026-10-01" } as MacroSummary;
    expect(preferCloudSummary(legacy, base, "Monthly")).toBe(false);
    expect(preferCloudSummary(legacy, base, "Daily")).toBe(true);
    expect(preferCloudSummary({ ...legacy, calculationVersion: 2 }, base, "Monthly")).toBe(true);
  });

  it("does not replace a missing October CPI base with September", () => {
    const observations: Obs = [["2025-09-01", 100], ["2025-11-01", 110], ["2026-10-01", 120], ["2026-11-01", 121]];
    const result = transformed({ frequency: "Monthly", transform: "yoy" }, observations);
    expect(result.map(([d]) => d)).toEqual(["2026-11-01"]);
    expect(result[0][1]).toBeCloseTo(10);
  });

  it("requires consecutive months for payroll changes and trailing fiscal sums", () => {
    const raw: Obs = Array.from({ length: 14 }, (_, i) => [new Date(Date.UTC(2025, i, 1)).toISOString().slice(0, 10), 1]);
    raw.splice(1, 1);
    expect(transformed({ frequency: "Monthly", transform: "sum12" }, raw)).toEqual([["2026-02-01", 12]]);
    expect(transformed({ frequency: "Monthly", transform: "diff" }, raw)[0]).toEqual(["2025-04-01", 0]);
    expect(readingOf({ frequency: "Monthly" }, raw.slice(0, 2)).prior).toBeNull();
  });

  it("uses a common observation date for every maturity in a Treasury curve", () => {
    expect(sharedCurveDates([[["2026-11-23", 4], ["2026-11-25", 5]], [["2026-11-23", 3], ["2026-11-24", 4]]])).toEqual(["2026-11-23"]);
    expect(sharedCurveDates([[], [["2026-11-25", 4]]])).toEqual([]);
  });

  it("recognizes month-end releases across months of different lengths", () => {
    const readings: Obs = [["2026-08-31", 3.49], ["2026-09-30", 3.531]];
    expect(readingOf({ frequency: "Monthly" }, readings).prior).toBe(3.49);
  });

  it("clamps the prior month of March 31 to February and tolerates market holidays", () => {
    expect(readingOf({ frequency: "Daily" }, [["2025-02-28", 1], ["2025-03-03", 5], ["2025-03-31", 9]]).prior).toBe(1);
  });
});
