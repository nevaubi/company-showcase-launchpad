import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ from: vi.fn(), fetchSec: vi.fn(), upload: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: mocks.from, storage: { from: () => ({ upload: mocks.upload }) } } }));
vi.mock("@/lib/sec.server", () => ({ fetchSec: mocks.fetchSec, archiveUrl: (c: string, a: string, d: string) => `https://www.sec.gov/${Number(c)}/${a}/${d}` }));
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
describe("release exhibits of a company that changed registrant (XOM)", () => {
  it("lists 2.02/7.01 8-Ks from every CIK and opens each filing's index under the CIK that lists it", async () => {
    const { secExhibitCandidates, exhibitsOf } = await import("./ir.server");
    const xom = COVERAGE.find((c) => c.ticker === "XOM")!;
    const page = (rows: [string, string, string][]) => ({ json: async () => ({ filings: { recent: { accessionNumber: rows.map((r) => r[0]), form: rows.map(() => "8-K"), filingDate: rows.map((r) => r[1]), items: rows.map((r) => r[2]), reportDate: rows.map(() => "") }, files: [] } }) });
    const urls: string[] = [];
    mocks.fetchSec.mockImplementation(async (url: string) => {
      urls.push(url);
      if (url.includes("CIK0002115436")) return page([["0002115436-26-000018", "2026-10-30", "2.02,7.01"]]);
      if (url.includes("CIK0000034088")) return page([["0000034088-26-000065", "2026-05-01", "2.02,7.01"]]);
      return { text: async () => "" };
    });
    const c = await secExhibitCandidates(xom, "2026-01-01");
    expect(c.map((x) => [x.accn, x.cik])).toEqual([["0002115436-26-000018", "2115436"], ["0000034088-26-000065", "34088"]]);
    await exhibitsOf(xom, c[1]);
    expect(urls.at(-1)).toBe("https://www.sec.gov/34088/0000034088-26-000065/0000034088-26-000065-index.htm");
    await exhibitsOf(xom, c[0]);
    expect(urls.at(-1)).toBe("https://www.sec.gov/2115436/0002115436-26-000018/0002115436-26-000018-index.htm");
  });
});
