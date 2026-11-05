import { describe, expect, it } from "vitest";
import { canonCountry, concentrationHistory, countryExposure, ecosystemBasket, freshness, lastConfirmed, regionShock } from "./analytics";
import type { ProLink } from "./core";

const L = (p: Partial<ProLink>): ProLink => ({
  id: Math.random().toString(), ticker: "AAA", counterparty: "X", counterparty_ticker: null, counterparty_domain: null, relation: "supplier",
  detail: "", share_pct: null, quote: "", accn: "a", doc: "d", form: "10-K", filed: "2025-01-01", regions: [], ...p,
});

describe("supply analytics", () => {
  it("merges country spellings", () => {
    expect(canonCountry("United States of America")).toBe("United States");
    expect(canonCountry("PRC")).toBe("China");
    expect(canonCountry("  Taiwan ")).toBe("Taiwan");
  });

  it("counts links, single-source ties and facilities per country", () => {
    const rows = countryExposure(
      [L({ regions: ["Taiwan"], single_source: true }), L({ ticker: "BBB", regions: ["taiwan", "China"] })],
      [{ ticker: "CCC", kind: "facility", country: "Taiwan", impact: "neutral", title: "fab", amount_usd: null }],
      {},
    );
    const tw = rows.find((r) => r.country.toLowerCase() === "taiwan")!;
    expect(tw.companies.length).toBe(3);
    expect(tw.facilities).toBe(1);
    expect(rows.find((r) => r.country === "China")!.hotspot).toBe(true);
  });

  it("scores a region shock: single-source tie = 25 points", () => {
    const hits = regionShock("Taiwan", [L({ regions: ["Taiwan"], single_source: true })], [], {});
    expect(hits[0].score).toBe(25);
    expect(hits[0].severity).toBe("medium");
  });

  it("caps the stated-dollar share part at 40 points", () => {
    const hits = regionShock("China", [L({ relation: "customer", share_pct: 50, regions: ["China"] })], [], { AAA: 100 });
    // 1 non-single link = 4 points, $50 of $100 revenue → min(40, 0.5*200)=40
    expect(hits[0].score).toBe(44);
  });

  it("builds concentration history from 10-K shares only", () => {
    const h = concentrationHistory("AAA", [
      L({ relation: "customer", counterparty: "Walmart Inc.", share_pct: 12, filed: "2023-02-01" }),
      L({ relation: "customer", counterparty: "Walmart", share_pct: 15, filed: "2024-02-01" }),
      L({ relation: "customer", counterparty: "Walmart", share_pct: 30, filed: "2024-05-01", form: "10-Q" }),
    ]);
    expect(h.series).toEqual(["Walmart Inc."]);
    expect(h.points.map((p) => p["Walmart Inc."])).toEqual([12, 15]);
  });

  it("grades freshness at 200 and 400 days", () => {
    expect(freshness("2026-01-01", "2026-07-20").status).toBe("fresh");
    expect(freshness("2025-01-01", "2026-01-01").status).toBe("aging");
    expect(freshness("2024-01-01", "2026-01-01").status).toBe("stale");
  });

  it("finds the newest filing that re-states a link", () => {
    const a = L({ counterparty: "Acme Corp", filed: "2023-01-01" });
    expect(lastConfirmed(a, [a, L({ counterparty: "Acme", filed: "2025-03-01" })])).toBe("2025-03-01");
  });

  it("compounds an equal-weight basket", () => {
    const dates = ["d0", "d1", "d2"];
    const b = ecosystemBasket("F", ["A", "B"], dates, { F: [0, 0.1, 0], A: [0, 0.1, 0.1], B: [0, -0.1, 0.1] }, 2)!;
    expect(b.index[0].basket).toBe(100);
    expect(b.basketRet).toBeCloseTo(0.1, 6); // (1+0)(1+0.1)-1
    expect(b.focusRet).toBeCloseTo(0.1, 6);
  });
});

describe("headquarters ties", () => {
  it("counts a TSMC supplier link as a Taiwan tie worth 6 points", async () => {
    const { regionShock, counterpartyCountry } = await import("./analytics");
    expect(counterpartyCountry("Taiwan Semiconductor Manufacturing Company Limited")).toBe("Taiwan");
    const h = regionShock("Taiwan", [L({ counterparty: "TSMC" })], [], {});
    expect(h[0].hq).toBe(1);
    expect(h[0].score).toBe(6);
  });
});
