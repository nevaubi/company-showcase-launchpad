// One catch-up pass of market-wide discovery: every covered filing in EDGAR's daily indexes for the
// last N days (default 7) plus today's current feeds, resolving every missing company. The worker
// loop runs it daily (after 03:00 UTC) and whenever the scheduled day pass gives up, so busy filing
// days no longer wait for the 46-hour `sec` walk. Companies are resolved one at a time, 150 ms apart
// (SEC allows 10 requests a second), until done or --max-minutes runs out. Writes a `job_runs` row
// `sec-discover-catchup` with missingBefore/After.
// Usage: bun scripts/sec-discover-catchup.ts [days] [--max-minutes=40]
import { feedUrl, FEED_TYPES, masterUrl, nextDay, parseCurrentAtom, parseMasterIndex, type DiscoveredFiling } from "../src/lib/jobs/sec-discover";
import { missingFilings, resolve } from "../src/lib/jobs/sec-discover.server";
import { fetchSec } from "../src/lib/sec.server";
import { supabaseAdmin } from "../src/integrations/supabase/client.server";

const days = Number(process.argv.slice(2).find((a) => !a.startsWith("--")) ?? 7);
const maxMinutes = Number(process.argv.find((a) => a.startsWith("--max-minutes="))?.split("=")[1] ?? 40);
const deadline = Date.now() + maxMinutes * 60_000;
const UA = "FiledUnder Research research@filedunder.ai";
const sleep = (ms: number) => new Promise((x) => setTimeout(x, ms));
const started = new Date().toISOString();
const { data: run } = await supabaseAdmin.from("job_runs").insert({ job: "sec-discover-catchup", started_at: started }).select("id").single();

async function finish(ok: boolean, detail: Record<string, unknown>, items: number) {
  if (run) await supabaseAdmin.from("job_runs").update({ finished_at: new Date().toISOString(), ok, items, detail: detail as never }).eq("id", run.id);
  console.log(JSON.stringify(detail));
}

try {
  const all: DiscoveredFiling[] = [];
  const today = new Date().toISOString().slice(0, 10);
  for (let d = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10); d < today; d = nextDay(d)) {
    const r = await fetch(masterUrl(d), { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30_000) }).catch((e: Error) => {
      console.log(d, "index fetch failed", e.message);
      return null;
    });
    if (r?.ok) {
      const rows = parseMasterIndex(await r.text());
      all.push(...rows);
      console.log(d, rows.length, "filings listed");
    } else if (r) console.log(d, "no index", r.status);
    await sleep(200);
  }
  for (const t of FEED_TYPES) {
    try {
      all.push(...parseCurrentAtom(await (await fetchSec(feedUrl(t))).text()));
    } catch (e) {
      console.log(t, "feed failed", (e as Error).message);
    }
    await sleep(200);
  }
  const { covered, missing } = await missingFilings(all);
  const missingBefore = new Set(missing.map((m) => m.accn)).size;
  const tickers = [...new Set(missing.map((m) => m.ticker))];
  console.log(JSON.stringify({ covered: new Set(covered.map((c) => c.accn)).size, missingBefore, companies: tickers.length }));
  let resolved = 0;
  let filingsStored = 0;
  let earnings = 0;
  const errors: string[] = [];
  for (const t of tickers) {
    if (Date.now() > deadline) break;
    try {
      const r = await resolve(missing.filter((m) => m.ticker === t), () => Date.now() < deadline, 1);
      resolved += r.resolved.length;
      filingsStored += r.filings;
      earnings += r.earnings;
      errors.push(...r.errors);
    } catch (e) {
      errors.push(`${t}: ${(e as Error).message.slice(0, 160)}`);
    }
    await sleep(150);
  }
  const after = await missingFilings(all);
  const missingAfter = new Set(after.missing.map((m) => m.accn)).size;
  await finish(missingAfter === 0 || resolved > 0, { days, missingBefore, missingAfter, companies: tickers.length, resolvedCompanies: resolved, filingsStored, earningsEvents: earnings, outOfTime: Date.now() > deadline, stillMissing: after.missing.slice(0, 15).map((m) => `${m.ticker} ${m.form} ${m.accn} ${m.filed}`), errors: errors.slice(0, 10) }, filingsStored);
  process.exit(0);
} catch (e) {
  await finish(false, { error: (e as Error).message.slice(0, 300) }, 0);
  process.exit(1);
}
