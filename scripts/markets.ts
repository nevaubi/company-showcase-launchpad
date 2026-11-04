// Precomputes market analytics from the bundled daily bars and SEC earnings-release dates:
//   public/data/markets.json  — earnings reactions + chart patterns per covered company
//   public/data/returns.json  — 3 years of aligned daily returns (companies + ETFs) for the correlation explorer
// Usage: bun scripts/markets.ts   (rerun after ingest)
import { readFile, writeFile } from "node:fs/promises";
import { BENCHMARKS, COVERAGE } from "../src/lib/coverage";
const symbolFile = (s: string) => s.replace(/\^/g, "IDX_").replace(/[^A-Za-z0-9_.-]/g, "_");
import type { Bar } from "../src/lib/financials/types";
import { detectPatterns, earningsReactions, patternEdges, reactionStats, supportResistance } from "../src/lib/markets/core";

const load = async (s: string) => (JSON.parse(await readFile(`public/data/prices/${symbolFile(s)}.json`, "utf8")) as { bars: Bar[] }).bars;
const spy = await load("SPY");

const companies: unknown[] = [];
for (const co of COVERAGE) {
  try {
    const bars = await load(co.ticker);
    const ds = JSON.parse(await readFile(`public/data/companies/${co.ticker}.json`, "utf8")) as { earningsReleases?: { filed: string; accn: string; doc: string }[] };
    const reactions = earningsReactions(bars, ds.earningsReleases ?? [], spy);
    const hits = detectPatterns(bars);
    const last = bars.length - 1;
    companies.push({
      ticker: co.ticker,
      sector: co.sector,
      asOf: bars[last][0],
      price: bars[last][5],
      reactions,
      stats: reactionStats(reactions),
      // Active = triggered in the last 10 sessions.
      active: hits.filter((h) => last - h.index <= 10).map(({ index, ...h }) => ({ ...h, ago: last - index })),
      recent: hits.slice(-40).map(({ index, ...h }) => h),
      edges: patternEdges(hits),
      levels: supportResistance(bars),
    });
  } catch (e) {
    console.warn(co.ticker, (e as Error).message);
  }
}
await writeFile("public/data/markets.json", JSON.stringify({ generatedAt: new Date().toISOString(), companies }));

// Aligned returns on SPY's trading calendar, rounded to 5 dp to keep the file small.
const syms = [...COVERAGE.map((c) => c.ticker), ...BENCHMARKS.filter((b) => b.symbol !== "^VIX").map((b) => b.symbol)];
const dates = spy.slice(-757).map((b) => b[0]);
const out: Record<string, (number | null)[]> = {};
for (const s of syms) {
  try {
    const bars = await load(s);
    const px = new Map(bars.map((b) => [b[0], b[5]]));
    out[s] = dates.slice(1).map((d, i) => {
      const a = px.get(dates[i]), b = px.get(d);
      return a && b ? Math.round((b / a - 1) * 1e5) / 1e5 : null;
    });
  } catch {
    /* missing */
  }
}
await writeFile("public/data/returns.json", JSON.stringify({ dates: dates.slice(1), returns: out }));
console.log(`${companies.length} companies, ${Object.keys(out).length} return series`);
