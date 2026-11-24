import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { TIDY_VERSION } from "./tidy";
import { checkLate, unpackIrPage } from "./unpack";

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

// Slow load (reports/iracc.md): statements that arrived after the page was shown were never checked.
describe("the SEC check for statements that arrive late", () => {
  const payload = {
    v: 2, ticker: "TST", builtAt: "", quarters: ["2025-03-31", "2025-06-30"], years: [], docs: [], groups: [], checks: [],
    series: [{ k: "r", cat: "income", met: "revenue", label: "Revenue", parent: null, total: true, unit: "usd", q: { "2025-03-31": { v: 1e9, d: 0 }, "2025-06-30": { v: 1.5e9, d: 0 } }, y: {} }],
    stats: { series: 1, groups: 0, documents: 0, facts: 0, firstPeriod: null, lastPeriod: null, checksQ: { ok: 0, total: 0 }, checksFY: { ok: 0, total: 0 } },
  };
  const late = async () => {
    const gz = await new Response(new Response(JSON.stringify({ payload, builtAt: null, documents: [], images: 0, pending: 0 })).body!.pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
    return { ...(await unpackIrPage(gz, null)), secCheckLate: true };
  };
  const st = { quarterly: { periods: [{ end: "2025-03-31" }, { end: "2025-06-30" }], rows: [{ key: "revenue", cells: [{ v: 1e9, src: { accn: "0000000000-25-000001", concept: "Revenues" } }, { v: 1.2e9, src: { accn: "0000000000-25-000002", concept: "Revenues" } }] }] } } as unknown as Parameters<typeof checkLate>[1];

  it("runs the check on the shown payload when the statements come: same lines, now checked and flagged", async () => {
    const shown = await late();
    expect(shown.secCheck).toBeNull();
    const out = checkLate(shown, st);
    expect(out.secCheckLate).toBe(false);
    expect(out.secCheck).toMatchObject({ checked: 2, agree: 1 });
    expect(out.secCheck!.flagged + out.secCheck!.held).toBe(1);
    expect(out.payload!.series.map((s) => s.k)).toEqual(shown.payload!.series.map((s) => s.k));
    // Nothing is corrected: the shown figure keeps its value whatever the check says.
    const cell = out.payload!.series[0].q["2025-06-30"] ?? out.payload!.series[0].held?.q?.["2025-06-30"];
    expect(cell!.v).toBe(1.5e9);
  });

  it("ends the wait without blanking the page when the statements fail or the check throws", async () => {
    const shown = await late();
    const none = checkLate(shown, null);
    expect(none.secCheckLate).toBe(false);
    expect(none.payload).toBe(shown.payload);
    const broken = checkLate(shown, { quarterly: { periods: [{ end: "2025-03-31" }] } } as unknown as Parameters<typeof checkLate>[1]);
    expect(broken.secCheckLate).toBe(false);
    expect(broken.secCheck).toBeNull();
    expect(broken.payload).toBe(shown.payload);
  });
});
