import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ from: vi.fn(), fetchSec: vi.fn(), upload: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: mocks.from, storage: { from: () => ({ upload: mocks.upload }) } } }));
vi.mock("@/lib/sec.server", () => ({ fetchSec: mocks.fetchSec, archiveUrl: (_c: string, a: string, d: string) => `https://www.sec.gov/${a}/${d}` }));
import { collectRecentRelease } from "./ir.server";
import { COVERAGE } from "@/lib/coverage";

describe("release collection retry safety", () => {
  afterEach(() => vi.clearAllMocks());
  function setup(scans: { accn: string; status: string; scanned_at: string }[] = [], attempt = 0) {
    const writes: { table: string; value: unknown }[] = [];
    mocks.from.mockImplementation((table: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "like", "gte", "or", "order", "limit", "in", "eq"]) q[m] = vi.fn(() => q);
      q.upsert = vi.fn((value: unknown) => { writes.push({ table, value }); return q; });
      q.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null, data: table === "sec_filings" ? ["a", "b"].map(accn => ({ accn, ticker: "AAPL", filed: "2026-11-18", items: "2.02", form: "8-K", report: null })) : table === "ir_release_scan" ? scans : table === "job_state" ? [{ job: "ir-release-retry:a", cursor: attempt }] : [] }).then(resolve);
      return q;
    });
    mocks.upload.mockResolvedValue({ error: null });
    return writes;
  }
  it("records an index failure and moves past that filing on subsequent runs", async () => {
    const writes = setup();
    mocks.fetchSec.mockRejectedValue(new Error("SEC index unavailable"));
    expect(await collectRecentRelease(COVERAGE)).toMatchObject({ accn: "a", status: "retry" });
    expect(writes).toContainEqual({ table: "job_state", value: expect.objectContaining({ cursor: 1, paused_reason: "index: SEC index unavailable" }) });
    setup([{ accn: "a", status: "retry", scanned_at: new Date().toISOString() }], 1);
    expect(await collectRecentRelease(COVERAGE)).toMatchObject({ accn: "b", status: "retry" });
  });
  it("gives up after three failures with the recorded error retained", async () => {
    const writes = setup([], 2);
    mocks.fetchSec.mockRejectedValue(new Error("bad index"));
    expect(await collectRecentRelease(COVERAGE)).toMatchObject({ status: "error" });
    expect(writes).toContainEqual({ table: "job_state", value: expect.objectContaining({ cursor: 3, paused_reason: "index: bad index" }) });
  });
  it("does not mark a failed file download done", async () => {
    setup();
    mocks.fetchSec.mockImplementation(async (url: string) => {
      if (url.endsWith("index.htm")) return { text: async () => '<tr><td>1</td><td>Release</td><td><a href="release.htm">file</a></td><td>EX-99.1</td></tr>' };
      throw new Error("download failed");
    });
    expect(await collectRecentRelease(COVERAGE)).toMatchObject({ status: "retry", stored: 0, left: 1 });
  });
  it("leaves budget-unstarted files partial, not failed", async () => {
    setup();
    mocks.fetchSec.mockResolvedValue({ text: async () => '<tr><td>1</td><td>Release</td><td><a href="release.htm">file</a></td><td>EX-99.1</td></tr>' });
    expect(await collectRecentRelease(COVERAGE, () => false)).toMatchObject({ status: "partial", left: 1 });
  });
});