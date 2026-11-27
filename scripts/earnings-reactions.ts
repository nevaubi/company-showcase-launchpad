// How every covered stock moved after its recent earnings reports, for the Options page's
// "priced vs past" comparison: close before the 8-K release → close the session after, the same
// measure as the company Earnings tab (`earningsReactions`). Reads the mirrored company and price
// files plus newer stored bars, writes `markets/reactions.json` to the datasets bucket.
//
//   bun scripts/earnings-reactions.ts [--tickers=AAPL,HOOD] [--workers=6]
import { mergeStoredBars, type StoredBar } from "@/lib/append-bars";
import type { StoredMove } from "@/lib/options/as-of";
import { COVERAGE } from "@/lib/coverage";
import { earningsReactions } from "@/lib/markets/core";
import type { Bar, CompanyDataset, PriceSeries } from "@/lib/financials/types";
import { args, log, sb, selectAll } from "./lib/supa";

export const REACTIONS_PATH = "markets/reactions.json";
const KEEP = 12;
const COVERED = new Set(COVERAGE.map((c) => c.ticker));
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
  throw new Error(`Could not read dataset ${path}`);
}

async function bars(t: string): Promise<Bar[]> {
  const s = await json<PriceSeries>(`prices/${file(t)}.json`);
  const out = [...(s?.bars ?? [])];
  const last = out.at(-1)?.[0] ?? "1900-01-01";
  const rows = await selectAll<StoredBar>((from, to) => sb.from("market_bars").select("date, open, high, low, close, adj_close, volume").eq("symbol", t).gte("date", last).order("date").range(from, to));
  return mergeStoredBars(out, rows);
}

type Entry = { generated?: string; n: number; median: number; mean: number; moves: StoredMove[] };
const out: Record<string, Entry> = {};
let next = 0;
let done = 0;
let missing = 0;
let failed = 0;
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
          moves: rs.map((r) => ({ d: r.date, end: r.endDate, m: Math.round(r.move * 1e5) / 1e5, a: r.accn, doc: r.doc })),
        };
      } catch (e) {
        failed++;
        log(t, (e as Error).message.slice(0, 120));
      } finally {
        if (++done % 200 === 0) log(`${done}/${tickers.length} · ${Object.keys(out).length} with reactions · ${missing} without`);
      }
    }
  }),
);

// A failed read must never erase previously observed reactions.
if (!Object.keys(out).length) throw new Error("No earnings reactions rebuilt; prior archive preserved");
const previous = args.tickers || failed || missing
  ? await json<{ generated: string; companies: Record<string, Entry> }>(REACTIONS_PATH)
  : null;
const retained: Record<string, Entry> = {};
for (const [ticker, entry] of Object.entries(previous?.companies ?? {})) {
  if (!out[ticker] && COVERED.has(ticker)) retained[ticker] = { ...entry, generated: entry.generated ?? previous!.generated };
}
const body = JSON.stringify({ generated: new Date().toISOString(), basis: "close before the earnings 8-K → close the session after", keep: KEEP, companies: { ...retained, ...out } });
const { error } = await sb.storage.from("datasets").upload(REACTIONS_PATH, new Blob([body], { type: "application/json" }), { upsert: true, contentType: "application/json" });
if (error) throw new Error(error.message);
log(`DONE ${Object.keys(out).length} companies with reactions · ${missing} without · ${(body.length / 1024).toFixed(0)} KB`);
