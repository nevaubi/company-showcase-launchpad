// Load a company's IR facts + label map and rebuild its precomputed series payload.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { IrFact, LabelMapEntry } from "@/lib/ir/kpis";
import { buildPayload, type IrPayload } from "@/lib/ir/payload";

export const FACT_COLUMNS = "id, document_id, document_kind, category, metric, breakdown, parent, label, is_total, period_start, period_end, months, value, unit, accn, doc, filed, locator, method";

/** Retry transient database errors (statement timeouts while the reading jobs are inserting). */
async function retry<T extends { error: { message: string } | null }>(run: () => PromiseLike<T>, tries = 4): Promise<T> {
  for (let i = 0; ; i++) {
    const r = await run();
    if (!r.error || i >= tries - 1 || !/timeout|fetch failed|ECONNRESET|503|502|upstream/i.test(r.error.message)) return r;
    await new Promise((res) => setTimeout(res, 1500 * 2 ** i));
  }
}

async function pages<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await retry(() => build(from, from + 999));
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

/** All facts for a company, paged by id (keyset) so large companies don't hit the statement timeout. */
export async function loadFacts(ticker: string): Promise<IrFact[]> {
  const out: IrFact[] = [];
  let last: string | null = null;
  for (;;) {
    const after = last;
    const { data, error } = await retry(() => {
      let q = supabaseAdmin.from("ir_kpi_facts").select(FACT_COLUMNS).eq("ticker", ticker).order("id").limit(1000);
      if (after) q = q.gt("id", after);
      return q;
    });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as IrFact[];
    out.push(...rows);
    if (rows.length < 1000) return out;
    last = String((rows.at(-1) as { id: string | number }).id);
  }
}

export async function loadLabelMap(ticker: string): Promise<Record<string, LabelMapEntry> | undefined> {
  const rows = await pages<{ raw_key: string; canonical: LabelMapEntry }>((a, b) => supabaseAdmin.from("ir_label_map").select("raw_key, canonical").eq("ticker", ticker).range(a, b) as never);
  return rows.length ? Object.fromEntries(rows.map((r) => [r.raw_key, r.canonical])) : undefined;
}

export async function rebuildCompany(ticker: string, opts: { dry?: boolean } = {}): Promise<IrPayload | null> {
  const [facts, map] = await Promise.all([loadFacts(ticker), loadLabelMap(ticker)]);
  if (!facts.length) return null;
  const payload = buildPayload(ticker, facts, map);
  if (!opts.dry) {
    // Payloads for banks run to several MB: keep them in storage, with stats in the table.
    const body = JSON.stringify(payload);
    const path = `series/${ticker}.json`;
    const up = await supabaseAdmin.storage.from("ir-documents").upload(path, new Blob([body], { type: "application/json" }), { upsert: true, contentType: "application/json" });
    if (up.error) throw new Error(up.error.message);
    const { error } = await retry(() =>
      supabaseAdmin
        .from("ir_company_series")
        .upsert({ ticker, payload: null, payload_path: path, payload_bytes: body.length, stats: payload.stats as never, built_at: payload.builtAt }),
    );
    if (error) throw new Error(error.message);
  }
  return payload;
}
