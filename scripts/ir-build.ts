/**
 * Rebuild the precomputed IR series payload per company (ir_company_series) from stored facts and
 * the company's label map. Prints reconciliation stats.
 *   bun scripts/ir-build.ts [--tickers=AAPL,MSFT] [--dry]
 */
import { COVERAGE } from "@/lib/coverage";
import { loadFacts, rebuildCompany } from "@/lib/ir/rebuild.server";
import { args, log } from "./lib/supa";

export { loadFacts };
export const buildCompany = (ticker: string, dry = false) => rebuildCompany(ticker, { dry });

if (import.meta.main) {
  const want = args.tickers?.split(",");
  for (const c of COVERAGE.filter((x) => !want || want.includes(x.ticker))) {
    const p = await buildCompany(c.ticker, args.dry !== undefined);
    if (!p) continue;
    const s = p.stats;
    const bad = p.checks.filter((x) => !x.ok);
    log(
      `${c.ticker.padEnd(5)} ${String(s.facts).padStart(6)} facts ${String(s.series).padStart(4)} series ${String(s.groups).padStart(3)} groups  Q ${s.checksQ.ok}/${s.checksQ.total}  FY ${s.checksFY.ok}/${s.checksFY.total}  ${s.firstPeriod}→${s.lastPeriod}  ${(JSON.stringify(p).length / 1e6).toFixed(2)}MB`,
      bad
        .slice(0, 2)
        .map((b) => `${p.series.find((x) => x.k === b.k)?.label}@${b.e} ${(b.sum / 1e6).toFixed(0)}≠${(b.total / 1e6).toFixed(0)}`)
        .join("; "),
    );
  }
  process.exit(0);
}
