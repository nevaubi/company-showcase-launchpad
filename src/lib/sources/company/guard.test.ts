import { describe, expect, it } from "vitest";
import { bankScopeLine, collectorCert, depositsScopeProven, guardAltRows, guardEntry, reviewCaveat } from "./guard";

type R = { uid: string; dataset: string; date: string; value: number | null; meta: Record<string, unknown> };
const bank = (ticker: string, cert: number, field: string, date: string): R => ({ uid: `fdic:${ticker}:${field}:${date.replace(/-/g, "")}`, dataset: "bank", date, value: 1, meta: { field, cert } });
const total = (ticker: string, year: number, value: number, meta: Record<string, unknown>): R => ({ uid: `sod:${ticker}:${year}:total`, dataset: "deposits", date: `${year}-06-30`, value, meta });
const state = (ticker: string, year: number, st: string, value: number, meta: Record<string, unknown> = {}): R => ({ uid: `sod:${ticker}:${year}:${st}`, dataset: "deposits", date: `${year}-06-30`, value, meta: { state: st, ...meta } });

describe("guardAltRows", () => {
  it("hides the other Mechanics Bank: call-report and deposits rows of certificate 29011", () => {
    const rows = [
      bank("MCHB", 29011, "ASSET", "2026-09-30"),
      bank("MCHB", 29011, "DEP", "2026-09-30"),
      total("MCHB", 2026, 790_200_000, { cert: 29011, rssd: "2395326", entity: "MECHANICS FINANCIAL CORP" }),
      state("MCHB", 2026, "OH", 790_200_000),
      { uid: "wiki:MCHB:202610", dataset: "attention", date: "2026-10-01", value: 5, meta: {} },
    ];
    expect(guardAltRows("MCHB", rows).map(r => r.uid)).toEqual(["wiki:MCHB:202610"]);
  });

  it("shows rows of the proven bank once the collector stores them, and drops a state left from the wrong roll-up", () => {
    const scope = { scope: "certs:1768" };
    const rows = [
      bank("MCHB", 1768, "ASSET", "2026-09-30"),
      bank("MCHB", 29011, "NCLNLSR", "1984-03-31"),
      total("MCHB", 2026, 18_000_000_000, { cert: 1768, rssd: null, ...scope }),
      state("MCHB", 2026, "CA", 17_500_000_000, scope),
      state("MCHB", 2026, "OR", 500_000_000, scope),
      state("MCHB", 2026, "OH", 790_200_000),
    ];
    expect(guardAltRows("MCHB", rows).map(r => r.uid)).toEqual(["fdic:MCHB:ASSET:20260930", "sod:MCHB:2026:total", "sod:MCHB:2026:CA", "sod:MCHB:2026:OR"]);
  });

  it("keeps a proven company's rows as they are, keyed by the registrant as top holder", () => {
    const rows = [
      bank("WTFC", 33935, "ASSET", "2026-09-30"),
      total("WTFC", 2025, 300, { cert: 33935, rssd: "2260406" }),
      state("WTFC", 2025, "IL", 200),
      state("WTFC", 2025, "WI", 100),
    ];
    expect(guardAltRows("WTFC", rows)).toEqual(rows);
  });

  it("drops a deposits year whose states do not add up to its total, and one keyed by another holder", () => {
    const rows = [
      total("WTFC", 2025, 300, { cert: 33935, rssd: "2260406" }),
      state("WTFC", 2025, "IL", 200),
      state("WTFC", 2025, "WI", 100),
      state("WTFC", 2025, "OH", 50),
      total("WTFC", 2024, 100, { cert: 33935, rssd: "9999999" }),
      state("WTFC", 2024, "IL", 100),
    ];
    expect(guardAltRows("WTFC", rows)).toEqual([]);
  });

  it("leaves companies the mapping does not cover unchanged, the name-matched six included", () => {
    const rows = [bank("MS", 32992, "ASSET", "2026-09-30"), total("NOSUCH", 2026, 1, { cert: 1 })];
    expect(guardAltRows("MS", rows)).toEqual(rows);
    expect(guardAltRows("NOSUCH", rows)).toEqual(rows);
  });
});

describe("depositsScopeProven", () => {
  const e = guardEntry("JPM")!;
  it("accepts a roll-up by the registrant or by proven certificates only", () => {
    expect(depositsScopeProven({ cert: 628, scope: "rssd:1039502" }, e)).toBe(true);
    expect(depositsScopeProven({ cert: 628, scope: "certs:628,21761" }, e)).toBe(true);
    expect(depositsScopeProven({ cert: 628, scope: "certs:628,3510" }, e)).toBe(false);
    expect(depositsScopeProven({ cert: 628, rssd: "1039502" }, e)).toBe(true);
    expect(depositsScopeProven({ cert: 628, rssd: null }, e)).toBe(true);
    expect(depositsScopeProven({ cert: 3510, rssd: "1039502" }, e)).toBe(false);
    expect(depositsScopeProven({ rssd: "1039502" }, e)).toBe(false);
  });
});

describe("collectorCert", () => {
  it("replaces a name-matched certificate with the largest proven bank", () => {
    expect(collectorCert("MCHB", 29011)).toBe(1768);
    expect(collectorCert("MCHB", undefined)).toBe(1768);
    expect(collectorCert("JPM", 628)).toBe(628);
    expect(collectorCert("JPM", 21761)).toBe(21761);
    expect(collectorCert("WTFC", 999)).toBe(33935);
  });
  it("does not touch companies outside the mapping", () => {
    expect(collectorCert("MS", 32992)).toBe(32992);
    expect(collectorCert("AAPL", null)).toBeNull();
  });
});

describe("reviewCaveat", () => {
  it("says what the six name matches rest on", () => {
    expect(reviewCaveat("MS")).toBe("Matched by name and by the bank named in the company's subsidiary list, not by a shared identifier.");
    expect(reviewCaveat("wex")).toBe("Matched by name, not by a shared identifier.");
    expect(reviewCaveat("JPM")).toBeNull();
  });
});

describe("bankScopeLine", () => {
  it("names the one bank a call-report panel reads when the company holds several, and says nothing otherwise", () => {
    expect(bankScopeLine("WTFC", 33935)).toBe(
      "Call reports of one bank, certificate 33935, of the 17 institutions the company holds; each one's own figures are under Insured banks.",
    );
    expect(bankScopeLine("MCHB", 1768)).toBeNull(); // one bank: the panel is that bank
    expect(bankScopeLine("WTFC", 29011)).toBeNull(); // never a certificate the mapping does not prove
    expect(bankScopeLine("WTFC", null)).toBeNull();
    expect(bankScopeLine("MS", 32992)).toBeNull(); // not mapped: the caveat line speaks instead
  });
});
