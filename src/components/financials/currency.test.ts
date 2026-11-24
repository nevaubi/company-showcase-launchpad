import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { assessCurrency } from "@/lib/financials/currency";
import { hydrateDataset } from "@/lib/financials/dataset";
import type { CompanyDataset, Statement } from "@/lib/financials/types";
import { readPlan, unreadSentence } from "./currency";

const load = (t: string) => hydrateDataset(JSON.parse(readFileSync(`src/test/fixtures/companies/${t}.json`, "utf8")) as CompanyDataset);
const cut = (s: Statement, end: string): Statement => {
  const n = s.periods.filter((p) => p.end <= end).length;
  return { periods: s.periods.slice(0, n), rows: s.rows.map((r) => ({ ...r, cells: r.cells.slice(0, n) })) };
};

describe("readPlan", () => {
  it("passes the Q3 10-Q with a missing 10-K, found by period (JPMorgan, M7)", () => {
    const full = load("JPM");
    const d: CompanyDataset = {
      ...full,
      filings: full.filings.filter((f) => f.filed <= "2026-02-13"),
      statements: {
        annual: Object.fromEntries(Object.entries(full.statements.annual).map(([k, s]) => [k, cut(s, "2024-12-31")])) as CompanyDataset["statements"]["annual"],
        quarterly: Object.fromEntries(Object.entries(full.statements.quarterly).map(([k, s]) => [k, cut(s, "2025-09-30")])) as CompanyDataset["statements"]["quarterly"],
      },
    };
    expect(readPlan(d, assessCurrency(d)).map((f) => [f.form, f.report])).toEqual([["10-Q", "2025-09-30"], ["10-K", "2025-12-31"]]);
  });
  it("reads Citigroup's missing 10-Qs only (no 10-K, no support)", () => {
    const d = load("C");
    expect(readPlan(d, assessCurrency(d)).every((f) => f.form === "10-Q")).toBe(true);
  });
});

describe("unreadSentence", () => {
  it("names each filing left for the scheduled rebuild (M4)", () => {
    expect(
      unreadSentence([
        { accn: "a", form: "10-Q", filed: "2026-05-07", reason: "budget" },
        { accn: "b", form: "10-Q", filed: "2026-08-06", reason: "budget" },
        { accn: "c", form: "10-K", filed: "2026-02-20", reason: "failed" },
      ]),
    ).toBe(
      "The 10-Q filed on 7 May 2026 and the 10-Q filed on 6 Aug 2026 were not read here, to keep the page light; the scheduled rebuild will add them. The 10-K filed on 20 Feb 2026 could not be read here; the scheduled rebuild will add it.",
    );
  });
});
