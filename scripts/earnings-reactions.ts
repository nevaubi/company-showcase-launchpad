// How every covered stock moved after its recent earnings reports, for the Options page's
// "priced vs past" comparison: close before the 8-K release → close the session after, the same
// measure as the company Earnings tab (`earningsReactions`). Reads the mirrored company and price
// files plus newer stored bars, writes `markets/reactions.json` to the datasets bucket.
//
//   bun scripts/earnings-reactions.ts [--tickers=AAPL,HOOD] [--workers=6]
import { COVERAGE } from "@/lib/coverage";
import { earningsReactions } from "@/lib/markets/core";
import type { Bar, CompanyDataset, PriceSeries } from "@/lib/financials/types";
import { args, log, sb } from "./lib/supa";

export const REACTIONS_PATH = "markets/reactions.json";
const KEEP = 12;
const tickers = args.tickers ? String(args.tickers).split(",").map((t) => t.trim().toUpperCase()) : COVERAGE.map((c) => c.ticker);
const workers = Number(args.workers ?? 6);
const file = (s: string) => s.replace(/\^/g, "IDX_").replace(/[^A-Za-z0-9_.-]/g, "_");

async function json<T>(path: string): Promise<T | null> {
  for (let i = 0; i < 3; i++) {
    const { data, error } = await sb.storage.from("datasets").download(path);
    if (data) return JSON.parse(await data.text()) as T;
    if (error && /not found/i.test(error.message)) return null;
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  return null;
}

async function bars(t: string): Promise<Bar[]> {
  const s = await json<PriceSeries>(`prices/${file(t)}.json`);
  const out = [...(s?.bars ?? [])];
  const last = out.at(-1)?.[0] ?? "1900-01-01";
  const { data } = await sb.from("market_bars").select("date, open, high, low, close, adj_close, volume").eq("symbol", t).gt("date", last).order("date").limit(400);
  for (const b of data ?? []) out.push([b.date, Number(b.open), Number(b.high), Number(b.low), Number(b.close), Number(b.adj_close ?? b.close), Number(b.volume ?? 0)]);
  return out;
}

type Entry = { n: number; median: number; mean: number; moves: { d: string; m: number; a: string; doc: string }[] };
const out: Record<string, Entry> = {};
let next = 0;
let done = 0;
let missing = 0;
await Promise.all(
  Array.from({ length: workers }, async () => {
    while (next < tickers.length) {
      const t = tickers[next++];
      try {
        const ds = await json<CompanyDataset>(`companies/${file(t)}.json`);
        const rel = ds?.earningsReleases ?? [];
        if (!rel.length) { missing++; continue; }
        const b = await bars(t);
        if (b.length < 60) { missing++; continue; }
        const rs = earningsReactions(b, [...rel].sort((x, y) => x.filed.localeCompare(y.filed)).map((r) => ({ filed: r.filed, accn: r.accn, doc: r.doc }))).sort((x, y) => x.date.localeCompare(y.date)).slice(-KEEP);
        if (!rs.length) { missing++; continue; }
        const abs = rs.map((r) => Math.abs(r.move)).sort((x, y) => x - y);
        const n = abs.length;
        out[t] = {
          n,
          median: n % 2 ? abs[(n - 1) / 2] : (abs[n / 2 - 1] + abs[n / 2]) / 2,
          mean: abs.reduce((x, y) => x + y, 0) / n,
          moves: rs.map((r) => ({ d: r.date, m: Math.round(r.move * 1e5) / 1e5, a: r.accn, doc: r.doc })),
        };
      } catch (e) {
        log(t, (e as Error).message.slice(0, 120));
      } finally {
        if (++done % 200 === 0) log(`${done}/${tickers.length} · ${Object.keys(out).length} with reactions · ${missing} without`);
      }
    }
  }),
);

// a partial run (--tickers) merges into the stored file
const prev = args.tickers ? ((await json<{ companies: Record<string, Entry> }>(REACTIONS_PATH))?.companies ?? {}) : {};
const body = JSON.stringify({ generated: new Date().toISOString(), basis: "close before the earnings 8-K → close the session after", keep: KEEP, companies: { ...prev, ...out } });
const { error } = await sb.storage.from("datasets").upload(REACTIONS_PATH, new Blob([body], { type: "application/json" }), { upsert: true, contentType: "application/json" });
if (error) throw new Error(error.message);
log(`DONE ${Object.keys(out).length} companies with reactions · ${missing} without · ${(body.length / 1024).toFixed(0)} KB`);
