import { describe, expect, it } from "vitest";
import { alignAnnual } from "./annual";

const years = (from: number, to: number, v = 1): [string, number][] =>
  Array.from({ length: to - from + 1 }, (_, i) => [`FY${from + i}`, v * (from + i)]);

describe("alignAnnual", () => {
  it("places a gapped history under its own years, never by position", () => {
    const nee: [string, number][] = [["FY2011", 15], ["FY2012", 14], ...years(2018, 2025)];
    const t = alignAnnual([
      { ticker: "NEE", fiscalYearEnd: "1231", history: nee },
      { ticker: "AAPL", fiscalYearEnd: "0926", history: years(2016, 2025, 100) },
    ]);
    expect(t.years).toEqual([2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]);
    const [n, a] = t.rows;
    expect(a.cells[0]).toMatchObject({ label: "FY2016", value: 201600, end: "2016-09-26" });
    expect(n.cells[0]).toBeNull();
    expect(n.cells[1]).toBeNull();
    expect(n.cells[2]).toMatchObject({ label: "FY2018", end: "2018-12-31" });
    expect(t.sameYearEnd).toBe(false);
    expect(a.yearEnd).toBe("Sep");
  });
  it("grows over the years between end dates, not over array positions", () => {
    const t = alignAnnual([{ ticker: "X", fiscalYearEnd: "1231", history: [["FY2015", 100], ["FY2025", 200]] }]);
    expect(t.rows[0].cagr).toBeCloseTo(2 ** (1 / 10) - 1, 10);
    expect(t.sameYearEnd).toBe(true);
  });
  it("aligns January and June year-ends by the year the period ended", () => {
    const t = alignAnnual([
      { ticker: "NVDA", fiscalYearEnd: "0131", history: years(2017, 2026) },
      { ticker: "MSFT", fiscalYearEnd: "0630", history: years(2017, 2026) },
    ]);
    expect(t.rows[0].cells.at(-1)).toMatchObject({ label: "FY2026", end: "2026-01-31" });
    expect(t.rows[1].cells.at(-1)).toMatchObject({ label: "FY2026", end: "2026-06-30" });
  });
});
