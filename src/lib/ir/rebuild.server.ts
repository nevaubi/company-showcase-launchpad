// Load a company's IR facts + label map and rebuild its precomputed series payload.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { IrFact, LabelMapEntry } from "@/lib/ir/kpis";
import { buildPayload, type IrPayload } from "@/lib/ir/payload";
import { guardedDocIds, hasGuardedSources, withoutGuardedFacts } from "@/lib/ir/source-guard";
import { withCaptions } from "@/lib/ir/statements";
import { tableCaptions, type TableCaption } from "@/lib/ir/table-captions";
import { coverageOf } from "@/lib/coverage";

export const FACT_COLUMNS = "id, document_id, document_kind, category, metric, breakdown, parent, label, is_total, period_start, period_end, months, value, unit, accn, doc, filed, locator, method";

/** Retry transient database errors (statement timeouts while the reading jobs are inserting). */
async function retry<T extends { error: { message: string } | null }>(run: () => PromiseLike<T>, tries = 4): Promise<T> {
  for (let i = 0; ; i++) {
    const r = await run();
    if (!r.error || i >= tries - 1 || !/timeout|timed out|abort|fetch failed|ECONNRESET|503|502|upstream/i.test(r.error.message)) return r;
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
      // A stalled connection must fail (and be retried) rather than hang the rebuild forever.
      let q = supabaseAdmin.from("ir_kpi_facts").select(FACT_COLUMNS).eq("ticker", ticker).order("id").limit(1000).abortSignal(AbortSignal.timeout(90_000));
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

/** Ids of this company's stored documents that the reviewed wrong-source list refuses. */
export async function refusedDocs(ticker: string): Promise<Set<string>> {
  if (!hasGuardedSources(ticker)) return new Set();
  const docs = await pages<{ id: string; source_url: string | null }>((a, b) => supabaseAdmin.from("ir_documents").select("id, source_url").eq("ticker", ticker).order("id").range(a, b) as never);
  return guardedDocIds(ticker, docs);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Printed captions (title, scale line, headings, spacer rows) of one stored document, read from the same
 * stored text the table reader used (rendition first, else the original), so table and row indexes match
 * every fact locator. Null when the file can't be read in time; the section then keeps its stored name.
 */
export async function documentCaptions(id: string, company?: string): Promise<TableCaption[] | null> {
  if (!UUID.test(id)) return null;
  const { data: doc } = await supabaseAdmin.from("ir_documents").select("path, rendition_path, ext").eq("id", id).maybeSingle();
  const path = doc?.rendition_path || (doc && /^(htm|html)$/i.test(doc.ext ?? "") ? doc.path : null);
  if (!path) return null;
  const got = await Promise.race([
    supabaseAdmin.storage.from("ir-documents").download(path),
    new Promise<{ data: null; error: Error }>((res) => setTimeout(() => res({ data: null, error: new Error("timeout") }), 60_000)),
  ]);
  if (!got.data || got.data.size > 40e6) return null;
  return tableCaptions(await got.data.text(), company);
}

export async function rebuildCompany(ticker: string, opts: { dry?: boolean; captions?: boolean } = {}): Promise<IrPayload | null> {
  const [stored, map, refused] = await Promise.all([loadFacts(ticker), loadLabelMap(ticker), refusedDocs(ticker)]);
  // Figures read from files of another company (reviewed list, source-guard.ts) never enter the series.
  const facts = withoutGuardedFacts(stored, refused);
  if (!facts.length) return null;
  let payload = buildPayload(ticker, facts, map);
  // Printed titles of the tables the statement view is laid out from (a few documents per company).
  if (opts.captions !== false) {
    const company = coverageOf(ticker)?.shortName;
    payload = await withCaptions(payload, (d) => documentCaptions(payload.docs[d]?.id ?? "", company).catch(() => null));
  }
  if (!opts.dry) {
    // Payloads for banks run to several MB: keep them in storage, with stats in the table.
    const body = JSON.stringify(payload);
    const path = `series/${ticker}.json`;
    const up = await Promise.race([
      supabaseAdmin.storage.from("ir-documents").upload(path, new Blob([body], { type: "application/json" }), { upsert: true, contentType: "application/json" }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`upload of ${path} timed out`)), 120_000)),
    ]);
    if (up.error) throw new Error(up.error.message);
    const { error } = await retry(() =>
      supabaseAdmin
        .from("ir_company_series")
        .upsert({ ticker, payload: null, payload_path: path, payload_bytes: body.length, stats: payload.stats as never, built_at: payload.builtAt })
        .abortSignal(AbortSignal.timeout(60_000)),
    );
    if (error) throw new Error(error.message);
  }
  return payload;
}
