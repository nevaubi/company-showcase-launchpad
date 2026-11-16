// Short-term setup engine: runs every published strategy in src/lib/signals/strategies.ts over the
// full universe, evaluates each variant walk-forward after costs (src/lib/signals/backtest.ts) and
// writes today's setups for the variants that pass the strict gate to public/data/setups.json.
// Usage: bun scripts/setups.ts [--cache=/tmp/px]   (cache holds prices/*.json + universe.json)
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { sb, args, log } from "./lib/supa";
import type { Bar } from "../src/lib/financials/types";
import { fetchYahoo, toBars } from "../src/lib/market-data.server";
import { align, features, rollMean, roundTripCost, type Aligned } from "../src/lib/signals/features";
import { STRATEGIES, STRATEGY } from "../src/lib/signals/strategies";
import { evaluate, GATE, OOS_START, regimeAt, Samples, type Regime } from "../src/lib/signals/backtest";
import { formPairs, PAIRS, spreadZ, tradePairs, type PairLeg } from "../src/lib/signals/pairs";
import { variantKey, type PairSetup, type Setup, type SetupsFile, type VariantMeta } from "../src/lib/signals/setups";

const CACHE = String(args.cache ?? "/tmp/px");
const ETF: Record<string, string> = {
  "Information Technology": "XLK", Financials: "XLF", "Health Care": "XLV", "Consumer Discretionary": "XLY", "Consumer Staples": "XLP",
  Energy: "XLE", Industrials: "XLI", Materials: "XLB", "Real Estate": "XLRE", Utilities: "XLU", "Communication Services": "XLC",
};
const sf = (s: string) => s.replace(/\^/g, "IDX_").replace(/[^A-Za-z0-9_.-]/g, "_");

async function bucketJson<T>(path: string): Promise<T | null> {
  const local = `${CACHE}/${path}`;
  if (existsSync(local)) return JSON.parse(await readFile(local, "utf8")) as T;
  const r = await sb.storage.from("datasets").download(path);
  if (!r.data) return null;
  const t = await r.data.text();
  await mkdir(local.slice(0, local.lastIndexOf("/")), { recursive: true });
  await writeFile(local, t);
  return JSON.parse(t) as T;
}

async function benchBars(sym: string): Promise<Bar[]> {
  try {
    return toBars(await fetchYahoo(sym, "10y", "1d"), false).filter((b) => b[0] >= "2015-01-01");
  } catch (e) {
    log("yahoo failed", sym, (e as Error).message, "- using stored copy");
    const f = `public/data/prices/${sf(sym)}.json`;
    return (JSON.parse(await readFile(f, "utf8")) as { bars: Bar[] }).bars;
  }
}

const universe = (await bucketJson<{ companies: { ticker: string; name: string; sector?: string }[] }>("universe.json"))!.companies;
log("universe", universe.length);

// ---- calendar & benchmarks
const spyBars = await benchBars("SPY");
const allDates = spyBars.map((b) => b[0]).filter((d) => d >= "2016-01-01");
const priceFiles = new Map<string, Bar[]>();
let loaded = 0;
await Promise.all(Array.from({ length: 16 }, async (_, w) => {
  for (let k = w; k < universe.length; k += 16) {
    const p = await bucketJson<{ bars: Bar[] }>(`prices/${sf(universe[k].ticker)}.json`).catch(() => null);
    if (p?.bars?.length) priceFiles.set(universe[k].ticker, p.bars);
    if (++loaded % 400 === 0) log("prices", loaded);
  }
}));
// End the calendar on the last day most stocks have a bar.
const lastCount = new Map<string, number>();
for (const bars of priceFiles.values()) for (const b of bars.slice(-15)) lastCount.set(b[0].slice(0, 10), (lastCount.get(b[0].slice(0, 10)) ?? 0) + 1);
const endDate = [...lastCount.entries()].filter(([, n]) => n >= priceFiles.size * 0.5).map(([d]) => d).sort().at(-1)!;
const dates = allDates.filter((d) => d <= endDate);
const D = dates.length;
log("calendar", dates[0], "to", endDate, D, "bars;", priceFiles.size, "price files");

const spy = align(dates, spyBars);
const vixA = align(dates, await benchBars("^VIX"));
const spy200 = rollMean(spy.c, 200, spy.start);
const regime: Regime[] = dates.map((_, i) => regimeAt(spy.c, spy200, vixA.c, i));
const etfs = new Map<string, Aligned>();
for (const s of new Set(Object.values(ETF))) etfs.set(s, align(dates, await benchBars(s)));
/** Sector ETF close, chained onto SPY returns where the ETF has no history yet. */
function benchFor(sector?: string): Aligned {
  const e = sector ? etfs.get(ETF[sector]) : undefined;
  if (!e) return spy;
  const c = new Float64Array(D), o = new Float64Array(D);
  c[0] = spy.c[0];
  o[0] = spy.o[0];
  for (let i = 1; i < D; i++) {
    const have = e.start >= 0 && i > e.start;
    const r = have ? e.c[i] / e.c[i - 1] : spy.c[i] / spy.c[i - 1];
    c[i] = c[i - 1] * r;
    o[i] = c[i - 1] * (have ? e.o[i] / e.c[i - 1] : spy.o[i] / spy.c[i - 1]);
  }
  return { start: 0, c, o, h: c, l: c, v: new Float64Array(D) };
}
const benches = new Map<string, Aligned>();

// ---- scan
const samples = new Map<string, Samples>();
const sample = (k: string) => samples.get(k) ?? (samples.set(k, new Samples()), samples.get(k)!);
interface Live { ticker: string; key: string; i: number; f: ReturnType<typeof features>; side: 1 | -1; h: number }
const live: Live[] = [];
const legsBySector = new Map<string, PairLeg[]>();
const meta = new Map(universe.map((u) => [u.ticker, u]));
let scanned = 0;
for (const u of universe) {
  const bars = priceFiles.get(u.ticker);
  if (!bars) continue;
  const a = align(dates, bars);
  if (a.start < 0 || D - a.start < 300) continue;
  const sector = u.sector ?? "";
  const bench = benches.get(sector) ?? (benches.set(sector, benchFor(sector)), benches.get(sector)!);
  const f = features(a, bench.c);
  scanned++;
  const next = new Map<string, number>();
  for (const s of STRATEGIES) {
    if (!s.fire) continue;
    for (let i = a.start + 260; i < D; i++) {
      const d = s.fire(f, i);
      if (!d || !s.sides.includes(d)) continue;
      const cost = roundTripCost(f.dv20[i]);
      if (cost == null) continue;
      for (const h of s.horizons) {
        const key = variantKey(s.id, d, h);
        if (i >= D - 3) live.push({ ticker: u.ticker, key, i, f, side: d, h });
        if (i + h >= D || i < (next.get(key) ?? 0)) continue;
        const r = a.c[i + h] / a.o[i + 1] - 1;
        const rb = bench.c[i + h] / bench.o[i + 1] - 1;
        const rs = spy.c[i + h] / spy.o[i + 1] - 1;
        if (!Number.isFinite(r) || !Number.isFinite(rb) || !Number.isFinite(rs)) continue;
        sample(key).push(i, d * (r - rb) - cost, d * (r - rs) - cost, d * r);
        next.set(key, i + h + 1);
      }
    }
  }
  if (sector) {
    const legs = legsBySector.get(sector) ?? (legsBySector.set(sector, []), legsBySector.get(sector)!);
    legs.push({ ticker: u.ticker, o: a.o, c: a.c, start: a.start, dv20: f.dv20 });
  }
  if (scanned % 300 === 0) log("scanned", scanned);
}
log("scanned", scanned, "companies;", live.length, "live firings");

// ---- pairs
const pairKey = variantKey("pairs", 1, 20);
const livePairs: PairSetup[] = [];
for (const [sector, legs] of legsBySector) {
  for (let F = PAIRS.window; F < D - 2; F += PAIRS.step) tradePairs(legs, formPairs(legs, F), F, D, sample(pairKey));
  for (const p of formPairs(legs, D - 1)) {
    const z = spreadZ(legs, p, D - 1);
    if (Math.abs(z) < PAIRS.entryZ) continue;
    const A = legs[p.a], B = legs[p.b];
    livePairs.push({
      a: A.ticker, b: B.ticker, nameA: meta.get(A.ticker)?.name ?? A.ticker, nameB: meta.get(B.ticker)?.name ?? B.ticker, sector,
      z: +z.toFixed(2), beta: +p.beta.toFixed(3), halfLife: +p.hl.toFixed(1), rho: +p.rho.toFixed(3), adf: +p.adf.toFixed(2), side: z < 0 ? 1 : -1,
      zs: Array.from({ length: 120 }, (_, k) => +spreadZ(legs, p, D - 120 + k).toFixed(2)),
      priceA: +A.c[D - 1].toFixed(2), priceB: +B.c[D - 1].toFixed(2),
    });
  }
  log("pairs", sector, sample(pairKey).i.length);
}

// ---- evaluate
const keys = [...samples.keys()].sort();
const proofs = evaluate(keys.map((key) => ({ key, samples: samples.get(key)! })), dates, regime);
const variants: VariantMeta[] = proofs.map((p) => {
  const [s, side, h] = p.key.split(":");
  return { ...p, strategy: s as VariantMeta["strategy"], side: side === "L" ? 1 : -1, horizon: Number(h) };
});
const byKey = new Map(variants.map((v) => [v.key, v]));
const today = regime[D - 1];

// ---- today's setups (passing variants that also work in today's regime)
const best = new Map<string, Setup>();
for (const L of live) {
  const v = byKey.get(L.key);
  if (!v) continue;
  // Proven = passed the strict gate. Near misses (positive and t >= 1.5 out of sample) are kept as watch-only.
  const near = (v.outSample.avgNet ?? 0) > 0 && (v.outSample.t ?? 0) >= 1.5;
  if (!v.passed && !near) continue;
  const rg = v.regimes[today];
  if (rg.n < GATE.minRegimeN || !((rg.avgNet ?? 0) > 0)) continue;
  const n = v.outSample.n;
  const edge = (rg.avgNet! * n) / (n + 200);
  const s = STRATEGY[v.strategy];
  const f = L.f;
  const last = D - 1;
  const price = f.a.c[last], atr = f.atr14[last];
  const k = s.family === "momentum" ? 2.5 : 2;
  const risk = k * atr;
  const setup: Setup = {
    ticker: L.ticker, name: meta.get(L.ticker)?.name ?? L.ticker, sector: meta.get(L.ticker)?.sector ?? "", key: L.key, strategy: v.strategy, side: L.side, horizon: L.h,
    firedAt: dates[L.i], detail: s.detail!(f, L.i), strength: +s.strength!(f, L.i).toFixed(2), price: +price.toFixed(2),
    stop: +(price - L.side * risk).toFixed(2), target: +(price + L.side * risk * (s.family === "momentum" ? 2 : 1.5)).toFixed(2),
    proven: v.passed, edge: +edge.toFixed(5), spark: Array.from(f.a.c.slice(D - 60)).map((x) => +x.toFixed(2)),
  };
  const id = `${L.ticker}:${v.strategy}:${L.side}`;
  if (!best.has(id) || Number(best.get(id)!.proven) < Number(v.passed) || (best.get(id)!.proven === v.passed && best.get(id)!.edge < edge)) best.set(id, setup);
}
const setups = [...best.values()].sort((a, b) => Number(b.proven) - Number(a.proven) || b.edge - a.edge).slice(0, 150);
const pairsPassed = !!byKey.get(pairKey)?.passed;

const out: SetupsFile = {
  generatedAt: new Date().toISOString(), asOf: endDate, companies: scanned, regime: today, oosStart: OOS_START, gate: GATE,
  variants, setups, pairsProven: pairsPassed, pairs: livePairs.sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, 40),
};
await writeFile("public/data/setups.json", JSON.stringify(out));
log("regime", today, "| setups", setups.length, "| pairs", out.pairs.length, "of", livePairs.length);
for (const v of variants)
  log(v.passed ? "PASS" : "fail", v.key.padEnd(18), `oos n=${v.outSample.n} net=${((v.outSample.avgNet ?? 0) * 100).toFixed(2)}% t=${v.outSample.t} dsr=${v.dsr} is=${((v.inSample.avgNet ?? 0) * 100).toFixed(2)}%`, v.failed.join("; "));
