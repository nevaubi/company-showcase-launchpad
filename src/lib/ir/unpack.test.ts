import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { TIDY_VERSION } from "./tidy";
import { unpackIrPage } from "./unpack";

describe("unpacking the IR page data", () => {
  it("unzips, parses and tidies a stored payload", async () => {
    const payload = {
      v: 2, ticker: "TST", builtAt: "2026-01-01", quarters: ["2025-03-31"], years: [], docs: [], groups: [], checks: [], tidy: 4,
      series: [{ k: "a", cat: "kpi", met: "other", label: "Stores", parent: null, total: false, unit: "count", q: { "2025-03-31": { v: 41, d: 0, e: "2025-03-31" } }, y: {} }],
      stats: { series: 1, groups: 0, documents: 0, facts: 1, firstPeriod: null, lastPeriod: null, checksQ: { ok: 0, total: 0 }, checksFY: { ok: 0, total: 0 } },
    };
    const gz = gzipSync(JSON.stringify({ payload, builtAt: null, documents: [], images: 0, pending: 0 }));
    const out = await unpackIrPage(gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength) as ArrayBuffer);
    expect(out.payload?.tidy).toBe(TIDY_VERSION);
    expect(out.payload?.series[0].q["2025-03-31"].v).toBe(41);
  });
});
// Review iracc M3: an exception in the read-time checks failed the whole page.
describe("unpacking when a check throws", () => {
  it("shows the tidied payload when a read-time check throws", async () => {
    const payload = {
      v: 2, ticker: "TST", builtAt: "", quarters: ["2025-03-31"], years: [], docs: [], groups: [], checks: [],
      series: [{ k: "r", cat: "income", met: "revenue", label: "Revenue", parent: null, total: true, unit: "usd", q: { "2025-03-31": { v: 1e9, d: 0 } }, y: {} }],
      stats: { series: 1, groups: 0, documents: 0, facts: 0, firstPeriod: null, lastPeriod: null, checksQ: { ok: 0, total: 0 }, checksFY: { ok: 0, total: 0 } },
    };
    const gz = await new Response(new Response(JSON.stringify({ payload, builtAt: null, documents: [], images: 0, pending: 0 })).body!.pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
    // malformed statements (no rows) make the cross-check throw
    const st = { quarterly: { periods: [{ end: "2025-03-31" }] } } as unknown as Parameters<typeof unpackIrPage>[1];
    const out = await unpackIrPage(gz, st);
    expect(out.secCheck).toBeNull();
    expect(out.payload?.series.length).toBeGreaterThan(0);
  });
});
