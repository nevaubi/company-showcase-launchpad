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
