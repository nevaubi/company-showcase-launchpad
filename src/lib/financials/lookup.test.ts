import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lookup, normalisePeriod, type Lookup } from "./lookup";
import type { CompanyDataset } from "./types";

const load = (t: string) => JSON.parse(readFileSync(path.resolve(__dirname, `../../../public/data/companies/${t}.json`), "utf8")) as CompanyDataset;
const ok = (r: Lookup | { error: string }) => {
  if ("error" in r) throw new Error(r.error);
  return r;
};

describe("period normalisation", () => {
  it("accepts the ways analysts write fiscal periods", () => {
    expect(normalisePeriod("q2 fy27")).toEqual({ freq: "quarterly", key: "FY2027Q2" });
    expect(normalisePeriod("FY2027Q2")).toEqual({ freq: "quarterly", key: "FY2027Q2" });
    expect(normalisePeriod("fy25")).toEqual({ freq: "annual", key: "FY2025" });
    expect(normalisePeriod("2025")).toEqual({ freq: "annual", key: "FY2025" });
    expect(normalisePeriod("ltm")).toEqual({ freq: "ttm" });
  });
});

describe("statement lookups against the bundled SEC data", () => {
  const aapl = load("AAPL");
  const nvda = load("NVDA");

  it("returns Apple's reported FY2025 net sales from its 10-K", () => {
    const r = ok(lookup(aapl, "revenue", "FY2025"));
    expect(r.value).toBe(416_161_000_000);
    expect(r.cell?.src).toBeTruthy();
  });

  it("returns NVIDIA's Q2 FY27 revenue", () => {
    expect(ok(lookup(nvda, "revenue", "Q2 FY27")).value).toBe(96_221_000_000);
  });

  it("builds TTM as the sum of the four latest quarters", () => {
    const r = ok(lookup(nvda, "revenue", "TTM"));
    const row = nvda.statements.quarterly.income.rows.find((x) => x.key === "revenue")!;
    const sum = r.ttm!.reduce((s, i) => s + row.cells[i]!.v, 0);
    expect(r.ttm).toHaveLength(4);
    expect(r.value).toBe(sum);
  });

  it("explains unknown metrics and periods instead of returning zero", () => {
    expect(lookup(aapl, "notAMetric", "FY2025")).toEqual({ error: 'Unknown metric "notAMetric"' });
    expect("error" in lookup(aapl, "revenue", "FY1990")).toBe(true);
  });
});
