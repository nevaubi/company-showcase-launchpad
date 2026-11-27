/**
 * Rebuild the precomputed IR series payload per company (ir_company_series) from stored facts and
 * the company's label map. Prints reconciliation stats.
 *   bun scripts/ir-build.ts [--tickers=AAPL,MSFT] [--dry] [--no-fill]
 * Table fill (rows the readers left out, read from the stored documents, no model) is on unless --no-fill.
 */
import { COVERAGE } from "@/lib/coverage";
import { loadFacts, rebuildCompany } from "@/lib/ir/rebuild.server";
import { args, dbGate, log } from "./lib/supa";

export { loadFacts };
export const buildCompany = (ticker: string, dry = false, fill = true) =>
  rebuildCompany(ticker, { dry, fill });

if (import.meta.main) {
  const want = args.tickers?.split(",");
  for (const c of COVERAGE.filter((x) => !want || want.includes(x.ticker))) {
    let p: Awaited<ReturnType<typeof buildCompany>> = null;
    await dbGate("build");
    try {
      p = await buildCompany(c.ticker, args.dry !== undefined, args["no-fill"] === undefined);
    } catch (e) {
      log(`${c.ticker} build failed: ${(e as Error).message}`);
      continue;
    }
    if (!p) continue;
    const s = p.stats;
    const bad = p.checks.filter((x) => !x.ok && !x.partial);
    const ql = s.quality;
    log(
      `${c.ticker.padEnd(5)} ${String(s.facts).padStart(6)} facts ${String(s.series).padStart(4)} series ${String(s.groups).padStart(3)} groups  Q ${s.checksQ.ok}/${s.checksQ.total}${s.checksQ.partial ? ` (+${s.checksQ.partial} partial)` : ""}  FY ${s.checksFY.ok}/${s.checksFY.total}  ${s.firstPeriod}→${s.lastPeriod}  ${(JSON.stringify(p).length / 1e6).toFixed(2)}MB${ql ? `  main rows ${ql.main.before}→${ql.main.after}/${ql.main.printed} statements ${ql.main.tables?.shown ?? 0}/${ql.main.tables?.printed ?? 0} docs ${ql.fill.read}/${ql.fill.docs}` : ""}`,
      bad
        .slice(0, 2)
        .map(
          (b) =>
            `${p.series.find((x) => x.k === b.k)?.label}@${b.e} ${(b.sum / 1e6).toFixed(0)}≠${(b.total / 1e6).toFixed(0)}`,
        )
        .join("; "),
    );
  }
  process.exit(0);
}
