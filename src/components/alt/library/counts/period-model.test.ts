import { describe, expect, it } from "vitest";
import type { SourceFacetValue } from "@/lib/sources/read-types";
import { isUniform, MAX_PERIOD_COLUMNS, openingWindow, outerWindow, periodCaption, periodChart, periodTicks, windowLabel } from "./period-model";

const v = (value: string, rows: number, exact = true): SourceFacetValue => ({ value, label: null, rows, exact });

/** Months from `from` (YYYY-MM) to `to`, one record each, as "YYYY-MM". */
function months(from: string, to: string, rows: (i: number) => number = () => 1): SourceFacetValue[] {
  const out: SourceFacetValue[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  let i = 0;
  while (`${y}-${String(m).padStart(2, "0")}` <= to) {
    out.push(v(`${y}-${String(m).padStart(2, "0")}`, rows(i++)));
    m += 1;
    if (m === 13) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

const years = (from: number, to: number, rows: (y: number) => number = () => 100) => Array.from({ length: to - from + 1 }, (_, i) => v(String(from + i), rows(from + i)));

describe("periodChart", () => {
  it("draws the last ten calendar years of an annual table one column each, and every year under All", () => {
    const facets = years(2000, 2026, (y) => y - 1990).reverse();
    const recent = periodChart(facets, "year");
    expect(recent.dated).toBe(true);
    expect(recent.grain).toBe("period");
    expect(recent.columns.map((c) => c.label)).toEqual(["2017", "2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026"]);
    expect(recent.windowed).toBe(true);
    expect(recent.columns[9]).toMatchObject({ rows: 36, exact: true, action: { kind: "filter", period: "2026" } });
    const all = periodChart(facets, "year", { kind: "all" });
    expect(all.columns).toHaveLength(27);
    expect(all.window.kind).toBe("all");
    expect(all.max).toBe(36);
  });

  it("groups more than 60 periods by calendar year and opens a year as its periods", () => {
    const facets = months("1960-01", "2024-12", (i) => (i % 12 === 0 ? 3 : 1));
    const recent = periodChart(facets, "yyyy-mm");
    expect(recent.grain).toBe("year");
    expect(recent.columns.map((c) => c.label)).toEqual(["2015", "2016", "2017", "2018", "2019", "2020", "2021", "2022", "2023", "2024"]);
    expect(recent.columns[0]).toMatchObject({ rows: 14, periods: expect.arrayContaining(["2015-01", "2015-12"]) });
    expect(recent.columns[0].action).toEqual({ kind: "zoom", window: { kind: "year", year: "2015" } });
    const all = periodChart(facets, "yyyy-mm", { kind: "all" });
    expect(all.columns).toHaveLength(65);
    const year = periodChart(facets, "yyyy-mm", { kind: "year", year: "2023" });
    expect(year.grain).toBe("period");
    expect(year.columns.map((c) => c.label)).toEqual(["Jan 2023", "Feb 2023", "Mar 2023", "Apr 2023", "May 2023", "Jun 2023", "Jul 2023", "Aug 2023", "Sep 2023", "Oct 2023", "Nov 2023", "Dec 2023"]);
    expect(year.columns[0].action).toEqual({ kind: "filter", period: "2023-01" });
    expect(year.columns[0].title).toBe("Jan 2023 (2023-01 in the source): 3 records. Opens its records.");
  });

  it("draws a calendar year with no record inside the range as zero, and does not open it", () => {
    const facets = [...years(1990, 1995), ...years(2001, 2060)];
    const all = periodChart(facets, "year", { kind: "all" });
    expect(all.grain).toBe("year");
    const gap = all.columns.find((c) => c.label === "1998")!;
    expect(gap).toMatchObject({ rows: 0, periods: [], action: null, title: "1998: no records." });
    expect(all.columns).toHaveLength(71);
  });

  it("opens a year of daily periods by month, and a month by day", () => {
    const days: SourceFacetValue[] = [];
    for (let d = 0; d < 200; d++) {
      const date = new Date(Date.UTC(2025, 0, 1 + d)).toISOString().slice(0, 10);
      days.push(v(date, 2));
    }
    const year = periodChart(days, "iso-date", { kind: "year", year: "2025" });
    expect(year.grain).toBe("month");
    expect(year.columns.map((c) => c.label)).toEqual(["Jan 2025", "Feb 2025", "Mar 2025", "Apr 2025", "May 2025", "Jun 2025", "Jul 2025"]);
    expect(year.columns[1]).toMatchObject({ rows: 56, action: { kind: "zoom", window: { kind: "month", month: "2025-02" } } });
    const month = periodChart(days, "iso-date", { kind: "month", month: "2025-02" });
    expect(month.grain).toBe("period");
    expect(month.columns).toHaveLength(28);
    expect(outerWindow({ kind: "month", month: "2025-02" })).toEqual({ kind: "year", year: "2025" });
    expect(outerWindow({ kind: "year", year: "2025" })).toEqual({ kind: "recent" });
    expect(windowLabel({ kind: "month", month: "2025-02" })).toBe("Feb 2025");
  });

  it("keeps text periods in the store's order and shows the last 60 by default", () => {
    const facets = Array.from({ length: 90 }, (_, i) => v(`${1950 + Math.floor(i / 4)}:Q${(i % 4) + 1}`, 1));
    const chart = periodChart(facets, "text");
    expect(chart.dated).toBe(false);
    expect(chart.columns).toHaveLength(MAX_PERIOD_COLUMNS);
    expect(chart.columns[59].label).toBe("1972:Q2");
    expect(chart.windowed).toBe(true);
    expect(periodChart(facets, "text", { kind: "all" }).columns).toHaveLength(90);
  });

  it("does not put a table on a time axis when one counted value does not parse", () => {
    const facets = [v("2024", 3), v("2025", 4), v("Note- totals exclude behind the meter", 1)];
    const chart = periodChart(facets, "year");
    expect(chart.dated).toBe(false);
    expect(chart.columns.map((c) => c.label)).toEqual(["2024", "2025", "Note- totals exclude behind the meter"]);
  });

  it("keeps a floor a floor in a year sum", () => {
    const facets = [v("2024-01", 250000, false), v("2024-02", 10), ...months("2000-01", "2023-12")];
    const chart = periodChart(facets, "yyyy-mm");
    const y2024 = chart.columns.find((c) => c.label === "2024")!;
    expect(y2024).toMatchObject({ rows: 250010, exact: false });
    expect(y2024.title).toBe("2024: at least 250,010 records in 2 periods. Opens its periods.");
  });

  it("falls back to the default window when a zoom holds nothing", () => {
    const chart = periodChart(years(2000, 2026), "year", { kind: "year", year: "1890" });
    expect(chart.window).toEqual({ kind: "recent" });
    expect(chart.columns).toHaveLength(10);
  });
});

describe("openingWindow", () => {
  it("opens a series of one record per quarter on All when its early years held one record a year", () => {
    const z1 = [...Array.from({ length: 7 }, (_, i) => v(`${1945 + i}:Q4`, 1)), ...Array.from({ length: 298 }, (_, i) => v(`${1952 + Math.floor(i / 4)}:Q${(i % 4) + 1}`, 1))];
    expect(isUniform(periodChart(z1, "quarter"))).toBe(true);
    expect(openingWindow(z1, "quarter")).toBe("all");
    const all = periodChart(z1, "quarter", { kind: "all" });
    expect(all.columns.slice(0, 8).map((c) => c.rows)).toEqual([1, 1, 1, 1, 1, 1, 1, 4]);
  });
  it("keeps ten years when they vary, and when the whole table is as flat", () => {
    expect(openingWindow(years(2000, 2026, (y) => y), "year")).toBe("recent");
    expect(openingWindow(years(1950, 2026, () => 1), "year")).toBe("recent");
  });
});

describe("periodTicks", () => {
  it("labels every column when a few fit, and always the last", () => {
    const chart = periodChart(years(2017, 2026), "year");
    expect(periodTicks(chart, 12).map((t) => t.label)).toEqual(["2017", "2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026"]);
    const few = periodTicks(chart, 4);
    expect(few[few.length - 1]).toEqual({ index: 9, label: "2026" });
    expect(few.length).toBeLessThanOrEqual(5);
  });

  it("puts year ticks on clean steps and names the latest year", () => {
    const chart = periodChart(months("1960-01", "2024-12"), "yyyy-mm", { kind: "all" });
    const ticks = periodTicks(chart, 8);
    expect(ticks.every((t, i) => i === ticks.length - 1 || Number(t.label) % 10 === 0)).toBe(true);
    expect(ticks[ticks.length - 1]).toEqual({ index: 64, label: "2024" });
  });

  it("marks the first period of each year on a quarterly axis", () => {
    const quarters = Array.from({ length: 40 }, (_, i) => v(`${2015 + Math.floor(i / 4)}Q${(i % 4) + 1}`, 5));
    const chart = periodChart(quarters, "quarter");
    const ticks = periodTicks(chart, 6);
    expect(ticks).toEqual([
      { index: 4, label: "2016" },
      { index: 12, label: "2018" },
      { index: 20, label: "2020" },
      { index: 28, label: "2022" },
      { index: 39, label: "Q4 2024" },
    ]);
  });

  it("names the first and the last value of a text axis", () => {
    const chart = periodChart([v("A", 1), v("B", 2), v("C", 3)], "text");
    expect(periodTicks(chart, 10)).toEqual([
      { index: 0, label: "A" },
      { index: 2, label: "C" },
    ]);
  });
});

describe("periodCaption", () => {
  it("says the records, the range and where most are", () => {
    const facets = months("1960-01", "2024-12", (i) => (i >= 756 && i < 768 ? 9 : 1));
    expect(periodCaption(facets, "yyyy-mm", 876, true)).toBe("876 records from Jan 1960 to Dec 2024; most in 2023.");
    // MSHA coal by state: 26 records in each year from 2000 to 2016, fewer since
    const msha = years(2000, 2026, (y) => (y <= 2016 ? 26 : 24));
    expect(periodCaption(msha, "year", 682, true)).toBe("682 records from 2000 to 2026; the most, 26 each, in 17 periods.");
  });

  it("says one period, equal periods and records without a period", () => {
    expect(periodCaption([v("2025", 1313)], "year", 1313, true)).toBe("1,313 records, all in 2025.");
    expect(periodCaption(years(2000, 2026, () => 1), "year", 27, true)).toBe("27 records from 2000 to 2026; one in each period.");
    expect(periodCaption([v("2024", 3), v("2025", 5)], "year", 10, true)).toBe("8 records from 2024 to 2025; most in 2025; 2 records have no period.");
  });

  it("says when the count stopped before the end", () => {
    expect(periodCaption([v("2020", 250000, false)], "year", 600000, false)).toBe(
      "At least 250,000 records, all in 2020; counted in period order up to 2020, later periods not counted.",
    );
    expect(periodCaption([], "year", 0, true)).toBe("No record carries a period.");
  });
});
