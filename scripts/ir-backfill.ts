/**
 * Download and store every investor-relations exhibit since `--since` (default 2008-01-01):
 * EX-99 earnings releases, supplements, presentations and attached files from Item 2.02 / 7.01
 * 8-Ks on EDGAR, plus (with --site) files linked from each company's IR website.
 * Files are stored byte-for-byte in the private `ir-documents` bucket; re-runs skip stored filings.
 *   bun scripts/ir-backfill.ts [--tickers=AAPL,MSFT] [--since=2008-01-01] [--concurrency=4] [--site]
 */
import { COVERAGE } from "@/lib/coverage";
import { collectIr } from "@/lib/jobs/ir.server";
import { args, log } from "./lib/supa";

const since = args.since ?? "2008-01-01";
const want = args.tickers?.split(",");
const companies = COVERAGE.filter((c) => !want || want.includes(c.ticker));
const concurrency = Number(args.concurrency ?? 4);
let next = 0;
let stored = 0;

async function worker() {
  while (next < companies.length) {
    const c = companies[next++];
    const t0 = Date.now();
    try {
      let filings = 0;
      const r = await collectIr(c, "sec", Number.POSITIVE_INFINITY, { since, onFiling: () => filings++ });
      stored += r.stored;
      const failed = r.results.filter((x) => !x.stored);
      log(`${c.ticker.padEnd(5)} sec: ${filings} new filings, ${r.stored} files stored${failed.length ? `, ${failed.length} failed (${failed[0].reason})` : ""} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      if (args.site !== undefined) {
        const s = await collectIr(c, "site", 200);
        stored += s.stored;
        log(`${c.ticker.padEnd(5)} site: ${s.stored} files stored`);
      }
    } catch (e) {
      log(`${c.ticker} FAILED: ${(e as Error).message}`);
    }
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));
log(`done — ${stored} files stored for ${companies.length} companies`);
