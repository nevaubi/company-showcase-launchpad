// Pulls consensus estimates, revisions, ratings and analyst actions for every covered company
// into `analyst_estimates` (one payload per ticker). Rerun any time; a failed ticker keeps its row.
//   bun scripts/estimates.ts [--only=AAPL,MSFT]
import { COVERAGE_TICKERS } from "@/lib/coverage";
import { fetchEstimates } from "@/lib/estimates.server";
import { args, log, sb, sleep } from "./lib/supa";

const tickers = args.only ? args.only.toUpperCase().split(",") : COVERAGE_TICKERS;
let ok = 0;
const failed: string[] = [];
for (const t of tickers) {
  try {
    const e = await fetchEstimates(t);
    const { error } = await sb.from("analyst_estimates").upsert({ ticker: t, payload: e as never, fetched_at: e.asOf });
    if (error) throw new Error(error.message);
    ok++;
    log(t, `${e.periods.length} periods, ${e.actions.length} actions, ${e.target.analysts ?? 0} analysts`);
  } catch (err) {
    failed.push(t);
    log(t, "FAILED", (err as Error).message);
  }
  await sleep(350);
}
log(`done: ${ok} stored, ${failed.length} failed${failed.length ? ` (${failed.join(", ")})` : ""}`);
