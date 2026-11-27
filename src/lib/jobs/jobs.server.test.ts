import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";
import { COVERAGE, MACRO_SERIES } from "@/lib/coverage";

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
import { fetchNasdaqDaily } from "@/lib/market-data.server";

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

  it("a general prices fallback cannot replace older Yahoo adjusted closes used by nightly setups", async () => {
    const previous = { symbol: "AAPL", date: "2020-03-02", close: 112, adj_close: 95, updated_at: "2020-03-03T00:00:00Z" };
    mocks.db = fakeSupabase({ market_bars: [previous], job_state: [st("prices", 0)] });
    mocks.fetchYahoo.mockRejectedValue(new Error("no Yahoo"));
    vi.mocked(fetchNasdaqDaily).mockResolvedValueOnce([
      ["2020-03-02", 111, 114, 110, 112, 112, 20],
      ["2020-03-03", 108, 110, 104, 106, 106, 25],
    ]);
    await runJob("prices");
    expect(mocks.db.tables.market_bars.filter(r => r.symbol === "AAPL")).toEqual([
      previous, expect.objectContaining({ date: "2020-03-03", adj_close: 106 }),
    ]);
  });

  it("rotating jobs walk the top of the dv20 rank first", async () => {
    mocks.rank = new Map(COVERAGE.slice(-4).map((c, i) => [c.ticker, i + 1]));
    mocks.fetchYahoo.mockImplementation(async () => ({ bars: [] }));
    const r = await runJob("prices");
    expect((r.detail.symbols as string[]).slice(0, 4)).toEqual(COVERAGE.slice(-4).map((c) => c.ticker));
  });
});

describe("options: the app job is the second lane behind the worker", () => {
  // Friday 27 Nov 2026 22:30 UTC = 17:30 in New York: 70 minutes into the collection window
  const NOW = Date.parse("2026-11-27T22:30:00Z");
  const CLOSE = Date.parse("2026-11-27T18:00:02Z") / 1000; // an early close
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  /** A small finished-session chain for one stock: one expiry 21 days out, quoted both sides at three strikes. */
  const chain = (t: string, over: { state?: string; at?: number } = {}) => ({
    optionChain: {
      result: [
        {
          underlyingSymbol: t,
          quote: { regularMarketPrice: 100, regularMarketTime: over.at ?? CLOSE, marketState: over.state ?? "POST" },
          options: [
            {
              expirationDate: Date.parse("2026-12-18T00:00:00Z") / 1000,
              calls: [[95, 6.4], [100, 3.4], [105, 1.5]].map(([k, px]) => ({ contractSymbol: `${t.replace("-", "")}261218C${String(k! * 1000).padStart(8, "0")}`, strike: k, bid: px! - 0.05, ask: px! + 0.05, volume: 3, openInterest: 30 })),
              puts: [[95, 1.3], [100, 3.2], [105, 6.3]].map(([k, px]) => ({ contractSymbol: `${t.replace("-", "")}261218P${String(k! * 1000).padStart(8, "0")}`, strike: k, bid: px! - 0.05, ask: px! + 0.05, volume: 2, openInterest: 60 })),
            },
          ],
          error: null,
        },
      ],
      error: null,
    },
  });
  /** Yahoo and the page reader. `yahoo(t)` answers a status or a body for the chain request. */
  function net(yahoo: (t: string) => number | object, reader: (t: string) => number | object = () => 500) {
    const calls = { direct: [] as string[], reader: [] as string[], session: 0 };
    const symbol = (u: string) => decodeURIComponent(/\/options\/([^?]+)/.exec(u)![1]!);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { body?: string }) => {
        if (url.startsWith("https://fc.yahoo.com")) return new Response("", { status: 404, headers: { "set-cookie": "A3=abc; Domain=.yahoo.com" } });
        if (url.includes("/v1/test/getcrumb")) return (calls.session++, new Response("crumb123", { status: 200 }));
        if (url.includes("firecrawl")) {
          const t = symbol((JSON.parse(init!.body!) as { url: string }).url);
          calls.reader.push(t);
          const r = reader(t);
          return typeof r === "number" ? new Response("{}", { status: r }) : new Response(JSON.stringify({ success: true, data: { rawHtml: JSON.stringify(r), metadata: { statusCode: 200 } } }), { status: 200 });
        }
        const t = symbol(url);
        calls.direct.push(t);
        const r = yahoo(t);
        return typeof r === "number" ? new Response("{}", { status: r }) : new Response(JSON.stringify(r), { status: 200 });
      }),
    );
    return calls;
  }
  const first = COVERAGE.slice(0, 2).map((c) => c.ticker);
  const rate = { series_id: "DGS3MO", date: "2026-11-24", value: 4.36 };
  const silent = new Date(NOW - 40 * 60_000).toISOString();

  it("does nothing while the worker is collecting", async () => {
    mocks.db = fakeSupabase({ job_state: [{ ...st("options-collect", 300, "session:20261127"), updated_at: new Date(NOW - 5 * 60_000).toISOString() }] });
    const calls = net(() => 200);
    const r = await runJob("options");
    expect(r).toMatchObject({ ok: true, items: 0, detail: { idle: true, by: "worker" } });
    expect(calls.direct).toHaveLength(0);
  });

  it("is idle once the worker finished the session, and outside the window", async () => {
    mocks.db = fakeSupabase({ job_state: [{ ...st("options-collect", 1844, "session:20261127 done"), updated_at: silent }] });
    expect((await runJob("options")).detail.idle).toBe(true);
    vi.setSystemTime(Date.parse("2026-11-27T19:00:00Z"));
    mocks.db = fakeSupabase();
    expect((await runJob("options")).detail.idle).toBe(true);
  });

  it("reads two stocks from Yahoo when the worker has been silent, and stores them with their source", async () => {
    mocks.db = fakeSupabase({ job_state: [{ ...st("options-collect", 300, "session:20261127"), updated_at: silent }], macro_observations: [rate] });
    const calls = net((t) => chain(t));
    const r = await runJob("options");
    expect(r.ok).toBe(true);
    expect(r.items).toBe(2);
    expect(calls.direct).toEqual(first);
    expect(calls.reader).toHaveLength(0);
    const rows = mocks.db.tables["options_daily"]!;
    expect(rows.map((x) => x["ticker"])).toEqual(first);
    expect(rows[0]).toMatchObject({ date: "2026-11-27", price: 100, source: "yahoo" });
    expect(rows[0]!["meta"]).toMatchObject({ state: "POST", route: "direct", rate: 0.0436, rateDate: "2026-11-24" });
    // its own place moves; the worker's row is left alone
    expect(mocks.db.state("options-app")).toMatchObject({ cursor: 2, paused_reason: "session:20261127" });
    expect(mocks.db.state("options-collect")!.cursor).toBe(300);
  });

  it("goes through the page reader when Yahoo refuses the app server, and counts the requests", async () => {
    mocks.db = fakeSupabase({ macro_observations: [rate] });
    const env = process.env["FIRECRAWL_API_KEY"];
    process.env["FIRECRAWL_API_KEY"] = "fc-test";
    const calls = net(() => 429, (t) => chain(t));
    const r = await runJob("options");
    process.env["FIRECRAWL_API_KEY"] = env;
    expect(r.ok).toBe(true);
    expect(r.items).toBe(2);
    expect([...calls.reader].sort()).toEqual([...first].sort());
    expect(mocks.db.tables["options_daily"]![0]!["meta"]).toMatchObject({ route: "reader" });
    expect(mocks.db.state("options-reader")).toMatchObject({ cursor: 2, paused_reason: "session:20261127" });
  });

  it("both routes refused: not ok, place held, nothing stored, next try after five minutes", async () => {
    mocks.db = fakeSupabase({ macro_observations: [rate] });
    const env = process.env["FIRECRAWL_API_KEY"];
    process.env["FIRECRAWL_API_KEY"] = "fc-test";
    net(() => 429, () => 402);
    const r = await runJob("options");
    process.env["FIRECRAWL_API_KEY"] = env;
    expect(r.ok).toBe(false);
    expect(mocks.db.tables["options_daily"] ?? []).toHaveLength(0);
    const row = mocks.db.state("options-app")!;
    expect(row.cursor).toBe(0);
    expect(row.paused_reason).toMatch(/^session:20261127 blocked until 2026-11-27T22:35:00\.000Z Yahoo refused the app server \(HTTP 402\) and the page reader was refused too \[n=1\]$/);
    // and it makes no request until then
    const calls = net(() => 200);
    vi.setSystemTime(NOW + 60_000);
    expect((await runJob("options")).detail.idle).toBe(true);
    expect(calls.direct).toHaveLength(0);
  });

  it("a market holiday: the first names show an earlier session, the day is recorded as closed", async () => {
    mocks.db = fakeSupabase({ macro_observations: [rate] });
    net((t) => chain(t, { state: "CLOSED", at: Date.parse("2026-11-25T21:00:02Z") / 1000 }));
    const r = await runJob("options");
    expect(r).toMatchObject({ ok: true, items: 0, detail: { closed: true } });
    expect(mocks.db.state("options-app")!.paused_reason).toBe("session:20261127 closed: Yahoo's newest quote is from 2026-11-25");
    expect(mocks.db.tables["options_daily"] ?? []).toHaveLength(0);
  });

  it("no listed options and no usable quotes are not failures: the place moves on", async () => {
    mocks.db = fakeSupabase({ macro_observations: [rate] });
    net((t) => (t === first[0] ? { optionChain: { result: [], error: null } } : chain(t, { state: "POST" })));
    const r = await runJob("options");
    expect(r.ok).toBe(true);
    expect(r.items).toBe(1);
    expect(r.detail).toMatchObject({ stored: 1, none: 1 });
    expect(mocks.db.state("options-app")!.cursor).toBe(2);
  });

  it("skips names already stored for the session", async () => {
    mocks.db = fakeSupabase({ macro_observations: [rate], options_daily: [{ ticker: first[0], date: "2026-11-27", source: "yahoo", price: 1 }] });
    const calls = net((t) => chain(t));
    await runJob("options");
    expect(calls.direct).toEqual([first[1]]);
  });

  it("clears the rows the Cboe collector left behind", async () => {
    mocks.db = fakeSupabase({
      job_state: [
        st("options-backoff", 1795760414, "blocked: Cboe refused option chains (403 x4, 429 x0) [n=40]"),
        st("provider:cboe", 1795760414, "rate: Cboe refused option chains (403 x4, 429 x0) [n=40]"),
        st("options-worker", 0, "night:20261126 blocked until 2026-11-27T07:55:40.894Z Cboe refused the worker (403 x20, 429 x0) [n=1]"),
        { ...st("options-collect", 300, "session:20261127"), updated_at: new Date(NOW - 60_000).toISOString() },
      ],
    });
    net(() => 200);
    await runJob("options");
    for (const k of ["options-backoff", "provider:cboe", "options-worker"]) expect(mocks.db.state(k)).toMatchObject({ cursor: 0, paused_reason: null });
    expect(mocks.db.state("options-collect")!.paused_reason).toBe("session:20261127");
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
    mocks.fetchEstimates.mockRejectedValue(new Error("Estimates provider unavailable"));
    const before = Math.floor(Date.now() / 1000);
    expect((await runJob("estimates")).ok).toBe(false);
    expect(mocks.fetchEstimates).toHaveBeenCalledTimes(1);
    expect(mocks.db.state("estimates-backoff")!.cursor).toBeGreaterThanOrEqual(before + 1800);
    expect(mocks.db.state("estimates-new")).toBeUndefined();
  });
  // Review R1: before this, one ticker with a deterministic error held the fill forever.
  it("a ticker the provider always refuses (404) is charged, skipped after three tries, and never holds the others", async () => {
    mocks.db = fakeSupabase();
    const bad = COVERAGE[0].ticker;
    mocks.fetchEstimates.mockImplementation(async (t: string) => {
      if (t === bad) throw new Error("Estimates provider responded 404");
      return { ticker: t, asOf: nowIso() };
    });
    const asked: string[] = [];
    let stored = 0;
    for (let i = 0; i < 6; i++) {
      const b = mocks.db.state("estimates-backoff");
      if (b) b.cursor = 0;
      const r = await runJob("estimates");
      stored += r.items;
      asked.push(...mocks.fetchEstimates.mock.calls.map((c) => c[0]));
      mocks.fetchEstimates.mockClear();
      if (i === 0) {
        expect(r.ok).toBe(true);
        expect(r.detail.skipped).toEqual([`${bad}: try 1 of 3: Estimates provider responded 404`]);
      }
    }
    expect(new Set(asked).size).toBeGreaterThan(10);
    expect(stored).toBe(asked.filter((t) => t !== bad).length);
    expect(mocks.db.state("estimates-backoff")).toBeUndefined();
    expect(mocks.db.state(`estimates-fail:${bad}`)!.cursor).toBe(1);
  });
  it("gives a failing ticker up for seven days after the third try, with the reason in the run record", async () => {
    const bad = COVERAGE[0].ticker;
    const longAgo = new Date(Date.now() - 7 * 3600_000).toISOString();
    mocks.db = fakeSupabase({ job_state: [{ job: `estimates-fail:${bad}`, cursor: 2, paused_reason: "try 2 of 3: x", updated_at: longAgo }] });
    mocks.fetchEstimates.mockImplementation(async (t: string) => {
      if (t === bad) throw new SyntaxError("Unexpected token < in JSON");
      return { ticker: t, asOf: nowIso() };
    });
    const r = await runJob("estimates");
    expect(r.detail.gaveUp).toEqual([`${bad}: gave up for 7 days after 3 tries: Unexpected token < in JSON`]);
    expect(r.items).toBe(2);
    // next lap: the given-up ticker is not asked again
    mocks.db.state("estimates-new")!.cursor = 0;
    mocks.fetchEstimates.mockClear();
    await runJob("estimates");
    expect(mocks.fetchEstimates.mock.calls.map((c) => c[0])).not.toContain(bad);
  });
  it("a ticker that keeps hitting a provider-wide error goes last next time and is charged once the others answer", async () => {
    mocks.db = fakeSupabase();
    const bad = COVERAGE[0].ticker;
    mocks.fetchEstimates.mockImplementation(async (t: string) => {
      if (t === bad) throw new Error("Estimates provider unavailable");
      return { ticker: t, asOf: nowIso() };
    });
    const r1 = await runJob("estimates");
    expect(r1.ok).toBe(false);
    expect(mocks.db.state("estimates-backoff")!.paused_reason).toMatch(new RegExp(`^${bad}: `));
    mocks.db.state("estimates-backoff")!.cursor = 0;
    mocks.fetchEstimates.mockClear();
    const r2 = await runJob("estimates");
    expect(mocks.fetchEstimates.mock.calls.map((c) => c[0])).toEqual([COVERAGE[1].ticker, COVERAGE[2].ticker, bad]);
    expect(r2.items).toBe(2);
    expect(r2.detail.skipped).toEqual([`${bad}: try 1 of 3: Estimates provider unavailable`]);
    expect(mocks.db.state("estimates-backoff")!.cursor).toBe(0);
    expect(mocks.db.state("estimates-new")!.cursor).toBe(3);
  });
  it("a stored row that keeps failing does not take a slot again within six hours", async () => {
    const old = new Date(Date.now() - 2 * 86400_000).toISOString();
    mocks.db = fakeSupabase({
      analyst_estimates: COVERAGE.slice(0, 200).map((c) => ({ ticker: c.ticker, payload: {}, fetched_at: nowIso() })).concat([{ ticker: "AAA", payload: {}, fetched_at: old }, { ticker: "BBB", payload: {}, fetched_at: old }]),
      job_state: [st("estimates-new", 0), { job: "estimates-fail:AAA", cursor: 1, paused_reason: "try 1 of 3: x", updated_at: nowIso() }],
    });
    mocks.fetchEstimates.mockImplementation(async (t: string) => ({ ticker: t, asOf: nowIso() }));
    await runJob("estimates");
    const called = mocks.fetchEstimates.mock.calls.map((c) => c[0]);
    expect(called).toContain("BBB");
    expect(called).not.toContain("AAA");
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
  it("a slice whose first company outruns the whole run budget is charged a try and passed over after three, not repeated for good", async () => {
    mocks.db = fakeSupabase({ job_state: [st("sec", 0)] });
    // Every read ends on the run's own deadline: no company finishes, and the first one had the whole budget.
    mocks.fetchSec.mockRejectedValue(new Error("SEC EDGAR responded with an error (run budget spent) for https://data.sec.gov/submissions/CIK0000000001.json"));
    for (let i = 0; i < 3; i++) {
      const r = await runJob("sec");
      expect(r.ok).toBe(false);
      expect(r.detail.cut).toEqual(expect.arrayContaining([expect.stringContaining("run budget spent")]));
      expect(mocks.db.state("sec")!.cursor).toBe(0);
    }
    submissions([]);
    const r = await runJob("sec");
    expect(r.detail.skipped).toMatch(/slice at 0 skipped after 3 tries/);
    expect(mocks.db.state("sec")!.cursor).toBe(8);
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
