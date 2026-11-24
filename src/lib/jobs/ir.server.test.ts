import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ from: vi.fn(), fetchSec: vi.fn(), upload: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: mocks.from, storage: { from: () => ({ upload: mocks.upload }) } } }));
vi.mock("@/lib/sec.server", () => ({ fetchSec: mocks.fetchSec, archiveUrl: (c: string, a: string, d: string) => `https://www.sec.gov/${Number(c)}/${a}/${d}` }));
import { collectRecentRelease, releaseDue, RELEASE_RETRY_WAIT_MS } from "./ir.server";
import { COVERAGE } from "@/lib/coverage";

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600000).toISOString();

describe("release collection retry safety", () => {
  afterEach(() => vi.clearAllMocks());
  /**
   * The fake database behaves like the real one where it matters here: `ir_release_scan.status`
   * accepts only done, partial and empty (its check constraint), and any other status is refused
   * with an error, as production did 110 times in a row for one filing on 23 and 24 Nov 2026.
   * `attempt` and `at` are the failed attempts already counted for filing "a" and when the last was.
   */
  function setup(scans: { accn: string; status: string; scanned_at: string }[] = [], attempt = 0, at: string = hoursAgo(0)) {
    const writes: { table: string; value: unknown }[] = [];
    mocks.from.mockImplementation((table: string) => {
      const q: Record<string, unknown> = {};
      let refused: string | null = null;
      for (const m of ["select", "like", "gte", "or", "order", "limit", "in", "eq"]) q[m] = vi.fn(() => q);
      q.upsert = vi.fn((value: unknown) => {
        const status = (value as { status?: string }).status;
        if (table === "ir_release_scan" && !["done", "partial", "empty"].includes(String(status))) refused = 'new row for relation "ir_release_scan" violates check constraint "ir_release_scan_status_check"';
        else writes.push({ table, value });
        return q;
      });
      q.then = (resolve: (value: unknown) => unknown) => Promise.resolve(refused ? { error: { message: refused }, data: null } : { error: null, data: table === "sec_filings" ? ["a", "b"].map(accn => ({ accn, ticker: "AAPL", filed: "2026-11-18", items: "2.02", form: "8-K", report: null })) : table === "ir_release_scan" ? scans : table === "job_state" ? (attempt ? [{ job: "ir-release-retry:a", cursor: attempt, updated_at: at }] : []) : [] }).then(resolve);
      return q;
    });
    mocks.upload.mockResolvedValue({ error: null });
    return writes;
  }
  it("counts a failed attempt in job_state only, and moves past that filing on the next run", async () => {
    const writes = setup();
    mocks.fetchSec.mockRejectedValue(new Error("SEC index unavailable"));
    expect(await collectRecentRelease(COVERAGE)).toMatchObject({ accn: "a", status: "retry" });
    expect(writes).toContainEqual({ table: "job_state", value: expect.objectContaining({ job: "ir-release-retry:a", cursor: 1, paused_reason: "index: SEC index unavailable" }) });
    expect(writes.filter((w) => w.table === "ir_release_scan")).toEqual([]);
    // Next run, minutes later: no scan row exists for "a" (nothing was written), one attempt is counted.
    setup([], 1, hoursAgo(0.1));
    expect(await collectRecentRelease(COVERAGE)).toMatchObject({ accn: "b" });
  });
  it("retries a failed filing once six hours have passed", async () => {
    setup([], 1, hoursAgo(7));
    mocks.fetchSec.mockRejectedValue(new Error("SEC index unavailable"));
    expect(await collectRecentRelease(COVERAGE)).toMatchObject({ accn: "a", status: "retry" });
  });
  it("gives up after three failures with the recorded error retained", async () => {
    const writes = setup([], 2, hoursAgo(7));
    mocks.fetchSec.mockRejectedValue(new Error("bad index"));
    expect(await collectRecentRelease(COVERAGE)).toMatchObject({ accn: "a", status: "error" });
    expect(writes).toContainEqual({ table: "job_state", value: expect.objectContaining({ cursor: 3, paused_reason: "index: bad index" }) });
    setup([], 3, hoursAgo(30));
    expect(await collectRecentRelease(COVERAGE)).toMatchObject({ accn: "b" });
  });
  it("leaves a filing that failed 110 times and collects the one behind it (PNC's 8-K of 23 Nov 2026)", async () => {
    // Production: one exhibit image answered 403 on every run; each run then failed on the scan table's
    // constraint, wrote no scan row, and picked the same filing again, so nothing behind it was collected.
    setup([], 110, hoursAgo(0.05));
    mocks.fetchSec.mockResolvedValue({ text: async () => "" });
    expect(await collectRecentRelease(COVERAGE)).toMatchObject({ accn: "b" });
  });
  it("a download that fails never ends the run with a database error", async () => {
    const writes = setup();
    mocks.fetchSec.mockImplementation(async (url: string) => {
      if (url.endsWith("index.htm")) return { text: async () => '<tr><td>1</td><td>Release</td><td><a href="release.htm">file</a></td><td>EX-99.1</td></tr>' };
      throw new Error("SEC EDGAR responded 403");
    });
    await expect(collectRecentRelease(COVERAGE)).resolves.toMatchObject({ accn: "a", status: "retry", stored: 0, left: 1 });
    expect(writes.map((w) => w.table)).toEqual(["job_state"]);
  });
  it("leaves budget-unstarted files partial, not failed", async () => {
    const writes = setup();
    mocks.fetchSec.mockResolvedValue({ text: async () => '<tr><td>1</td><td>Release</td><td><a href="release.htm">file</a></td><td>EX-99.1</td></tr>' });
    expect(await collectRecentRelease(COVERAGE, () => false)).toMatchObject({ status: "partial", left: 1 });
    expect(writes).toContainEqual({ table: "ir_release_scan", value: expect.objectContaining({ accn: "a", status: "partial" }) });
  });
});

describe("releaseDue", () => {
  const now = Date.parse("2026-11-24T06:00:00Z");
  const at = (hours: number) => new Date(now - hours * 3600000).toISOString();
  it("a filing never scanned and never failed is due", () => {
    expect(releaseDue(undefined, undefined, now)).toBe(true);
  });
  it("done and empty filings are not due, whatever the retry count says", () => {
    expect(releaseDue({ status: "done" }, undefined, now)).toBe(false);
    expect(releaseDue({ status: "empty" }, { attempts: 1, at: at(48) }, now)).toBe(false);
  });
  it("a filing cut short by the run budget is due at once", () => {
    expect(releaseDue({ status: "partial" }, undefined, now)).toBe(true);
  });
  it("after a failed attempt it waits six hours, with or without a scan row", () => {
    expect(releaseDue(undefined, { attempts: 1, at: at(5.9) }, now)).toBe(false);
    expect(releaseDue(undefined, { attempts: 1, at: at(6) }, now)).toBe(true);
    expect(releaseDue({ status: "partial" }, { attempts: 2, at: at(1) }, now)).toBe(false);
    expect(releaseDue({ status: "partial" }, { attempts: 2, at: at(RELEASE_RETRY_WAIT_MS / 3600000 + 1) }, now)).toBe(true);
  });
  it("after three failed attempts it is left alone", () => {
    expect(releaseDue(undefined, { attempts: 3, at: at(100) }, now)).toBe(false);
    expect(releaseDue({ status: "partial" }, { attempts: 110, at: at(0) }, now)).toBe(false);
  });
  it("rows another deployment may have stored as retry or error follow the same rules", () => {
    expect(releaseDue({ status: "error" }, undefined, now)).toBe(false);
    expect(releaseDue({ status: "retry" }, { attempts: 1, at: at(7) }, now)).toBe(true);
    expect(releaseDue({ status: "retry" }, { attempts: 1, at: at(1) }, now)).toBe(false);
  });
  it("a retry row without a readable time is tried again instead of being stuck", () => {
    expect(releaseDue(undefined, { attempts: 1, at: null }, now)).toBe(true);
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
