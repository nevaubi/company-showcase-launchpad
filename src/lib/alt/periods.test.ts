import { describe, expect, it } from "vitest";
import { asOfLabel, calendarYearPeriod, federalFiscalYear, fiscalYearPeriod, isPartial, periodLabel } from "./periods";

const today = new Date("2026-11-20T15:00:00Z");

describe("alt-data year periods", () => {
  it("knows the federal fiscal year", () => {
    expect(federalFiscalYear(new Date("2026-09-30T12:00:00Z"))).toBe(2026);
    expect(federalFiscalYear(new Date("2026-10-01T12:00:00Z"))).toBe(2027);
  });

  it("dates a running year on the collection day, never at its future end", () => {
    expect(fiscalYearPeriod(2027, today)).toEqual({ date: "2026-11-20", ytd: true, period_start: "2026-10-01", period_end: "2027-09-30" });
    // FY2026 ended on 2026-09-30, but defense actions reach USAspending about 90 days late: still partial
    expect(fiscalYearPeriod(2026, today)).toEqual({ date: "2026-09-30", ytd: true, period_start: "2025-10-01", period_end: "2026-09-30" });
    expect(fiscalYearPeriod(2026, new Date("2027-01-28T12:00:00Z")).ytd).toBe(false);
    expect(fiscalYearPeriod(2026, new Date("2027-01-27T12:00:00Z")).ytd).toBe(true);
    expect(fiscalYearPeriod(2025, today)).toEqual({ date: "2025-09-30", ytd: false, period_start: "2024-10-01", period_end: "2025-09-30" });
    expect(calendarYearPeriod(2026, today)).toEqual({ date: "2026-11-20", ytd: true, period_start: "2026-01-01", period_end: "2026-12-31" });
    expect(calendarYearPeriod(2025, today).ytd).toBe(false);
  });

  it("labels stored rows by the period they cover", () => {
    const t = "2026-11-20";
    expect(periodLabel({ date: "2026-11-20", meta: { fiscal_year: 2027, ytd: true } }, t)).toBe("FY2027 YTD");
    expect(periodLabel({ date: "2025-09-30", meta: { fiscal_year: 2025, ytd: false } }, t)).toBe("FY2025");
    // a fiscal year inside its reporting lag reads as preliminary, also on rows stored without the flag
    expect(periodLabel({ date: "2026-09-30", meta: { fiscal_year: 2026, ytd: false } }, t)).toBe("FY2026 prelim.");
    expect(periodLabel({ date: "2026-09-30", meta: { fiscal_year: 2026, ytd: false } }, "2027-02-01")).toBe("FY2026");
    // rows written before the fix: FY2027 dated 2027-09-30, Federal Register 2026 dated 2026-12-31 without a flag
    expect(periodLabel({ date: "2027-09-30", meta: { fiscal_year: 2027, ytd: true } }, t)).toBe("FY2027 YTD");
    expect(isPartial({ date: "2026-12-31", meta: {} }, t)).toBe(true);
    expect(periodLabel({ date: "2026-12-31", meta: {} }, t)).toBe("2026 YTD");
    expect(periodLabel({ date: "2025-12-31", meta: {} }, t)).toBe("2025");
    expect(periodLabel({ date: "2026-06-30", meta: { ytd: true, quarters: 2 } }, t)).toBe("2026 Q1–Q2");
    expect(periodLabel({ date: "2026-10-01", meta: {} }, t, false)).toBe("2026-10");
  });

  it("says when a partial reading was taken", () => {
    const t = "2026-11-20";
    expect(asOfLabel({ date: "2026-11-20", meta: { fiscal_year: 2027, ytd: true, as_of: "2026-11-20T03:00:00Z" } }, t)).toBe("FY2027 YTD, as of 2026-11-20");
    expect(asOfLabel({ date: "2027-09-30", meta: { fiscal_year: 2027, ytd: true } }, t)).toBe("FY2027 YTD");
    expect(asOfLabel({ date: "2025-09-30", meta: { fiscal_year: 2025 } }, t)).toBe("FY2025");
    expect(asOfLabel({ date: "2026-09-30", meta: { fiscal_year: 2026 } }, t)).toBe("FY2026 prelim.");
    expect(asOfLabel({ date: "2026-09-30", meta: { fiscal_year: 2026, ytd: true, as_of: "2026-11-20T03:00:00Z" } }, t)).toBe("FY2026 prelim., as of 2026-11-20");
    expect(asOfLabel({ date: "2026-03-31", meta: {} }, t)).toBe("2026-03-31");
  });
});
