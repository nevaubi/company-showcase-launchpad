import { describe, expect, it } from "vitest";
import { canonCountry, concentrationHistory, counterpartyCountry, countryExposure, ecosystemBasket, freshness, lastConfirmed, regionShock } from "./analytics";
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
  it("counts a sole-source relationship once when a filing also names its head-office country", () => {
    const rows = countryExposure([L({ regions: ["Taiwan"], counterparty: "TSMC", single_source: true })], [], {});
    expect(rows[0]).toMatchObject({ country: "Taiwan", links: 1, hq: 1, singleSource: 1 });
  });

  it("uses the outside filer's country when the selected company is the recipient of a filing link", () => {
    const rows = countryExposure([L({ ticker: "TSM", counterparty: "ASML", counterparty_ticker: "ASML" })],
      [], {}, { ticker: "ASML", names: { TSM: "TSMC" } });
    expect(rows.map((r) => r.country)).toEqual(["Taiwan"]);
  });

  it("does not treat a head-office address as a regional sales figure or subtract a different ordinary link", () => {
    const hits = regionShock("Taiwan", [
      L({ counterparty: "TSMC", single_source: true, relation: "customer", share_pct: 25 }),
      L({ counterparty: "Acme", regions: ["Taiwan"] }),
    ], [], { AAA: 100 });
    expect(hits[0]).toMatchObject({ hq: 1, links: 1, dollars: 0, singleSource: 1, score: 35 });
  });
  it("counts a TSMC supplier link as a Taiwan tie worth 6 points", async () => {
    const { regionShock, counterpartyCountry } = await import("./analytics");
    expect(counterpartyCountry("Taiwan Semiconductor Manufacturing Company Limited")).toBe("Taiwan");
    const h = regionShock("Taiwan", [L({ counterparty: "TSMC" })], [], {});
    expect(h[0].hq).toBe(1);
    expect(h[0].score).toBe(6);
  });
});

describe("counterparty home country (anchored)", () => {
  // Real counterparty names from current supply_links (20 Nov 2026) that the old fragment patterns placed abroad.
  it.each([
    ["Corteva, Inc.", "teva"], ["Prismic Life Reinsurance, Ltd.", "smic"], ["Shanghai Fosun Pharmaceutical (Group) Co., Ltd.", "sun pharma"],
    ["Blue Racer Midstream", "acer"], ["Boys & Girls Clubs of America", "ubs"], ["EQUATE Petrochemical Company K.S.C.C.", "roche"],
    ["Village of Midvale", "vale"], ["Steckman Ridge", "teck"], ["Olympus BidCo L.P.", "olympus"], ["Mitsubishi Electric Trane HVAC US LLC", "mitsubishi"],
    ["Tata Chemicals (Soda Ash) Partners", "tata"], ["BP Bunge Bioenergia", "bp"],
  ])("does not give %s a country from the fragment %s", (name) => {
    expect(counterpartyCountry(name)).toBeNull();
  });
  it.each([
    ["Airbus S.A.S.", "France"], ["Stellantis N.V.", "Netherlands"], ["Merck KGaA", "Germany"], ["Daiichi Sankyo Company, Limited", "Japan"],
    ["F. Hoffmann-La Roche Ltd.", "Switzerland"], ["Enbridge Inc.", "Canada"], ["Coca-Cola FEMSA, S.A.B. de C.V.", "Mexico"], ["Genmab A/S", "Denmark"],
    ["Taiwan Semiconductor Manufacturing Company Limited", "Taiwan"],
  ])("keeps the home country of %s", (name, country) => {
    expect(counterpartyCountry(name)).toBe(country);
  });
  it("no longer counts a Corteva link as an Israel tie in the exposure tallies", () => {
    const rows = countryExposure([L({ counterparty: "Corteva, Inc.", relation: "customer" })], [], {});
    expect(rows.find((r) => r.country === "Israel")).toBeUndefined();
  });
});

describe("whole-name home countries", () => {
  it("counts a bare brand only when it is the whole name", () => {
    expect(counterpartyCountry("SAP")).toBe("Germany");
    expect(counterpartyCountry("Roche Group")).toBe("Switzerland");
    expect(counterpartyCountry("Nestlé S.A.")).toBe("Switzerland");
    expect(counterpartyCountry("SAP America, Inc.")).toBeNull();
    expect(counterpartyCountry("UBS Securities LLC")).toBeNull();
    expect(counterpartyCountry("Shell Energy North America")).toBeNull();
  });
});
