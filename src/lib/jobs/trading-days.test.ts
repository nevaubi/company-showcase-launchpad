import { describe, expect, it } from "vitest";
import { isTradingDay, nonTradingHours, nyseHolidays } from "./trading-days";

describe("market calendar", () => {
  it("knows the 2026 NYSE holidays", () => {
    expect([...nyseHolidays(2026)].sort()).toEqual(["2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25"]);
    expect(nyseHolidays(2027).has("2027-12-24")).toBe(true); // Christmas on a Saturday
    expect(nyseHolidays(2022).has("2021-12-31")).toBe(false); // New Year on a Saturday is not moved
  });
  it("weekends and holidays are not trading days", () => {
    expect(isTradingDay("2026-11-21")).toBe(false);
    expect(isTradingDay("2026-11-26")).toBe(false);
    expect(isTradingDay("2026-11-27")).toBe(true);
  });
  it("adds 24 h per closed day from the newest record's date to today", () => {
    const h = (a: string, b: string) => nonTradingHours(Date.parse(a), Date.parse(b));
    expect(h("2026-11-20T21:30:00Z", "2026-11-23T21:30:00Z")).toBe(48); // Fri → Mon
    expect(h("2026-11-25T21:30:00Z", "2026-11-27T21:30:00Z")).toBe(24); // Thanksgiving
    expect(h("2026-11-18T21:30:00Z", "2026-11-19T21:30:00Z")).toBe(0);
  });
});
