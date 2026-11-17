// Snapshot every covered stock's Cboe option chain into options_daily right now (the scheduled
// `options` job does the same four stocks at a time through the US evening).
//
// Cboe answers bursts with 429, so requests are paced (--gap ms between starts) and a 429 waits.
//
//   bun scripts/options-snapshot.ts [--tickers=AAPL,HOOD] [--workers=1] [--gap=2900]  (Cboe allows about 20 requests a minute)
import { COVERAGE } from "@/lib/coverage";
import { cboeChainUrl, snapshotRow, summarizeChain, type CboeChain } from "@/lib/options/core";
import { args, dbGate, log, sb, sleep } from "./lib/supa";

const tickers = args.tickers ? String(args.tickers).split(",").map((t) => t.trim().toUpperCase()) : COVERAGE.map((c) => c.ticker);
const workers = Number(args.workers ?? 1);
const gap = Number(args.gap ?? 2900);
let lastStart = 0;
async function pace() {
  for (;;) {
    const wait = lastStart + gap - Date.now();
    if (wait <= 0) break;
    await sleep(wait);
  }
  lastStart = Date.now();
}
let next = 0;
let stored = 0;
let none = 0;
const failed: string[] = [];

async function one(t: string) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await pace();
      const r = await fetch(cboeChainUrl(t), { headers: { "User-Agent": "Mozilla/5.0 (compatible; FiledUnder/1.0)", Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
      if (r.status === 403 || r.status === 404) return void none++;
      if (r.status === 429) {
        log(`${t}: Cboe rate limit, waiting ${30 * (attempt + 1)} s`);
        await sleep(30000 * (attempt + 1));
        continue;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { data?: CboeChain };
      const snap = j.data ? summarizeChain(t, j.data) : null;
      if (!snap) return void none++;
      await dbGate("options");
      const { error } = await sb.from("options_daily").upsert({ ...snapshotRow(snap), fetched_at: new Date().toISOString() }, { onConflict: "ticker,date" });
      if (error) throw new Error(error.message);
      stored++;
      return;
    } catch (e) {
      if (attempt === 4) return void failed.push(`${t}: ${(e as Error).message.slice(0, 80)}`);
      await sleep(1500 * (attempt + 1));
    }
  }
  failed.push(`${t}: still rate limited`);
}

await Promise.all(
  Array.from({ length: workers }, async () => {
    while (next < tickers.length) {
      const t = tickers[next++];
      await one(t);
      const done = stored + none + failed.length;
      if (done % 100 === 0) log(`${done}/${tickers.length} · ${stored} stored · ${none} without options · ${failed.length} failed`);
    }
  }),
);
log(`DONE ${stored} stored · ${none} without options · ${failed.length} failed`);
if (failed.length) log(failed.slice(0, 20).join("\n"));
