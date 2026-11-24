/**
 * Store files linked from each company's investor-relations website (decks, supplements, data
 * files, fact sheets) — found with Firecrawl (site map + page links) and Tavily (CDN-hosted files).
 * Complements the EDGAR exhibit backfill; already-stored URLs are skipped.
 *   bun scripts/ir-site.ts [--tickers=AAPL,MSFT] [--max=200] [--concurrency=3]
 */
import { COVERAGE } from "@/lib/coverage";
import { coverageDetails } from "@/lib/coverage-details.server";
import { collectIr } from "@/lib/jobs/ir.server";
import { siteIsGuarded } from "@/lib/ir/source-guard";
import { args, dbGate, log } from "./lib/supa";

const want = args.tickers?.split(",");
const companies = COVERAGE.filter((c) => !want || want.includes(c.ticker));
const max = Number(args.max ?? 200);
let next = 0;
let stored = 0;

async function worker() {
  while (next < companies.length) {
    const c = companies[next++];
    // The site listed for this company is another company's (reviewed list, source-guard.ts): collecting it would store their files.
    if (siteIsGuarded(c.ticker, c.ir || coverageDetails(c.ticker).ir)) {
      log(`${c.ticker.padEnd(5)} site: skipped, the listed IR site is another company's`);
      continue;
    }
    await dbGate("ir-site");
    const t0 = Date.now();
    try {
      const r = await collectIr(c, "site", max);
      stored += r.stored;
      const failed = r.results.filter((x) => !x.stored);
      log(`${c.ticker.padEnd(5)} site: ${r.stored} files stored${failed.length ? `, ${failed.length} skipped (${failed[0].reason})` : ""} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    } catch (e) {
      log(`${c.ticker.padEnd(5)} site FAILED: ${(e as Error).message}`);
    }
  }
}
await Promise.all(Array.from({ length: Number(args.concurrency ?? 3) }, worker));
log(`done — ${stored} IR-site files stored for ${companies.length} companies`);
