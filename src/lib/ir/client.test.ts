import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { loadIrPage } from "./client";

const payload = {
  v: 2, ticker: "TST", builtAt: "", quarters: ["2025-03-31"], years: [], docs: [], groups: [], checks: [], tidy: 0,
  series: [{ k: "r", cat: "income", met: "revenue", label: "Total revenue", parent: null, total: true, unit: "usd", q: { "2025-03-31": { v: 1e9, d: 0, e: "2025-03-31", m: 3 } }, y: {} }],
  stats: { series: 1, groups: 0, documents: 0, facts: 1, firstPeriod: null, lastPeriod: null, checksQ: { ok: 0, total: 0 }, checksFY: { ok: 0, total: 0 } },
};
const fetchIr = async () => ({ gz: new Response(gzipSync(JSON.stringify({ payload, builtAt: null, documents: [], images: 0, pending: 0 }))).body });
const statements = { quarterly: { periods: [{ end: "2025-03-31" }], rows: [{ key: "revenue", cells: [{ v: 1e9 }] }] } };

describe("loading the IR page with the SEC statements", () => {
  it("runs the cross-check when the statements arrive", async () => {
    const d = await loadIrPage("TST", fetchIr, async () => statements);
    expect(d.secCheck).toMatchObject({ checked: 1, agree: 1 });
    expect(d.secCheckLate).toBeUndefined();
  });
  it("never waits on slow statements beyond the cap, and says so", async () => {
    const t = Date.now();
    const d = await loadIrPage("TST", fetchIr, () => new Promise(() => {}));
    expect(Date.now() - t).toBeLessThan(4000);
    expect(d.secCheck).toBeNull();
    expect(d.secCheckLate).toBe(true);
  });
  it("loads without statements when they fail", async () => {
    const d = await loadIrPage("TST", fetchIr, () => Promise.reject(new Error("x")));
    expect(d.secCheck).toBeNull();
    expect(d.payload?.series).toHaveLength(1);
  });
});
