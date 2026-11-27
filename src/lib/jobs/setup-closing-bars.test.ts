import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";
import { COVERAGE } from "@/lib/coverage";
import { BENCH_SYMBOLS } from "@/lib/signals/context";
import { runSetups } from "./setups.server";

const state = vi.hoisted(() => ({ client: {} }));
vi.mock("@/integrations/supabase/client.server", () => ({ get supabaseAdmin() { return state.client; } }));

const prev = "2026-11-25";
const session = "2026-11-27"; // Early close after Thanksgiving.
const at = session + "T18:50:00Z";
const cycle = (as_of: string, phase: string) => ({ as_of, phase, cursor: 0, updated_at: at, detail: { checked: session } });
const quote = (symbol: string, date: string, updated_at = at) => ({
  symbol, date, updated_at, open: 98, high: 101, low: 97, close: 100, adj_close: 96, volume: 2500,
});
const work = (n = 0) => Object.assign(() => n-- > 0, { end: Date.parse(at) + 1000, signal: () => new AbortController().signal });
const provider = vi.fn();
function useDatabase(seed: Parameters<typeof fakeSupabase>[0], rpc: Record<string, () => unknown> = {}) {
  const db = fakeSupabase(seed, { rpc });
  // The shared fake exposes its chainable query methods through a record. Both query and RPC are awaitable.
  const checked = (request: object) =>
    Object.assign(request, { throwOnError: () => Promise.resolve(request).then((response) => {
      const result = response as { data: unknown; error?: { message: string } };
      if (result.error) throw new Error(result.error.message);
      return result;
    }) });
  const bench = { dates: [prev, session], o: { SPY: [98, 99] }, c: { SPY: [100, 101] }, vix3m: [null, null] };
  state.client = {
    from: (table: string) => checked(db.client.from(table)),
    rpc: (fn: string, args?: Record<string, unknown>) => checked(db.client.rpc(fn, args)),
    storage: { from: () => ({ download: async (path: string) => ({ data: { text: async () => JSON.stringify(path === "setups/bench.json" ? bench : { bars: [] }) }, error: null }) }) },
  };
  return db;
}
function yahoo(dates: string[], opens: (number | null)[]) {
  return { chart: { result: [{ meta: { gmtoffset: -18000 }, timestamp: dates.map(d => Date.parse(d + "T14:30:00Z") / 1000),
    indicators: { quote: [{ open: opens, high: dates.map(() => 101), low: dates.map(() => 97), close: dates.map(() => 100), volume: dates.map(() => 123) }],
      adjclose: [{ adjclose: dates.map(() => 99) }] } }] } };
}
const nasdaq = (dates: string[], open = "99") => ({ data: { tradesTable: { rows: dates.map(d => ({
  date: d.slice(5, 7) + "/" + d.slice(8) + "/" + d.slice(0, 4), open, high: "102", low: "98", close: "101", volume: "3,000",
})) } } });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(at));
  provider.mockReset();
  vi.stubGlobal("fetch", provider);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("nightly official closing bars", () => {
  it.each([
    ["stale", [prev], [98]],
    ["future", [prev, "2026-11-30"], [98, 98]],
    ["impossible high", [prev, session], [98, 105]],
    ["missing open", [prev, session], [98, null]],
  ] as const)("repairs a %s Yahoo session using just the official fallback day", async (_reason, dates, opens) => {
    const history = quote("SPY", prev, prev + "T21:45:00Z");
    const db = useDatabase({ setup_cycles: [cycle(prev, "done")], market_bars: [history] });
    provider.mockImplementation(async (url: string) => Response.json(url.includes("yahoo") ? yahoo([...dates], [...opens]) : nasdaq([prev, session])));
    expect((await runSetups(work())).ok).toBe(true);
    expect(db.tables.setup_cycles.map(r => r.as_of)).toEqual([prev, session]);
    expect(db.tables.market_bars).toEqual([history, expect.objectContaining({ date: session, close: 101, adj_close: 101, volume: 3000 })]);
    expect(provider.mock.calls[1][0]).toContain("assetclass=etf");
  });

  it("keeps the previous cycle and retries stale providers even with a legacy checked marker", async () => {
    const db = useDatabase({ setup_cycles: [cycle(prev, "done")], market_bars: [quote("SPY", prev)] });
    provider.mockImplementation(async (url: string) => Response.json(url.includes("yahoo") ? yahoo([prev], [98]) : nasdaq([prev, session], "N/A")));
    const result = await runSetups(work());
    expect(result).toMatchObject({ ok: false, items: 0, detail: { waitingFor: "SPY", asOf: session } });
    expect(db.writes).toEqual([]);
    provider.mockImplementation(async () => Response.json(yahoo([prev, session], [98, 98])));
    expect((await runSetups(work())).ok).toBe(true);
    expect(db.tables.setup_cycles.at(-1)?.as_of).toBe(session);
    expect(provider).toHaveBeenCalledTimes(3);
  });

  it("idles on a calendar closure and can start from an already stored final benchmark", async () => {
    const db = useDatabase({ setup_cycles: [cycle(prev, "done")], market_bars: [quote("SPY", session)] });
    vi.setSystemTime(new Date("2026-11-26T22:00:00Z"));
    expect(await runSetups(work())).toMatchObject({ ok: true, detail: { idle: true, asOf: prev } });
    expect(db.writes).toEqual([]);
    vi.setSystemTime(new Date(at));
    expect((await runSetups(work())).ok).toBe(true);
    expect(db.tables.setup_cycles.at(-1)?.as_of).toBe(session);
    expect(provider).not.toHaveBeenCalled();
  });

  it("reports an unavailable benchmark while saving other symbols and advancing the bar pass", async () => {
    const current = BENCH_SYMBOLS.slice(0, 6).map(sym => quote(sym, session));
    current[0].updated_at = session + "T17:55:00Z";
    current[1].high = 92;
    let claims = 0;
    const advance = vi.fn(() => true);
    const db = useDatabase({ setup_cycles: [cycle(session, "bars")], market_bars: current }, { setup_take: () => claims++ === 0 ? 0 : 100000, setup_advance: advance });
    provider.mockImplementation(async (url: string) => Response.json(url.includes("cboe") ? { data: [{ date: session, open: null, high: 20, low: 20, close: 20 }] } : yahoo(url.includes("SPY") ? [session] : [prev], [98])));
    const result = await runSetups(work(2));
    expect(result).toMatchObject({ ok: false, items: 1, detail: { done: true, failed: [expect.stringContaining("^VIX")] } });
    expect(db.tables.market_bars.find(r => r.symbol === "SPY")?.volume).toBe(123);
    expect(advance).toHaveBeenCalledOnce();
  });

  it.each([["2026-11-06", true], ["2026-11-09", false]] as const)("applies Roku's listing eligibility on %s without moving its claim slot", async (day, eligible) => {
    const symbols = [...BENCH_SYMBOLS, ...COVERAGE.map(c => c.ticker)];
    const index = symbols.indexOf("ROKU");
    expect(index).toBeGreaterThan(0);
    const rest = symbols.slice(index + 1, index + 6).map(sym => quote(sym, day, day + "T21:50:00Z"));
    const take = vi.fn(() => index);
    useDatabase({ setup_cycles: [cycle(day, "bars")], market_bars: rest }, { setup_take: take });
    provider.mockImplementation(async () => Response.json(yahoo([day], [98])));
    const result = await runSetups(work(1));
    expect(take).toHaveBeenCalledWith({ _as_of: day, _phase: "bars", _n: 6 });
    expect(provider).toHaveBeenCalledTimes(eligible ? 1 : 0);
    expect(result.items).toBe(eligible ? 1 : 0);
    if (!eligible) expect(result.detail.closed).toContain("ROKU");
  });

  it("records per-ticker scan gaps without replacing saved series or returning them as current coverage", async () => {
    const tickers = ["PRE", "BAD", "ABSENT"];
    const db = useDatabase({ setup_cycles: [cycle(session, "scan")], market_bars: [quote("PRE", session, session + "T17:59:00Z"), { ...quote("BAD", session), open: 190 }] },
      { setup_claim_tickers: () => tickers.map(ticker => ({ ticker, sector: "Energy" })) });
    const result = await runSetups(work(1));
    expect(result.detail).toMatchObject({ provisional: { skipped: 3 } });
    const writes = db.writes.filter(w => w.table === "setup_scan").flatMap(w => w.value);
    expect(writes).toEqual(tickers.map(ticker => expect.objectContaining({ ticker, scanned_for: session, error: expect.stringContaining("no valid post-close") })));
    expect(db.writes.every(w => w.table === "setup_scan")).toBe(true);
  });
});
