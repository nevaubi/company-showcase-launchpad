import { describe, expect, it } from "vitest";
import type { Bar } from "../financials/types";
import { align, features, tradeCost } from "./features";
import { eventFeatures, expectedNext, indexOnOrAfter, insiderBuyRows, weekdaysBetween } from "./events";
import { parseShortVolume } from "./finra";
import { parseCboeCsv } from "./context";
import { aggregate, dailyStats, evaluate, finalize, Samples, variantPartial, type Regime } from "./backtest";
import { botStats, parseRules, stepBot, wants, type Candidate, type Ohlc, type Position } from "./bots";
import { pickSetups, riskPlan, variantMeta } from "./setups";

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

function weekdays(from: string, n: number) {
  const out: string[] = [];
  for (let t = new Date(from + "T12:00:00Z"); out.length < n; t.setUTCDate(t.getUTCDate() + 1)) if (t.getUTCDay() % 6 !== 0) out.push(t.toISOString().slice(0, 10));
  return out;
}
function walk(dates: string[], seed: number, drift = 0): Bar[] {
  const r = rng(seed);
  let p = 50;
  return dates.map((d) => {
    const o = p;
    p *= 1 + drift + 0.015 * gauss(r);
    return [d, o, Math.max(o, p) * 1.005, Math.min(o, p) * 0.995, p, p, 2e6] as Bar;
  });
}

describe("data parsers", () => {
  it("reads FINRA short volume and maps share classes to app tickers", () => {
    const text = "Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market\n20261113|BRK/B|343265.2|33|707256.07|B,Q,N\n20261113|AAPL|100|0|0|Q\n20261113|ZZZ|5|0|10|Q\n";
    const rows = parseShortVolume(text, new Set(["BRK-B", "AAPL"]));
    expect(rows).toEqual([{ symbol: "BRK-B", date: "2026-11-13", short_vol: 343265, exempt_vol: 33, total_vol: 707256 }]);
  });
  it("reads Cboe index history dates as ISO", () => {
    const m = parseCboeCsv("DATE,OPEN,HIGH,LOW,CLOSE\n09/18/2009,25.9,26.6,25.9,26.54\n");
    expect(m.get("2009-09-18")).toBe(26.54);
  });
  it("keeps only officer/director open-market purchases", () => {
    const base = { accn: "a1", filed: "2024-03-01", date: "2024-02-28", shares: 1000, price: 50, acquired: true, plan10b5: false };
    const rows = insiderBuyRows("X", [
      { ...base, owner: "Jane CEO", role: "Chief Executive Officer", code: "P" },
      { ...base, owner: "Jane CEO", role: "Chief Executive Officer", code: "P", shares: 500 },
      { ...base, owner: "Fund LP", role: "10% Owner", code: "P" },
      { ...base, owner: "Bob Director", role: "Director", code: "S", acquired: false },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ owner: "Jane CEO", is_officer: true, shares: 1500, value: 75000 });
  });
});

describe("event features", () => {
  const dates = weekdays("2020-01-01", 700);
  const bars = walk(dates, 3);
  const bench = align(dates, walk(dates, 9)).c;
  const f = features(align(dates, bars), bench);

  it("expects the next results 52 weeks after the same quarter last year", () => {
    expect(expectedNext(["2023-01-26", "2023-04-27", "2023-07-27", "2023-10-26"])).toBe("2024-01-25");
    expect(expectedNext(["2023-10-26"])).toBe("2024-01-25");
    expect(weekdaysBetween("2024-01-05", "2024-01-12")).toBe(5);
    expect(indexOnOrAfter(["a", "c", "e"], "d")).toBe(2);
  });
  it("earnings reaction appears only on the bar after the release", () => {
    const d = dates[400];
    const ev = eventFeatures(dates, f, bench, { earnings: [d], buys: [], short: [] });
    expect(Number.isFinite(ev.earnZ[401])).toBe(true);
    expect(Number.isNaN(ev.earnZ[400])).toBe(true);
    // Uses the closes from two days before to the day after the release.
    const want = bars[401][5] / bars[398][5] - 1 - (bench[401] / bench[398] - 1);
    expect(ev.earnRet[401]).toBeCloseTo(want, 10);
  });
  it("counts distinct insiders buying within 30 days, ignoring planned and small buys", () => {
    const ev = eventFeatures(dates, f, bench, {
      earnings: [],
      short: [],
      buys: [
        { filed: dates[500], owner: "A", value: 50_000, plan: false },
        { filed: dates[505], owner: "B", value: 80_000, plan: false },
        { filed: dates[506], owner: "C", value: 10_000, plan: false },
        { filed: dates[507], owner: "D", value: 90_000, plan: true },
      ],
    });
    expect(ev.buyers30[500]).toBe(1);
    expect(ev.buyers30[505]).toBe(2);
    expect(ev.buyValue30[505]).toBe(130_000);
    expect(ev.buyers30[506]).toBe(0);
  });
  it("flags abnormal short selling against its own prior 60 days", () => {
    const r = rng(4);
    const short = dates.map((date, i) => ({ date, ratio: i >= 650 ? 0.8 : 0.45 + 0.03 * gauss(r) }));
    const ev = eventFeatures(dates, f, bench, { earnings: [], buys: [], short });
    expect(ev.shortZ[655]).toBeGreaterThan(2);
    expect(Math.abs(ev.shortZ[600])).toBeLessThan(3);
  });
});

describe("costs and risk plan", () => {
  it("charges a 3% yearly borrow fee on shorts", () => {
    expect(tradeCost(0.001, 1, 21)).toBe(0.001);
    expect(tradeCost(0.001, -1, 21)).toBeCloseTo(0.001 + 0.0025, 10);
  });
  it("gives momentum and event trades wider stops", () => {
    expect(riskPlan("reversal", 1, 100, 2)).toEqual({ stop: 96, target: 106 });
    expect(riskPlan("events", -1, 100, 2)).toEqual({ stop: 105, target: 90 });
  });
});

describe("evaluation from daily aggregates", () => {
  it("matches the in-memory evaluation exactly", () => {
    const r = rng(8);
    const dates = weekdays("2016-01-04", 2400);
    const regime = dates.map((_, i) => (["Up, calm", "Down, stressed"] as Regime[])[i % 2]);
    const s = new Samples();
    for (let j = 0; j < 3000; j++) {
      const x = 0.002 + 0.03 * gauss(r);
      s.push(Math.floor(r() * 2400), x, x - 0.001, x + 0.001);
    }
    const direct = evaluate([{ key: "a:L:5", samples: s }], dates, regime)[0];
    const viaDb = finalize([variantPartial("a:L:5", aggregate(s), dates, regime)])[0];
    expect(viaDb).toEqual(direct);
    expect(dailyStats(aggregate(s)).n).toBe(3000);
  });
  it("says why a variant without earlier-years history can't be confirmed", () => {
    const dates = weekdays("2016-01-04", 2400);
    const regime = dates.map(() => "Up, calm" as Regime);
    const s = new Samples();
    for (let j = 0; j < 500; j++) s.push(2000 + (j % 300), 0.01, 0.01, 0.01);
    const out = evaluate([{ key: "custMom:L:21", samples: s }], dates, regime)[0];
    expect(out.passed).toBe(false);
    expect(out.failed).toContain("No earlier-years history to confirm it");
  });
});

describe("setups selection", () => {
  it("shows only proven variants or near misses that work in today's regime", () => {
    const dates = weekdays("2016-01-04", 2400);
    const regime = dates.map((_, i) => (i % 2 ? "Up, calm" : "Down, stressed") as Regime);
    const mk = (key: string, mu: number) => {
      const r = rng(key.length * 7);
      const s = new Samples();
      for (let j = 0; j < 4000; j++) {
        const x = mu + 0.03 * gauss(r);
        s.push(Math.floor(r() * 2400), x, x, x);
      }
      return { key, samples: s };
    };
    const variants = evaluate([mk("insider:L:20", 0.01), mk("reversal:L:5", -0.01)], dates, regime).map((p) => variantMeta(p));
    const live = ["insider:L:20", "reversal:L:5"].map((variant) => ({ ticker: "X", name: "X", sector: "Energy", variant, firedAt: dates[2399], strength: 2, detail: "", price: 10, atr: 0.5, spark: [] }));
    const out = pickSetups(variants, live, "Up, calm");
    expect(out.map((s) => s.key)).toEqual(["insider:L:20"]);
    expect(out[0]).toMatchObject({ proven: true, family: "events", stop: 8.75, target: 12.5 });
  });
});

describe("paper autopilots", () => {
  const cal = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-09"];
  const flat = (o: number, h = o, l = o, c = o): Ohlc => ({ o, h, l, c });
  const cand = (over: Partial<Candidate> = {}): Candidate => ({
    ticker: "AAA", name: "A", sector: "Energy", variant: "insider:L:20", strategy: "insider", family: "events", side: 1, horizon: 3, strength: 2,
    price: 100, atr: 2, cost: 0.001, stop: 95, target: 110, edge: 0.01, proven: true, near: false, regimeOk: true, ...over,
  });
  const spy = Object.fromEntries(cal.map((d, i) => [d, flat(400 + i)]));

  it("queues today's signal, fills at the next open and exits after the tested holding period", () => {
    const rules = parseRules({ select: "proven", maxPositions: 5, positionPct: 0.1 });
    const day1 = stepBot({ botId: "b", rules, capital: 100_000, calendar: cal.slice(0, 1), from: null, positions: [], realized: 0, bars: {}, spy, candidates: [cand()] });
    expect(day1.positions).toHaveLength(1);
    expect(day1.positions[0]).toMatchObject({ status: "pending", signal_date: "2026-11-02" });
    expect(day1.equity).toEqual([{ date: "2026-11-02", equity: 100_000, invested: 0, realized: 0, open_positions: 0, spy: 400 }]);

    const bars = { AAA: { "2026-11-03": flat(100, 101, 99, 101), "2026-11-04": flat(101, 103, 100, 102), "2026-11-05": flat(102, 105, 101, 104), "2026-11-06": flat(104) } };
    const pos = day1.positions.map((p, k) => ({ ...p, id: `p${k}` }));
    const day4 = stepBot({ botId: "b", rules, capital: 100_000, calendar: cal.slice(0, 4), from: "2026-11-02", positions: pos, realized: 0, bars, spy, candidates: [] });
    const p = day4.positions[0];
    expect(p).toMatchObject({ status: "closed", entry_date: "2026-11-03", entry_price: 100, exit_date: "2026-11-05", exit_price: 104, exit_reason: "Holding period" });
    // 10% of 100k = 10k notional; +4% gross minus 0.1% cost.
    expect(p.pnl).toBeCloseTo(400 - 10, 2);
    expect(day4.equity.at(-1)!.equity).toBeCloseTo(100_390, 2);
    expect(day4.realized).toBeCloseTo(390, 2);
  });

  it("uses stops when chosen and assumes the stop came first when both are touched", () => {
    const rules = parseRules({ exits: "stops" });
    const pos: Position = {
      id: "p", bot_id: "b", ticker: "AAA", name: "A", sector: "Energy", variant: "x:L:5", strategy: "x", side: 1, horizon: 5, signal_date: "2026-11-02", signal_price: 100,
      stop: 95, target: 110, atr: 2, cost: 0, status: "pending", entry_date: null, entry_price: null, shares: null, notional: null, spy_entry: null, exit_date: null,
      exit_price: null, exit_reason: null, pnl: null, ret: null, ret_spy: null, close_requested: false,
    };
    const bars = { AAA: { "2026-11-03": flat(100, 111, 94, 100) } };
    const out = stepBot({ botId: "b", rules, capital: 100_000, calendar: cal.slice(0, 2), from: "2026-11-02", positions: [pos], realized: 0, bars, spy, candidates: [] });
    expect(out.positions[0]).toMatchObject({ status: "closed", exit_reason: "Stop", exit_price: 95 });
  });

  it("respects position slots, one position per stock and the sector cap", () => {
    const rules = parseRules({ maxPositions: 3, maxPerSector: 1 });
    const out = stepBot({
      botId: "b", rules, capital: 100_000, calendar: cal.slice(0, 1), from: null, positions: [], realized: 0, bars: {}, spy,
      candidates: [cand({ ticker: "AAA", edge: 0.02 }), cand({ ticker: "AAA", variant: "pead:L:20" }), cand({ ticker: "BBB", sector: "Energy" }), cand({ ticker: "CCC", sector: "Utilities" }), cand({ ticker: "DDD", sector: "Financials" }), cand({ ticker: "EEE", sector: "Materials" })],
    });
    expect(out.positions.map((p) => p.ticker)).toEqual(["AAA", "CCC", "DDD"]);
  });

  it("selects by rule: proven only, watch list, families, side", () => {
    expect(wants(parseRules({ select: "proven" }), cand({ proven: false, near: true }))).toBe(false);
    expect(wants(parseRules({ select: "watch" }), cand({ proven: false, near: true }))).toBe(true);
    expect(wants(parseRules({ select: "watch" }), cand({ proven: false, near: true, regimeOk: false }))).toBe(false);
    expect(wants(parseRules({ select: "family", families: ["reversal"] }), cand())).toBe(false);
    expect(wants(parseRules({ select: "family", families: ["events"] }), cand({ proven: false }))).toBe(true);
    expect(wants(parseRules({ side: "short" }), cand())).toBe(false);
  });

  it("summarises return, drawdown and hit rate", () => {
    const s = botStats(100, [{ date: "a", equity: 110, spy: 100 }, { date: "b", equity: 99, spy: 101 }, { date: "c", equity: 105, spy: 102 }], [{ ret: 0.1 }, { ret: -0.05 }]);
    expect(s.totalReturn).toBeCloseTo(0.05, 10);
    expect(s.spyReturn).toBeCloseTo(0.02, 10);
    expect(s.maxDrawdown).toBeCloseTo(99 / 110 - 1, 10);
    expect(s.hit).toBe(0.5);
  });
});

describe("gate checklist", () => {
  it("mirrors the strict gate's failures one for one", async () => {
    const { gateChecks } = await import("./setups");
    const dates = weekdays("2016-01-04", 2400);
    const regime = dates.map((_, i) => (i % 2 ? "Up, calm" : "Down, stressed") as Regime);
    const r = rng(2);
    const s = new Samples();
    for (let j = 0; j < 800; j++) s.push(Math.floor(r() * 2400), 0.002 + 0.03 * gauss(r), -0.001, 0);
    const v = variantMeta(evaluate([{ key: "gap:L:5", samples: s }], dates, regime)[0]);
    const checks = gateChecks(v);
    expect(checks).toHaveLength(8);
    expect(checks.filter((c) => !c.ok).length).toBe(v.failed.length);
  });
});
