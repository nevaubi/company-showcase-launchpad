import { describe, expect, it } from "vitest";
import { parseBuckets, sodFilter, sodRows } from "./sod";

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
