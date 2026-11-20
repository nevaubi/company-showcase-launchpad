import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";
import { COVERAGE, MACRO_SERIES } from "@/lib/coverage";
import { optionsNight } from "./options-run";

const mocks = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import("@/test/fake-supabase").fakeSupabase>,
  fetchYahoo: vi.fn(),
  fetchFred: vi.fn(),
  fetchSec: vi.fn(),
  fetchEstimates: vi.fn(),
  rank: new Map<string, number>(),
}));
vi.mock("@/lib/estimates.server", () => ({ fetchEstimates: mocks.fetchEstimates }));
vi.mock("@/lib/sec.server", () => ({ fetchSec: mocks.fetchSec, archiveUrl: (_cik: string, accn: string, doc: string) => `${accn}/${doc}` }));
vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return mocks.db.client;
  },
}));
vi.mock("@/lib/jobs/priority.server", () => ({ loadJobRank: async () => mocks.rank }));
vi.mock("@/lib/market-data.server", async () => {
  const real = await vi.importActual<typeof import("@/lib/market-data.server")>("@/lib/market-data.server");
  return {
    pool: real.pool,
    toBars: (r: { bars: unknown[] }) => r.bars,
    fetchYahoo: mocks.fetchYahoo,
    fetchFred: mocks.fetchFred,
    fetchCboeDaily: vi.fn(async () => {
      throw new Error("no cboe");
    }),
    fetchNasdaqDaily: vi.fn(async () => {
      throw new Error("no nasdaq");
    }),
    fetchTreasury: vi.fn(async () => {
      throw new Error("no treasury");
    }),
    isCboeIndex: () => false,
    isTreasurySeries: () => false,
  };
});
import { runJob } from "./jobs.server";

const nowIso = () => new Date().toISOString();
const st = (job: string, cursor: number, paused_reason: string | null = null) => ({ job, cursor, paused_reason, updated_at: nowIso() });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rank = new Map();
  mocks.db = fakeSupabase();
});
afterEach(() => vi.unstubAllGlobals());

describe("commit-after-work cursors", () => {
  it("prunes old job_runs except vendor-backfill when the prices cursor wraps after a stored slice", async () => {
    const total = COVERAGE.length + 30; // benchmarks follow the coverage list
    mocks.db = fakeSupabase({ job_state: [st("prices", total - 10)] });
    mocks.fetchYahoo.mockImplementation(async () => ({ bars: [["2026-11-19", 10, 11, 9, 10.5, 10.5, 100]] }));
    const r = await runJob("prices");
    expect(r.ok).toBe(true);
    const deletes = mocks.db.writes.filter((w) => w.op === "delete").map((w) => w.table);
    expect(deletes).toEqual(["market_bars", "job_runs"]);
    expect(mocks.db.state("prices")!.cursor).toBe(0);
  });

  it("holds the macro cursor when every series fails, then skips the slice after three tries", async () => {
    mocks.db = fakeSupabase({ job_state: [st("macro", 8)] });
    mocks.fetchFred.mockRejectedValue(new Error("FRED responded 503"));
    for (let i = 0; i < 3; i++) {
      const r = await runJob("macro");
      expect(r.ok).toBe(false);
      expect(mocks.db.state("macro")!.cursor).toBe(8);
    }
    mocks.fetchFred.mockResolvedValue([["2026-11-19", 4.1]]);
    const r = await runJob("macro");
    expect(r.detail.skipped).toMatch(/slice at 8 skipped after 3 tries/);
    expect(r.detail.at).toBe(12);
    expect(mocks.db.state("macro")!.cursor).toBe(16 % MACRO_SERIES.length);
  });

  it("a run cut off before its commit repeats the same slice (the claim alone does not move the cursor)", async () => {
    mocks.db = fakeSupabase({ job_state: [st("macro", 4)] });
    // a hung source: the claim is written, the run never reaches the commit
    mocks.fetchFred.mockImplementation(() => new Promise(() => undefined));
    void runJob("macro");
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.db.state("macro")!.cursor).toBe(4);
    expect(mocks.db.state("macro-slice")!.cursor).toBe(41); // start 4, attempt 1
    mocks.fetchFred.mockResolvedValue([["2026-11-19", 4.1]]);
    const r = await runJob("macro");
    expect(r.detail.at).toBe(4);
    expect(r.detail.attempt).toBe(2);
    expect(mocks.db.state("macro")!.cursor).toBe(8);
  });

  it("filing-cache holds its slot on an SEC error instead of losing the company for a lap", async () => {
    mocks.db = fakeSupabase({ job_state: [st("filing-cache", 10)] });
    mocks.fetchSec.mockRejectedValue(Object.assign(new Error("SEC EDGAR responded 429"), { status: 429 }));
    const r = await runJob("filing-cache");
    expect(r.ok).toBe(false);
    expect(mocks.db.state("filing-cache")!.cursor).toBe(10);
  });

  it("prices rejects a bar whose open lies above its high and reports it", async () => {
    mocks.db = fakeSupabase({ job_state: [st("prices", 0)] });
    mocks.fetchYahoo.mockImplementation(async (s: string) => ({
      bars: [
        ["2026-11-18", 10, 11, 9, 10.5, 10.5, 100],
        ["2026-11-19", s === "AAPL" ? 53.47 : 10, s === "AAPL" ? 52.44 : 11, 9, 10.5, 10.5, 100],
      ],
    }));
    const r = await runJob("prices");
    const stored = (mocks.db.tables.market_bars ?? []).filter((b) => b.symbol === "AAPL");
    expect(stored.map((b) => b.date)).toEqual(["2026-11-18"]);
    expect(r.detail.flagged).toEqual([expect.stringContaining("AAPL 2026-11-19: open 53.47 above high 52.44")]);
  });

  it("rotating jobs walk the top of the dv20 rank first", async () => {
    mocks.rank = new Map(COVERAGE.slice(-4).map((c, i) => [c.ticker, i + 1]));
    mocks.fetchYahoo.mockImplementation(async () => ({ bars: [] }));
    const r = await runJob("prices");
    expect((r.detail.symbols as string[]).slice(0, 4)).toEqual(COVERAGE.slice(-4).map((c) => c.ticker));
  });
});

describe("options: blocked is not 'no options'", () => {
  const night = () => optionsNight(Date.now());
  function chains(byTicker: (t: string) => number | { status: number; body?: unknown }) {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const t = decodeURIComponent(url.split("/").pop()!.replace(/\.json$/, "")).replace(/^_/, "");
        calls.push(t);
        const r = byTicker(t);
        const status = typeof r === "number" ? r : r.status;
        const body = typeof r === "number" ? {} : r.body;
        return new Response(JSON.stringify(body ?? {}), { status });
      }),
    );
    return calls;
  }
  const seed = (cursor: number, extra: ReturnType<typeof st>[] = []) => (mocks.db = fakeSupabase({ job_state: [st("options", cursor), st("options-night", night()), ...extra] }));

  it("four 403s confirmed by SPY: run not ok, cursor held, backoff and Cboe circuit written, nothing stored", async () => {
    seed(8);
    const calls = chains(() => 403);
    const before = Math.floor(Date.now() / 1000);
    const r = await runJob("options");
    expect(r.ok).toBe(false);
    expect(calls).toContain("SPY");
    expect(mocks.db.state("options")!.cursor).toBe(8);
    const b = mocks.db.state("options-backoff")!;
    expect(b.cursor).toBeGreaterThanOrEqual(before + 90);
    expect(b.paused_reason).toMatch(/^blocked: Cboe refused option chains \(403 x4, 429 x0\) \[n=1\]$/);
    expect(mocks.db.state("provider:cboe")!.paused_reason).toMatch(/^rate: /);
    expect(mocks.db.tables.options_daily ?? []).toHaveLength(0);
    expect(r.detail.blocked).toHaveLength(4);
  });

  it("four 404s: no listed options, run ok, cursor advanced", async () => {
    seed(8);
    chains(() => 404);
    const r = await runJob("options");
    expect(r.ok).toBe(true);
    expect(mocks.db.state("options")!.cursor).toBe(12);
    expect(r.detail.none).toHaveLength(4);
    expect(mocks.db.state("options-backoff")).toBeUndefined();
  });

  it("four 403s while SPY answers: the symbols are unlisted, not blocked", async () => {
    seed(8);
    chains((t) => (t === "SPY" ? 200 : 403));
    const r = await runJob("options");
    expect(r.ok).toBe(true);
    expect(r.detail.none).toHaveLength(4);
    expect(mocks.db.state("options")!.cursor).toBe(12);
  });

  it("a 429 holds the slice without spending one of its three tries", async () => {
    seed(8);
    chains(() => 429);
    await runJob("options");
    await runJob("options").catch(() => undefined);
    // the second run is idle (backoff), the slice keeps attempt 0
    expect(mocks.db.state("options-slice")!.cursor).toBe(80);
    expect(mocks.db.state("options")!.cursor).toBe(8);
  });

  it("makes no request while the backoff is in the future", async () => {
    seed(8, [st("options-backoff", Math.floor(Date.now() / 1000) + 600, "blocked: Cboe refused option chains (403 x4, 429 x0) [n=2]")]);
    const calls = chains(() => 200);
    const r = await runJob("options");
    expect(calls).toHaveLength(0);
    expect(r.detail.idle).toBe(true);
  });

  it("the next block doubles the wait", async () => {
    seed(8, [st("options-backoff", Math.floor(Date.now() / 1000) - 1, "blocked: Cboe refused option chains (403 x4, 429 x0) [n=2]")]);
    chains(() => 429);
    await runJob("options");
    expect(mocks.db.state("options-backoff")!.paused_reason).toMatch(/\[n=3\]$/);
  });

  it("stored chains after a block clear the backoff and close the Cboe circuit", async () => {
    const chain = { current_price: 100, last_trade_time: "2026-11-19T21:00:00", options: [] };
    seed(8, [st("options-backoff", Math.floor(Date.now() / 1000) - 1, "blocked: x [n=2]"), st("provider:cboe", Math.floor(Date.now() / 1000) - 1, "rate: x [n=2]")]);
    vi.doMock("@/lib/options/core", async () => {
      const real = await vi.importActual<typeof import("@/lib/options/core")>("@/lib/options/core");
      return { ...real, summarizeChain: (t: string) => ({ ticker: t, date: "2026-11-19" }), snapshotRow: (s: { ticker: string; date: string }) => ({ ticker: s.ticker, date: s.date, term: [] }) };
    });
    chains(() => ({ status: 200, body: { data: chain } }));
    const r = await runJob("options");
    vi.doUnmock("@/lib/options/core");
    expect(r.ok).toBe(true);
    expect(r.items).toBe(4);
    expect(mocks.db.state("options-backoff")!.paused_reason).toBeNull();
    expect(mocks.db.state("provider:cboe")!.paused_reason).toBeNull();
  });

  it("a new night starts again at the top of the ranked list", async () => {
    mocks.db = fakeSupabase({ job_state: [st("options", 400), st("options-night", 20200101)] });
    chains(() => 404);
    const r = await runJob("options");
    expect(r.detail.at).toBe(0);
    expect(mocks.db.state("options-night")!.cursor).toBe(night());
  });
});

describe("estimates: missing coverage first, then the stalest", () => {
  const old = (t: string, days: number) => ({ ticker: t, payload: {}, fetched_at: new Date(Date.now() - days * 86400_000).toISOString() });
  it("fills the slots with covered tickers that have no estimates, in rank order, before refreshing stale rows", async () => {
    mocks.db = fakeSupabase({ analyst_estimates: [old("OLD", 1)] });
    mocks.fetchEstimates.mockImplementation(async (ticker: string) => ({ ticker, asOf: nowIso() }));
    const r = await runJob("estimates");
    expect(r.items).toBe(3);
    expect(mocks.fetchEstimates.mock.calls.map((c) => c[0])).toEqual(COVERAGE.slice(0, 3).map((c) => c.ticker));
    expect(mocks.db.state("estimates-new")!.cursor).toBe(3);
  });
  it("keeps one slot for a stored row older than a week", async () => {
    mocks.db = fakeSupabase({ analyst_estimates: [old("OLD", 9)] });
    mocks.fetchEstimates.mockImplementation(async (ticker: string) => ({ ticker, asOf: nowIso() }));
    await runJob("estimates");
    expect(mocks.fetchEstimates.mock.calls.map((c) => c[0])).toEqual([COVERAGE[0].ticker, COVERAGE[1].ticker, "OLD"]);
  });
  it("skips tickers that already have a row and tickers with a fresh 'no estimates' receipt", async () => {
    const [a, b, c] = COVERAGE.map((x) => x.ticker);
    mocks.db = fakeSupabase({ analyst_estimates: [{ ticker: a, payload: {}, fetched_at: nowIso() }], job_state: [st(`estimates-none:${b}`, 1)] });
    mocks.fetchEstimates.mockImplementation(async (ticker: string) => ({ ticker, asOf: nowIso() }));
    await runJob("estimates");
    const called = mocks.fetchEstimates.mock.calls.map((x) => x[0]);
    expect(called[0]).toBe(c);
    expect(called).not.toContain(a);
    expect(called).not.toContain(b);
  });
  it("a 'no estimates' answer writes a receipt, not a provider cooldown", async () => {
    mocks.db = fakeSupabase();
    mocks.fetchEstimates.mockImplementation(async (ticker: string) => {
      if (ticker === COVERAGE[0].ticker) throw new Error(`No estimates for ${ticker}`);
      return { ticker, asOf: nowIso() };
    });
    const r = await runJob("estimates");
    expect(r.detail.none).toEqual([COVERAGE[0].ticker]);
    expect(mocks.db.state(`estimates-none:${COVERAGE[0].ticker}`)).toBeDefined();
    expect(mocks.db.state("estimates-backoff")).toBeUndefined();
    expect(r.items).toBe(2);
  });
  it("stops on the first provider error and stores a thirty-minute cooldown without moving the scan", async () => {
    mocks.db = fakeSupabase();
    mocks.fetchEstimates.mockRejectedValue(new Error("HTTP 429"));
    const before = Math.floor(Date.now() / 1000);
    expect((await runJob("estimates")).ok).toBe(false);
    expect(mocks.fetchEstimates).toHaveBeenCalledTimes(1);
    expect(mocks.db.state("estimates-backoff")!.cursor).toBeGreaterThanOrEqual(before + 1800);
    expect(mocks.db.state("estimates-new")).toBeUndefined();
  });
  it("makes no provider call during the persisted cooldown", async () => {
    mocks.db = fakeSupabase({ job_state: [st("estimates-backoff", Math.ceil(Date.now() / 1000) + 1800)] });
    expect((await runJob("estimates")).items).toBe(0);
    expect(mocks.fetchEstimates).not.toHaveBeenCalled();
  });
});

describe("sec walk: Form 4 parsing and earnings events", () => {
  const today = () => new Date().toISOString().slice(0, 10);
  function submissions(forms: string[], items: string[] = [], documents: string[] = []) {
    let company = 0;
    mocks.fetchSec.mockImplementation(async (url: string) => {
      if (url.includes("submissions")) {
        const active = company++ === 0;
        return {
          json: async () => ({
            filings: {
              recent: {
                accessionNumber: active ? forms.map((_, i) => `accn-${i}`) : [],
                form: forms,
                filingDate: forms.map(() => today()),
                reportDate: [],
                primaryDocument: forms.map((_, i) => `file-${i}.xml`),
                primaryDocDescription: [],
                items,
                isInlineXBRL: [],
                size: [],
              },
            },
          }),
        };
      }
      const index = Number(url.match(/file-(\d+)/)?.[1]);
      if (documents[index] === "error") throw new Error("bad filing");
      return { text: async () => documents[index] };
    });
  }
  const common = "<ownershipDocument><nonDerivativeTransaction><transactionAmounts><transactionShares><value>25</value></transactionShares></transactionAmounts></nonDerivativeTransaction></ownershipDocument>";
  const derivative = "<ownershipDocument><derivativeTransaction></derivativeTransaction></ownershipDocument>";
  const trades = () => mocks.db.tables.insider_trades ?? [];

  it("includes 4/A amendments", async () => {
    submissions(["4/A"], [], [common]);
    await runJob("sec");
    expect(trades()).toMatchObject([{ accn: "accn-0", shares: 25 }]);
  });
  it("receipts derivative-only filings without inventing insider trades", async () => {
    submissions(["4"], [], [derivative]);
    await runJob("sec");
    expect(mocks.db.state("form4-seen:accn-0")).toBeDefined();
    expect(trades()).toHaveLength(0);
  });
  it("already-receipted filings do not occupy the two parsing slots", async () => {
    mocks.db = fakeSupabase({ job_state: [st("form4-seen:accn-0", 0), st("form4-seen:accn-1", 0)] });
    submissions(["4", "4", "4/A"], [], [derivative, derivative, common]);
    await runJob("sec");
    expect(trades()).toMatchObject([{ accn: "accn-2" }]);
  });
  it("continues after one filing fails and leaves it unreceipted for retry", async () => {
    submissions(["4", "4/A"], [], ["error", common]);
    const r = await runJob("sec");
    expect(trades()).toMatchObject([{ accn: "accn-1" }]);
    expect(r.detail.errors).toEqual([expect.stringContaining("accn-0: bad filing")]);
    expect(mocks.db.state("form4-seen:accn-0")).toBeUndefined();
  });
  it("does not mark malformed XML as a successfully parsed empty filing", async () => {
    submissions(["4"], [], ["<html>Error</html>"]);
    const r = await runJob("sec");
    expect(r.detail.errors).toEqual([expect.stringContaining("Invalid ownership XML")]);
    expect(mocks.db.state("form4-seen:accn-0")).toBeUndefined();
  });
  it("re-asserts the earnings event of an 8-K 2.02 that is already stored but has no event (the lost-write case)", async () => {
    mocks.db = fakeSupabase({ sec_filings: [{ accn: "accn-0", ticker: COVERAGE[0].ticker, form: "8-K", items: "2.02,9.01" }] });
    submissions(["8-K"], ["2.02,9.01"]);
    await runJob("sec");
    expect(mocks.db.tables.earnings_events).toMatchObject([{ ticker: COVERAGE[0].ticker, accn: "accn-0", source: "sec-8k-2.02" }]);
  });
  it("reports a failed earnings-event write instead of ignoring it", async () => {
    mocks.db = fakeSupabase({}, { failUpsert: (t) => (t === "earnings_events" ? "permission denied" : null) });
    submissions(["8-K"], ["2.02"]);
    const r = await runJob("sec");
    expect(r.detail.errors).toEqual([expect.stringContaining("earnings events: permission denied")]);
    expect(r.ok).toBe(false);
  });
  it("moves the cursor past the companies that were synced", async () => {
    mocks.db = fakeSupabase({ job_state: [st("sec", 0)] });
    submissions([]);
    await runJob("sec");
    expect(mocks.db.state("sec")!.cursor).toBe(4);
  });
});

describe("sec walk: a company that changed registrant (XOM)", () => {
  const block = (rows: [string, string, string, string][]) => ({
    filings: {
      recent: {
        accessionNumber: rows.map((r) => r[0]),
        form: rows.map((r) => r[1]),
        filingDate: rows.map((r) => r[2]),
        items: rows.map((r) => r[3]),
        reportDate: rows.map(() => ""),
        primaryDocument: rows.map((r) => `${r[0]}.htm`),
        primaryDocDescription: rows.map(() => ""),
        isInlineXBRL: rows.map(() => 0),
        size: rows.map(() => 0),
      },
    },
  });
  it("reads every CIK of the company and records each filing under the CIK whose index lists it", async () => {
    const { syncCompany } = await import("./jobs.server");
    const { coverageOf } = await import("@/lib/coverage");
    const xom = coverageOf("XOM")!;
    const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    const urls: string[] = [];
    mocks.fetchSec.mockImplementation(async (url: string) => {
      urls.push(url);
      if (url.includes("CIK0002115436"))
        return { json: async () => block([["0002115436-26-000020", "10-Q", day(18), ""], ["0002115436-26-000018", "8-K", day(21), "2.02,7.01"], ["0000034088-26-000093", "10-Q", day(40), ""]]) };
      if (url.includes("CIK0000034088")) return { json: async () => block([["0000034088-26-000093", "10-Q", day(40), ""], ["0000034088-26-000088", "8-K", day(44), "7.01"]]) };
      throw new Error(`unexpected ${url}`);
    });
    const r = await syncCompany(xom, day(45), { form4: false });
    expect(r.errors).toEqual([]);
    expect(urls.filter((u) => u.includes("submissions"))).toEqual(["https://data.sec.gov/submissions/CIK0002115436.json", "https://data.sec.gov/submissions/CIK0000034088.json"]);
    const filings = mocks.db.tables.sec_filings as { accn: string; cik: string }[];
    expect(Object.fromEntries(filings.map((f) => [f.accn, f.cik]))).toEqual({
      "0002115436-26-000020": "2115436",
      "0002115436-26-000018": "2115436",
      "0000034088-26-000093": "2115436",
      "0000034088-26-000088": "34088",
    });
    expect(mocks.db.tables.earnings_events).toMatchObject([{ ticker: "XOM", accn: "0002115436-26-000018" }]);
  });
});
