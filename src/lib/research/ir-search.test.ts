import { describe, expect, it } from "vitest";
import type { IrPayload } from "@/lib/ir/payload";
import { irLink, irMap, irSearch, irValue } from "./ir-search";

const payload: IrPayload = {
  v: 2,
  ticker: "HOOD",
  builtAt: "2026-11-16",
  quarters: ["2026-03-31", "2026-06-30", "2026-09-30"],
  years: ["2025-12-31"],
  months: ["2026-10-31"],
  docs: [{ id: "d1", accn: null, doc: null, kind: "press-release", filed: "2026-10-29" }],
  series: [
    { k: "kpi:net deposits", cat: "kpi", met: "other", label: "Net deposits", parent: null, total: false, unit: "usd", q: { "2026-06-30": { v: 13.8e9, d: 0, x: "13.8", p: 3 }, "2026-09-30": { v: 20.4e9, d: 0, x: "20.4", p: 3 } }, y: {}, mo: { "2026-10-31": { v: 5.1e9, d: 0, x: "5.1", p: 1 } } },
    { k: "kpi:funded customers", cat: "kpi", met: "users", label: "Funded customers", parent: null, total: false, unit: "count", pit: true, q: { "2026-09-30": { v: 26.8e6, d: 0, x: "26.8", p: 2 } }, y: {} },
    { k: "segment:transaction revenue", cat: "segment", met: "revenue", label: "Transaction-based revenues", parent: null, total: false, unit: "usd", q: { "2026-06-30": { v: 1.0e9, d: 0, x: "1,000" } }, held: { q: { "2026-09-30": { v: 1e15, d: 0, x: "1", w: "suspect", why: "Reads as more than $10 trillion" } } }, y: {} },
  ],
  groups: [{ id: "g1", cat: "kpi", met: "other", unit: "usd", label: "Net deposits", root: null, rows: [{ k: "kpi:net deposits", depth: 0 }] }],
  checks: [],
  stats: { series: 3, groups: 1, documents: 1, facts: 4, firstPeriod: "2026-06-30", lastPeriod: "2026-10-31", checksQ: { ok: 0, total: 0 }, checksFY: { ok: 0, total: 0 } },
};

describe("assistant IR search", () => {
  it("returns matching values newest first, each linked to the cell that opens its source", () => {
    const r = irSearch(payload, { ticker: "HOOD", query: "net deposits" });
    expect(r.matched).toBe(1);
    const lines = r.output.split("\n");
    expect(lines[2]).toContain("2026-09-30: $20.40B");
    expect(lines[2]).toContain('printed "20.4" p.3, press-release filed 2026-10-29');
    expect(lines[2]).toContain(`<${irLink("HOOD", "kpi:net deposits", "2026-09-30", "q")}>`);
    expect(lines[3]).toContain("2026-06-30: $13.80B");
  });
  it("reads monthly figures when asked", () => {
    const r = irSearch(payload, { ticker: "HOOD", query: "net deposits", freq: "m" });
    expect(r.output).toContain("2026-10-31: $5.10B");
    expect(r.output).toContain("freq=m");
  });
  it("names held-back figures so the model never cites them", () => {
    const out = irSearch(payload, { ticker: "HOOD", query: "transaction revenues" }).output;
    expect(out).toContain("2026-09-30: held back, do not cite (Reads as more than $10 trillion)");
    expect(out).not.toContain("$1000000");
  });
  it("maps what exists when there is no query", () => {
    const m = irMap(payload);
    expect(m).toContain("3 investor-relations series from 1 documents");
    expect(m).toContain("Monthly figures exist for 1 month-ends");
  });
  it("formats dollars at a readable scale", () => {
    expect(irValue(-2.5e6, "usd")).toBe("−$2.5M");
    expect(irValue(26.8e6, "count")).toBe("26.8M");
  });
});
