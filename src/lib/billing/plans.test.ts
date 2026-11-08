import { describe, expect, it } from "vitest";
import { LIMITS, PRICES, canUse, effectiveTier, trialDaysLeft } from "./plans";

const now = new Date("2026-11-08T00:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
const base = { isAdmin: false, approvedAt: null, subscription: null, now };

describe("plans", () => {
  it("trial lasts 14 days from approval", () => {
    expect(effectiveTier({ ...base, approvedAt: daysAgo(13) })).toBe("trial");
    expect(effectiveTier({ ...base, approvedAt: daysAgo(15) })).toBe("expired");
    expect(trialDaysLeft(daysAgo(4), now)).toBe(10);
  });
  it("expired trial has no AI use", () => {
    expect(LIMITS.expired.agent).toBe(0);
    expect(LIMITS.expired.report).toBe(0);
  });
  it("active subscription wins over an expired trial", () => {
    expect(effectiveTier({ ...base, approvedAt: daysAgo(40), subscription: { tier: "pro", status: "active", periodEnd: null } })).toBe("pro");
    expect(effectiveTier({ ...base, approvedAt: daysAgo(40), subscription: { tier: "pro", status: "canceled", periodEnd: null } })).toBe("expired");
  });
  it("admins are Pro", () => expect(effectiveTier({ ...base, isAdmin: true })).toBe("pro"));
  it("limits per tier", () => {
    expect(LIMITS.trial).toEqual({ agent: 10, report: 2 });
    expect(LIMITS.research).toEqual({ agent: 15, report: 5 });
    expect(LIMITS.pro).toEqual({ agent: 150, report: 60 });
  });
  it("prices", () => {
    expect(PRICES.research).toEqual({ monthly: 39, yearly: 390 });
    expect(PRICES.pro).toEqual({ monthly: 129, yearly: 1290 });
  });
  it("features per tier", () => {
    expect(canUse("trial", "exports")).toBe(false);
    expect(canUse("research", "exports")).toBe(true);
    expect(canUse("research", "browser")).toBe(false);
    expect(canUse("pro", "browser")).toBe(true);
  });
});
