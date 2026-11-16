import { describe, expect, it } from "vitest";
import { adjustedSummary, suspectNotices, type Form144File, type Form144Notice } from "./review";

const notice = (accession: string, shares: number, value: number, filed: string, status: Form144Notice["status"] = "open"): Form144Notice => ({
  accession, filed, url: null, person: accession, relationship: "Director", shares, value, pct_outstanding: null, sale_date: filed, plan: true, plan_adopted: [], status,
});

describe("Form 144 values that can't be right", () => {
  // Tenable, Nov 13 2026: a director's notice states $4.1B for 12,000 shares; the CEO's says $4.15M for 100,000.
  const typo = notice("typo", 12_000, 4_100_000_000, "2026-11-13");
  const ceo = notice("ceo", 100_000, 4_154_000, "2026-11-13");
  const old = notice("old", 20_000, 700_000, "2026-03-01", "executed");

  it("flags the impossible per-share price and keeps ordinary notices", () => {
    expect([...suspectNotices([typo, ceo, old])]).toEqual(["typo"]);
  });
  it("needs other notices to compare against (a lone Berkshire class A notice stays)", () => {
    expect(suspectNotices([notice("brk", 10, 7_000_000, "2026-11-01")]).size).toBe(0);
  });
  it("takes the typo out of every total it was counted in", () => {
    const f: Form144File = {
      ticker: "TENB",
      generated: "2026-11-16T22:36:48Z",
      notices: [typo, ceo, old],
      summary: {
        d30: { n: 2, value: 4_104_154_000, people: 2, plan_share: 1 },
        d90: { n: 2, value: 4_104_154_000, people: 2, plan_share: 1 },
        d365: { n: 3, value: 4_104_854_000, people: 3, plan_share: 1 },
        open: { n: 2, value: 4_104_154_000, people: ["typo", "ceo"] },
      },
    };
    const s = adjustedSummary(f, suspectNotices(f.notices));
    expect(s.d30.value).toBe(4_154_000);
    expect(s.d365.value).toBe(4_854_000);
    expect(s.open.value).toBe(4_154_000);
  });
});
