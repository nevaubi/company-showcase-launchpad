import { describe, expect, it } from "vitest";
import { comparePeriods, detectPeriodFormat, formatPeriod, parsePeriod, type PeriodFormat } from "./periods";

describe("parsePeriod", () => {
  it("reads each declared format into its first and last day and a reader's label", () => {
    expect(parsePeriod("2026-11-12", "iso-date")).toEqual({
      start: "2026-11-12",
      end: "2026-11-12",
      label: "Nov 12, 2026",
      order: 20769,
    });
    // FDIC REPDTE and CALLYMD.
    expect(parsePeriod("20260630", "yyyymmdd")).toMatchObject({ start: "2026-06-30", end: "2026-06-30", label: "Jun 30, 2026" });
    expect(parsePeriod("2026-10", "yyyy-mm")).toMatchObject({ start: "2026-10-01", end: "2026-10-31", label: "Oct 2026" });
    // EIA Monthly Energy Review YYYYMM.
    expect(parsePeriod("202602", "yyyymm")).toMatchObject({ start: "2026-02-01", end: "2026-02-28", label: "Feb 2026" });
    expect(parsePeriod("202402", "yyyymm")).toMatchObject({ end: "2024-02-29" });
    expect(parsePeriod("2026Q2", "quarter")).toMatchObject({ start: "2026-04-01", end: "2026-06-30", label: "Q2 2026" });
    expect(parsePeriod("2026:Q2", "quarter")).toMatchObject({ start: "2026-04-01", end: "2026-06-30", label: "Q2 2026" });
    expect(detectPeriodFormat(["1945:Q4", "2026:Q2"])).toBe("quarter");
    expect(parsePeriod("2026-Q4", "quarter")).toMatchObject({ start: "2026-10-01", end: "2026-12-31", label: "Q4 2026" });
    expect(parsePeriod("2026 Q1", "quarter")).toMatchObject({ end: "2026-03-31" });
    expect(parsePeriod("2025", "year")).toMatchObject({ start: "2025-01-01", end: "2025-12-31", label: "2025" });
  });

  it("converts a Taiwan month by its stated rule and says so in the title", () => {
    const parsed = parsePeriod("11510", "roc-yyymm");
    expect(parsed).toMatchObject({ start: "2026-10-01", end: "2026-10-31", label: "Oct 2026" });
    expect(parsed?.title).toBe("11510 in the source: Republic of China year 115 plus 1911 is 2026, month 10");
    expect(parsePeriod("9912", "roc-yyymm")).toMatchObject({ start: "2010-12-01", label: "Dec 2010" });
    expect(parsePeriod("0010", "roc-yyymm")).toBeNull();
    expect(parsePeriod("11513", "roc-yyymm")).toBeNull();
  });

  it("refuses text that does not fit the format exactly", () => {
    const refused: [string, PeriodFormat][] = [
      ["2026-02-30", "iso-date"],
      ["2026-1-5", "iso-date"],
      [" 2026-01-05", "iso-date"],
      ["2026-01-05T00:00:00Z", "iso-date"],
      ["20261301", "yyyymmdd"],
      ["2026-13", "yyyy-mm"],
      ["202600", "yyyymm"],
      ["2026Q5", "quarter"],
      ["Q2 2026", "quarter"],
      ["2026::Q2", "quarter"],
      ["26", "year"],
      ["0999", "year"],
      ["2026", "yyyymm"],
      ["2026-10", "text"],
    ];
    for (const [text, format] of refused) expect(parsePeriod(text, format), `${text} as ${format}`).toBeNull();
  });

  it("orders periods of one format by their first day", () => {
    const order = (text: string, format: PeriodFormat) => parsePeriod(text, format)!.order;
    expect(order("2026Q1", "quarter")).toBeLessThan(order("2026Q2", "quarter"));
    expect(order("202512", "yyyymm")).toBeLessThan(order("202601", "yyyymm"));
    expect(order("1970-01-01", "iso-date")).toBe(0);
  });
});

describe("detectPeriodFormat", () => {
  it("names a format only when every sample fits it", () => {
    expect(detectPeriodFormat(["2026-11-12", "2026-11-05", null])).toBe("iso-date");
    expect(detectPeriodFormat(["20260630", "20260331"])).toBe("yyyymmdd");
    expect(detectPeriodFormat(["2026-10", "2026-09"])).toBe("yyyy-mm");
    expect(detectPeriodFormat(["202610", "202609"])).toBe("yyyymm");
    expect(detectPeriodFormat(["2026Q2", "2026Q1"])).toBe("quarter");
    expect(detectPeriodFormat(["2025", "2024"])).toBe("year");
  });

  it("falls back to text on a mix, an empty cell, no samples or an implausible calendar", () => {
    expect(detectPeriodFormat(["2026-10", "202609"])).toBe("text");
    expect(detectPeriodFormat(["2026", ""])).toBe("text");
    expect(detectPeriodFormat([])).toBe("text");
    expect(detectPeriodFormat([null, null])).toBe("text");
    // FDIC ENDEFYMD "99991231" is a sentinel, not a date.
    expect(detectPeriodFormat(["20260630", "99991231"])).toBe("text");
    // Four-digit codes under 1500 are not years.
    expect(detectPeriodFormat(["1311", "1221"])).toBe("text");
  });

  it("never detects the Taiwan month: five digits could be a ZIP code", () => {
    expect(detectPeriodFormat(["11510", "11509"])).toBe("text");
  });
});

describe("comparePeriods", () => {
  it("sorts parsed periods by time, then unparsed text, then missing values", () => {
    const cells = ["2026Q2", null, "n/a", "2025Q4", "2026Q1", "FY2026"];
    expect([...cells].sort((a, b) => comparePeriods(a, b, "quarter"))).toEqual([
      "2025Q4",
      "2026Q1",
      "2026Q2",
      "FY2026",
      "n/a",
      null,
    ]);
  });

  it("compares text by code point under the text format", () => {
    expect(["b", "B", "a"].sort((a, b) => comparePeriods(a, b, "text"))).toEqual(["B", "a", "b"]);
    expect(comparePeriods(null, null, "text")).toBe(0);
    expect(comparePeriods("2026", "2026", "year")).toBe(0);
  });

  it("sorts Taiwan months across the ROC century boundary", () => {
    expect(["10001", "9912", "11510"].sort((a, b) => comparePeriods(a, b, "roc-yyymm"))).toEqual(["9912", "10001", "11510"]);
  });
});

describe("formatPeriod", () => {
  it("shows the label and keeps the stored text one hover away", () => {
    expect(formatPeriod("202610", "yyyymm")).toEqual({ text: "Oct 2026", title: "202610" });
    expect(formatPeriod("2026", "year")).toEqual({ text: "2026" });
    expect(formatPeriod("11510", "roc-yyymm")).toEqual({
      text: "Oct 2026",
      title: "11510 in the source: Republic of China year 115 plus 1911 is 2026, month 10",
    });
    expect(formatPeriod("FY2026", "quarter")).toEqual({ text: "FY2026" });
    expect(formatPeriod(null, "year")).toEqual({ text: "–", title: "missing in the source" });
  });
});
