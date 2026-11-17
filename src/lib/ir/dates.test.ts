import { describe, expect, it } from "vitest";
import { fixPeriodEnd, fixRowDates, printedDates } from "./dates";

const COSTCO = "COSTCO WHOLESALE CORPORATION REPORTS FIRST QUARTER FISCAL YEAR 2026 OPERATING RESULTS. ISSAQUAH, Wash., Dec. 11, 2025 — results for the 12 weeks ended November 23, 2025. Comparable sales for the 12 weeks ended Nov. 23, 2025 and November 24, 2024: U.S. 5.8%.";

describe("period-end dates printed in a document", () => {
  it("reads month-name, numeric and ISO dates", () => {
    const d = printedDates(`${COSTCO} Balance at 2/15/2026 and 2026-05-10; 30 August 2026.`);
    expect([...d].sort()).toEqual(["2024-11-24", "2025-11-23", "2025-12-11", "2026-02-15", "2026-05-10", "2026-08-30"]);
  });
  it("tells period ends from datelines", () => {
    expect([...printedDates(COSTCO, true)].sort()).toEqual(["2024-11-24", "2025-11-23"]);
  });
  it("moves a calendar month-end guess to the single printed period end near it", () => {
    const d = printedDates(COSTCO, true);
    expect(fixPeriodEnd("2025-11-30", d)).toBe("2025-11-23");
    expect(fixPeriodEnd("2024-11-30", d)).toBe("2024-11-24");
  });
  it("keeps dates the document prints, dates that aren't month-ends, and ambiguous guesses", () => {
    const d = printedDates(COSTCO, true);
    // a conference call five days after quarter-end is not a period end
    expect(fixPeriodEnd("2026-09-30", printedDates("Third quarter results. The call will be held on October 5, 2026.", true))).toBe("2026-09-30");
    expect(fixPeriodEnd("2025-11-23", d)).toBe("2025-11-23");
    expect(fixPeriodEnd("2025-11-29", d)).toBe("2025-11-29");
    // a calendar-quarter company: the month-end itself is printed
    expect(fixPeriodEnd("2026-09-30", printedDates("three months ended September 30, 2026"))).toBe("2026-09-30");
    // two printed dates within ten days: no single answer
    expect(fixPeriodEnd("2025-11-30", printedDates("weeks ended November 23, 2025 and weeks ended December 7, 2025", true))).toBe("2025-11-30");
  });
  it("shifts the start with the end, so the period keeps its length", () => {
    const r = fixRowDates({ period_start: "2025-09-08", period_end: "2025-11-30", months: 3, period_label: "3M ending 2025-11-30" }, printedDates(COSTCO, true));
    expect(r).toEqual({ period_start: "2025-09-01", period_end: "2025-11-23", months: 3, period_label: "3M ending 2025-11-23" });
  });
});

describe("table headers", () => {
  it("reads each column's date after a shared 'Weeks Ended' header", () => {
    const d = printedDates("16 Weeks Ended 16 Weeks Ended August 30, 2026 August 31, 2025 52 Weeks Ended August 30, 2026", true);
    expect([...d].sort()).toEqual(["2025-08-31", "2026-08-30"]);
  });
});
