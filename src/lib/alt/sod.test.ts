import { describe, expect, it } from "vitest";
import { parseBuckets, sodFilter, sodRows, sodScope } from "./sod";

const e = { ticker: "WFC", cert: 3511, rssd: "1120754", name: "WELLS FARGO&COMPANY" };

describe("FDIC Summary of Deposits rows", () => {
  it("rolls up the holding company's banks, or the bank alone without one", () => {
    expect(sodFilter(e, 2025)).toBe("RSSDHCR:1120754 AND YEAR:2025");
    expect(sodFilter({ ...e, rssd: "0" }, 2025)).toBe("CERT:3511 AND YEAR:2025");
  });

  it("reads FDIC aggregates in thousands and keeps branch counts", () => {
    const b = parseBuckets({ data: [{ data: { STALPBR: "CA", count: 787, sum_DEPSUMBR: 299560094 } }, { data: { STALPBR: "MA", count: 1, sum_DEPSUMBR: 0 } }] }, "STALPBR");
    expect(b).toEqual([{ key: "CA", branches: 787, depositsK: 299560094 }, { key: "MA", branches: 1, depositsK: 0 }]);
  });

  it("gives each state its share of the company's deposits and of the state's deposits", () => {
    const rows = sodRows(e, 2025, [{ key: "CA", branches: 10, depositsK: 300 }, { key: "TX", branches: 5, depositsK: 100 }, { key: "MA", branches: 1, depositsK: 0 }], new Map([["CA", 3000], ["TX", 2000]]), [{ key: "Los Angeles", branches: 4, depositsK: 120 }]);
    const total = rows.find((r) => r.uid === "sod:WFC:2025:total")!;
    expect(total.value).toBe(400_000);
    expect(total.meta).toMatchObject({ states: 2, branches: 16, metros: [{ name: "Los Angeles", value: 120_000, share: 0.3 }] });
    const ca = rows.find((r) => r.uid === "sod:WFC:2025:CA")!;
    expect(ca).toMatchObject({ title: "Deposits · CA", value: 300_000, date: "2025-06-30" });
    expect(ca.meta).toMatchObject({ share: 0.75, market_share: 0.1, rank: 1 });
    expect(rows.some((r) => r.uid.endsWith(":MA"))).toBe(false);
    expect(ca.source_url).toContain("RSSDHCR%3A1120754");
  });
});

describe("roll-up scope of a company the official mapping covers", () => {
  it("never rolls up another bank's holder: Mechanics Bancorp's name-matched certificate becomes its proven bank", () => {
    const wrong = { ticker: "MCHB", cert: 29011, rssd: "2395326", name: "MECHANICS FINANCIAL CORP" };
    expect(sodScope(wrong)).toEqual({ filter: "CERT:1768", rssd: null, cert: 1768, scope: "certs:1768", name: "MECHANICS BANCORP" });
    expect(sodFilter(wrong, 2026)).toBe("CERT:1768 AND YEAR:2026");
    // the proven bank's own top holder sits above the registrant, so its RSSD is not used either
    expect(sodScope({ ticker: "MCHB", cert: 1768, rssd: "4759650", name: "2011 TCRT" }).filter).toBe("CERT:1768");
  });
  it("keeps the holder roll-up where the registrant is the top holder of every proven bank", () => {
    expect(sodScope({ ticker: "JPM", cert: 628, rssd: "1039502", name: "JPMORGAN CHASE&CO" })).toMatchObject({ filter: "RSSDHCR:1039502", scope: "rssd:1039502" });
    expect(sodScope({ ticker: "JPM", cert: 628, rssd: "9999999", name: "X" })).toMatchObject({ filter: "CERT:(628 OR 21761)", scope: "certs:628,21761", cert: 628 });
  });
  it("leaves companies outside the mapping as they were", () => {
    expect(sodScope({ ticker: "MS", cert: 32992, rssd: "2162966", name: "MORGAN STANLEY" })).toMatchObject({ filter: "RSSDHCR:2162966", scope: "rssd:2162966" });
  });
  it("writes the scope on the total and on every state row", () => {
    const rows = sodRows({ ticker: "MCHB", cert: 29011, rssd: "2395326", name: "MECHANICS FINANCIAL CORP" }, 2026, [{ key: "CA", branches: 100, depositsK: 17_000_000 }], new Map([["CA", 2_000_000_000]]));
    expect(rows.map(r => r.meta.scope)).toEqual(["certs:1768", "certs:1768"]);
    expect(rows[0].meta).toMatchObject({ cert: 1768, rssd: null, entity: "MECHANICS BANCORP" });
    expect(rows[0].source_url).toContain(encodeURIComponent("CERT:1768 AND YEAR:2026"));
  });
});

