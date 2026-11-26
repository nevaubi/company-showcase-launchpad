// Load a company's IR facts + label map and rebuild its precomputed series payload.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { IrFact, LabelMapEntry } from "@/lib/ir/kpis";
import { buildPayload, type IrPayload } from "@/lib/ir/payload";
import { fixPrintedSigns } from "@/lib/ir/sign-fix";
import { guardedDocIds, hasGuardedSources, withoutGuardedFacts } from "@/lib/ir/source-guard";
import { withCaptions } from "@/lib/ir/statements";
import { tableCaptions, type TableCaption } from "@/lib/ir/table-captions";
import { coverageOf } from "@/lib/coverage";
import {
  FILL_DOCS,
  fillCompany,
  qualityOf,
  withDocMeta,
  withFill,
  type DocMeta,
  type FillRun,
} from "@/lib/ir/table-fill-build";

export const FACT_COLUMNS =
  "id, document_id, document_kind, category, metric, breakdown, parent, label, is_total, period_start, period_end, months, value, unit, accn, doc, filed, locator, method";

/** Retry transient database errors (statement timeouts while the reading jobs are inserting). */
async function retry<T extends { error: { message: string } | null }>(
  run: () => PromiseLike<T>,
  tries = 4,
): Promise<T> {
  for (let i = 0; ; i++) {
    const r = await run();
    if (
      !r.error ||
      i >= tries - 1 ||
      !/timeout|timed out|abort|fetch failed|ECONNRESET|503|502|upstream/i.test(r.error.message)
    )
      return r;
    await new Promise((res) => setTimeout(res, 1500 * 2 ** i));
  }
}

async function pages<T>(
  build: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
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
      let q = supabaseAdmin
        .from("ir_kpi_facts")
        .select(FACT_COLUMNS)
        .eq("ticker", ticker)
        .order("id")
        .limit(1000)
        .abortSignal(AbortSignal.timeout(90_000));
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

export async function loadLabelMap(
  ticker: string,
): Promise<Record<string, LabelMapEntry> | undefined> {
  const rows = await pages<{ raw_key: string; canonical: LabelMapEntry }>(
    (a, b) =>
      supabaseAdmin
        .from("ir_label_map")
        .select("raw_key, canonical")
        .eq("ticker", ticker)
        .range(a, b) as never,
  );
  return rows.length ? Object.fromEntries(rows.map((r) => [r.raw_key, r.canonical])) : undefined;
}

/** Ids of this company's stored documents that the reviewed wrong-source list refuses. */
export async function refusedDocs(ticker: string): Promise<Set<string>> {
  if (!hasGuardedSources(ticker)) return new Set();
  const docs = await pages<{ id: string; source_url: string | null }>(
    (a, b) =>
      supabaseAdmin
        .from("ir_documents")
        .select("id, source_url")
        .eq("ticker", ticker)
        .order("id")
        .range(a, b) as never,
  );
  return guardedDocIds(ticker, docs);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Bounds on reading stored documents during one company's rebuild (table fill and captions). */
export const READ_LIMITS = {
  /** a document larger than this is not read */
  bytes: 40e6,
  /** all documents of one company together */
  totalBytes: 160e6,
  /** one download */
  ms: 60_000,
  /** all downloads of one company together; later documents are skipped */
  totalMs: 240_000,
  /** documents per company */
  docs: FILL_DOCS,
};

/**
 * Reader of one company's stored documents, cached for the rebuild: the same stored text the table reader
 * used (rendition first, else the HTML original), so table and row indexes match every fact locator. Null
 * when a document has no such text or cannot be read within the bounds; the sections it anchors keep what
 * the stored facts give them.
 */
export function documentReader(limits = READ_LIMITS) {
  const cache = new Map<string, Promise<string | null>>();
  let bytes = 0;
  const started = Date.now();
  const load = async (id: string): Promise<string | null> => {
    if (!UUID.test(id)) return null;
    if (Date.now() - started > limits.totalMs || bytes > limits.totalBytes) return null;
    const { data: doc } = await supabaseAdmin
      .from("ir_documents")
      .select("path, rendition_path, ext, bytes")
      .eq("id", id)
      .maybeSingle();
    const path =
      doc?.rendition_path || (doc && /^(htm|html)$/i.test(doc.ext ?? "") ? doc.path : null);
    if (!path || (doc?.bytes ?? 0) > limits.bytes) return null;
    const left = Math.max(1, Math.min(limits.ms, limits.totalMs - (Date.now() - started)));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const got = await Promise.race([
      supabaseAdmin.storage.from("ir-documents").download(path),
      new Promise<{ data: null; error: Error }>((res) => {
        timer = setTimeout(() => res({ data: null, error: new Error("timeout") }), left);
      }),
    ]).finally(() => clearTimeout(timer));
    if (!got.data || got.data.size > limits.bytes || bytes + got.data.size > limits.totalBytes)
      return null;
    bytes += got.data.size;
    return got.data.text();
  };
  return (id: string) => {
    let p = cache.get(id);
    if (!p) cache.set(id, (p = load(id).catch(() => null)));
    return p;
  };
}

/**
 * Printed captions (title, scale line, headings, spacer rows) of one stored document. Null when the file
 * can't be read in time; the section then keeps its stored name.
 */
export async function documentCaptions(
  id: string,
  company?: string,
  read: (id: string) => Promise<string | null> = documentReader(),
): Promise<TableCaption[] | null> {
  const text = await read(id);
  return text == null ? null : tableCaptions(text, company);
}

/** Filing date, kind and title of the company's stored documents, by id (read in pages of 200 ids). */
export async function documentMeta(ids: string[]): Promise<Map<string, DocMeta>> {
  const out = new Map<string, DocMeta>();
  const real = ids.filter((x) => UUID.test(x));
  for (let i = 0; i < real.length; i += 200) {
    const { data, error } = await retry(() =>
      supabaseAdmin
        .from("ir_documents")
        .select("id, filed, kind, title")
        .in("id", real.slice(i, i + 200))
        .abortSignal(AbortSignal.timeout(60_000)),
    );
    if (error) throw new Error(error.message);
    for (const d of (data ?? []) as {
      id: string;
      filed: string | null;
      kind: string | null;
      title: string | null;
    }[])
      out.set(d.id, { filed: d.filed, kind: d.kind, title: d.title });
  }
  return out;
}

export async function rebuildCompany(
  ticker: string,
  opts: { dry?: boolean; captions?: boolean; fill?: boolean } = {},
): Promise<IrPayload | null> {
  const [stored, map, refused] = await Promise.all([
    loadFacts(ticker),
    loadLabelMap(ticker),
    refusedDocs(ticker),
  ]);
  // Figures read from files of another company (reviewed list, source-guard.ts) never enter the series.
  let facts = withoutGuardedFacts(stored, refused);
  if (!facts.length) return null;
  // STORED-FACT FIXES: pure corrections of stored facts, before table fill and buildPayload.
  // A figure whose printed text opens a parenthesis closed in the next cell was stored positive (sign-fix.ts).
  const signed = fixPrintedSigns(facts);
  facts = [...signed.facts];
  const company = coverageOf(ticker)?.shortName;
  const read = documentReader();
  // Filing dates and titles from the document rows: IR-site copies store facts without a filing date.
  const meta = await documentMeta([
    ...new Set(facts.map((f) => f.document_id).filter((x): x is string => !!x)),
  ]);
  for (const f of facts) {
    const m = f.document_id ? meta.get(f.document_id) : undefined;
    if (m?.filed && !f.filed) f.filed = m.filed;
  }
  // Table fill: printed rows the readers left out, read from the stored documents (no model call).
  let run: FillRun | undefined;
  if (opts.fill !== false && opts.captions !== false)
    run = await fillCompany(facts, read, { company, maxDocs: READ_LIMITS.docs });
  let payload = buildPayload(ticker, run?.facts ?? facts, map);
  // Printed titles of the tables the statement view is laid out from (documents already read come from the cache).
  if (opts.captions !== false) {
    payload = await withCaptions(payload, async (d) => {
      const id = payload.docs[d]?.id ?? "";
      return run?.captions.get(id) ?? (await documentCaptions(id, company, read).catch(() => null));
    });
  }
  if (run) payload = withFill(payload, run);
  payload = withDocMeta(payload, meta, run);
  const quality = qualityOf(payload, run);
  // Signs corrected before the fill count with the ones the fill corrected from the document.
  payload = { ...payload, stats: { ...payload.stats, quality: { ...quality, fill: { ...quality.fill, signs: quality.fill.signs + signed.fixed.length } } } };
  if (!opts.dry) {
    // Payloads for banks run to several MB: keep them in storage, with stats in the table.
    const body = JSON.stringify(payload);
    const path = `series/${ticker}.json`;
    const up = await Promise.race([
      supabaseAdmin.storage
        .from("ir-documents")
        .upload(path, new Blob([body], { type: "application/json" }), {
          upsert: true,
          contentType: "application/json",
        }),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error(`upload of ${path} timed out`)), 120_000),
      ),
    ]);
    if (up.error) throw new Error(up.error.message);
    const { error } = await retry(() =>
      supabaseAdmin
        .from("ir_company_series")
        .upsert({
          ticker,
          payload: null,
          payload_path: path,
          payload_bytes: body.length,
          // The build format rides in stats so the worker's stale-payload lane reads it without the payload.
          stats: { ...payload.stats, build: payload.build } as never,
          built_at: payload.builtAt,
        })
        .abortSignal(AbortSignal.timeout(60_000)),
    );
    if (error) throw new Error(error.message);
  }
  return payload;
}
