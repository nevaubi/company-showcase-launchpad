import { describe, expect, it } from "vitest";
import aapl from "@/test/fixtures/companies/AAPL.json";
import jpm from "@/test/fixtures/companies/JPM.json";
import { canCompare, defaultThreads, countByFamily, dedupeFilings, groupByYear, insiderFilings, latestKeyDocs, paginate, scopeFilings, yearsOf, type ListFiling } from "./list";

const A = aapl.filings as ListFiling[];
const J = jpm.filings as ListFiling[];

describe("company filing list", () => {
  it("counts every filing in exactly one family", () => {
    const c = countByFamily(J);
    expect(Object.values(c).reduce((a, b) => a + b, 0)).toBe(J.length);
    // JPM fixture: 1,364 8-Ks + 17 8-K/As are current reports; 98 10-Qs + 27 10-Ks + 10 + 2 amendments are periodic
    expect(c.current).toBe(1381);
    expect(c.periodic).toBe(137);
    expect(c.proxy).toBe(53 + 32 + 12);
  });

  it("scopes by kind, year and words, newest first", () => {
    const k = scopeFilings(A, { kind: "periodic", year: 2025, q: "" });
    expect(k.map((f) => f.form)).toEqual(["10-K", "10-Q", "10-Q", "10-Q"]);
    expect(k.every((f) => f.filed.startsWith("2025"))).toBe(true);
    // "earnings" matches 8-Ks whose item 2.02 makes them earnings releases
    const e = scopeFilings(A, { kind: "all", year: 2026, q: "earnings release" });
    expect(e.length).toBeGreaterThanOrEqual(3);
    expect(e.every((f) => f.items?.includes("2.02"))).toBe(true);
    expect(scopeFilings(A, { kind: "ir", year: null, q: "" })).toEqual([]);
    const withInsiders = [...A, ...insiderFilings(aapl.insiders)];
    expect(scopeFilings(withInsiders, { kind: "key", year: null, q: "" })).toHaveLength(A.length);
    expect(scopeFilings(withInsiders, { kind: "all", year: null, q: "" })).toHaveLength(withInsiders.length);
  });

  it("pages and clamps", () => {
    const rows = Array.from({ length: 120 }, (_, i) => i);
    expect(paginate(rows, 1)).toMatchObject({ page: 1, pages: 3, from: 1, to: 50, total: 120 });
    expect(paginate(rows, 3).rows).toHaveLength(20);
    expect(paginate(rows, 9).page).toBe(3);
    expect(paginate([], 2)).toMatchObject({ page: 1, pages: 1, from: 0, to: 0 });
  });

  it("groups consecutive rows by year and keeps undated documents apart", () => {
    const g = groupByYear([{ filed: "2026-02-01" }, { filed: "2026-01-01" }, { filed: "2025-12-01" }, { filed: null }]);
    expect(g.map((x) => [x.year, x.rows.length])).toEqual([["2026", 2], ["2025", 1], ["Undated", 1]]);
    expect(yearsOf(A)[0]).toBe(2026);
  });

  it("finds the latest key documents", () => {
    const k = latestKeyDocs(A, aapl.earningsReleases);
    expect(k.annual?.accn).toBe("0000320193-25-000079");
    expect(k.quarterly?.accn).toBe("0000320193-26-000020");
    expect(k.release?.release.accn).toBe("0000320193-26-000024");
    expect(k.release?.filing?.items).toContain("2.02");
    expect(k.proxy?.form).toBe("DEF 14A");
    // a newer 10-K from the live table wins, and duplicates collapse
    const fresh = { accn: "0000320193-26-000026", form: "10-K", filed: "2026-11-03", report: "2026-09-26", doc: "aapl-20260926.htm" };
    const rows = dedupeFilings([fresh, ...A, fresh]);
    expect(rows.length).toBe(A.length + 1);
    expect(latestKeyDocs(rows, []).annual?.accn).toBe(fresh.accn);
    expect(canCompare(fresh, rows)).toBe(true);
    expect(canCompare(A.find((f) => f.form === "8-K")!, rows)).toBe(false);
  });

  it("rebuilds one Form 4 row per accession from insider trades", () => {
    const f = insiderFilings(aapl.insiders);
    expect(f.length).toBe(new Set(aapl.insiders.map((t) => t.accn)).size);
    const n = f.find((x) => x.accn === "0001140361-26-041201")!;
    expect(n).toMatchObject({ form: "4", filed: "2026-10-29" });
    expect(n.desc).toContain("Jennifer Newstead, SVP, GC and Government Affairs");
    expect(n.desc).toContain("Open-market sale");
    expect(n.desc).toContain("10b5-1 plan");
    expect(countByFamily(f).ownership).toBe(f.length);
  });
});

describe("defaultThreads (L4)", () => {
  it("lists reviewed periodic reports and replied threads, or every thread when none qualifies", () => {
    const a = { periodic: true, rounds: 0 }, b = { periodic: false, rounds: 2 }, c = { periodic: false, rounds: 0 };
    expect(defaultThreads([a, b, c])).toEqual([a, b]);
    expect(defaultThreads([c, c])).toHaveLength(2);
  });
});
