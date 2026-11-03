// Load a company's IR facts + label map and rebuild its precomputed series payload.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { IrFact, LabelMapEntry } from "@/lib/ir/kpis";
import { buildPayload, type IrPayload } from "@/lib/ir/payload";

export const FACT_COLUMNS = "id, document_id, document_kind, category, metric, breakdown, parent, label, is_total, period_start, period_end, months, value, unit, accn, doc, filed, locator, method";

async function pages<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

export const loadFacts = (ticker: string) =>
  pages<IrFact>((a, b) => supabaseAdmin.from("ir_kpi_facts").select(FACT_COLUMNS).eq("ticker", ticker).order("id").range(a, b) as never);

export async function loadLabelMap(ticker: string): Promise<Record<string, LabelMapEntry> | undefined> {
  const rows = await pages<{ raw_key: string; canonical: LabelMapEntry }>((a, b) => supabaseAdmin.from("ir_label_map").select("raw_key, canonical").eq("ticker", ticker).range(a, b) as never);
  return rows.length ? Object.fromEntries(rows.map((r) => [r.raw_key, r.canonical])) : undefined;
}

export async function rebuildCompany(ticker: string, opts: { dry?: boolean } = {}): Promise<IrPayload | null> {
  const [facts, map] = await Promise.all([loadFacts(ticker), loadLabelMap(ticker)]);
  if (!facts.length) return null;
  const payload = buildPayload(ticker, facts, map);
  if (!opts.dry) {
    const { error } = await supabaseAdmin.from("ir_company_series").upsert({ ticker, payload: payload as never, stats: payload.stats as never, built_at: payload.builtAt });
    if (error) throw new Error(error.message);
  }
  return payload;
}
