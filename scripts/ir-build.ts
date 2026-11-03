/**
 * Rebuild the precomputed IR series payload per company (ir_company_series) from stored facts and
 * the company's label map. Prints reconciliation stats.
 *   bun scripts/ir-build.ts [--tickers=AAPL,MSFT] [--dry]
 */
import { COVERAGE } from "@/lib/coverage";
import type { IrFact, LabelMapEntry } from "@/lib/ir/kpis";
import { buildPayload } from "@/lib/ir/payload";
import { args, log, sb, selectAll } from "./lib/supa";

export const FACT_COLUMNS = "id, document_id, document_kind, category, metric, breakdown, parent, label, is_total, period_start, period_end, months, value, unit, accn, doc, filed, locator, method";

export async function loadFacts(ticker: string) {
  return selectAll<IrFact>((a, b) => sb.from("ir_kpi_facts").select(FACT_COLUMNS).eq("ticker", ticker).order("id").range(a, b) as never);
}
export async function loadLabelMap(ticker: string) {
  const rows = await selectAll<{ raw_key: string; canonical: LabelMapEntry }>((a, b) => sb.from("ir_label_map").select("raw_key, canonical").eq("ticker", ticker).range(a, b) as never);
  return rows.length ? Object.fromEntries(rows.map((r) => [r.raw_key, r.canonical])) : undefined;
}

export async function buildCompany(ticker: string, dry = false) {
  const [facts, map] = await Promise.all([loadFacts(ticker), loadLabelMap(ticker)]);
  if (!facts.length) return null;
  const payload = buildPayload(ticker, facts, map);
  if (!dry) {
    const { error } = await sb.from("ir_company_series").upsert({ ticker, payload: payload as never, stats: payload.stats as never, built_at: payload.builtAt });
    if (error) throw new Error(error.message);
  }
  return payload;
}

if (import.meta.main) {
  const want = args.tickers?.split(",");
  for (const c of COVERAGE.filter((x) => !want || want.includes(x.ticker))) {
    const p = await buildCompany(c.ticker, args.dry !== undefined);
    if (!p) continue;
    const s = p.stats;
    const bad = p.checks.filter((x) => !x.ok);
    log(
      `${c.ticker.padEnd(5)} ${String(s.facts).padStart(6)} facts ${String(s.series).padStart(4)} series ${String(s.groups).padStart(3)} groups  Q ${s.checksQ.ok}/${s.checksQ.total}  FY ${s.checksFY.ok}/${s.checksFY.total}  ${s.firstPeriod}→${s.lastPeriod}  ${(JSON.stringify(p).length / 1e6).toFixed(2)}MB`,
      bad.slice(0, 2).map((b) => `${p.series.find((x) => x.k === b.k)?.label}@${b.e} ${(b.sum / 1e6).toFixed(0)}≠${(b.total / 1e6).toFixed(0)}`).join("; "),
    );
  }
}
