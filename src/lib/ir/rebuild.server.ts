import { holdCutoff, holdKey, publicationWindow } from "./history-hold";
// Load a company's IR facts + label map and rebuild its precomputed series payload.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { IrFact, LabelMapEntry } from "@/lib/ir/kpis";
import { buildPayload, type IrPayload } from "@/lib/ir/payload";
import { scenarioDocument, isReportedMeasure } from "./reported-scope";
import { isComparisonPosition } from "./table-fill";
import { containsIrPeriod, type IrRequestedPeriod } from "./payload-view";
import { BUDGET_BYTES, budgetPayload } from "@/lib/ir/payload-budget";
import { planDocuments, type DocPlan, type PlanDocRow } from "@/lib/ir/doc-plan";
import { fixPrintedSigns } from "@/lib/ir/sign-fix";
import { guardedDocIds, hasGuardedSources, withoutGuardedFacts } from "@/lib/ir/source-guard";
import { withCaptions } from "@/lib/ir/statements";
import { tableCaptions, type TableCaption } from "@/lib/ir/table-captions";
import {
  fillCachePath,
  packFillDoc,
  reduceDocument,
  unpackFillDoc,
  type FillDoc,
} from "@/lib/ir/table-fill-cache";
import { coverageOf } from "@/lib/coverage";
import {
  FILL_DOCS,
  fillCompany,
  qualityOf,
  statementPeriodEnds,
  tableDocRows,
  withDocMeta,
  withFill,
  type DocMeta,
  type FillRun,
  type StoredDocRow,
  type TableDoc,
} from "@/lib/ir/table-fill-build";

export const FACT_COLUMNS =
  "id, document_id, document_kind, category, metric, breakdown, parent, label, is_total, period_start, period_end, months, value, unit, accn, doc, filed, locator, method";

/** Reconstruct a requested historical period from its stored filings, without replacing the current company cache. */
export async function readFiledPeriod(ticker: string, period: IrRequestedPeriod, documents: {
  id: string; kind: string; filed: string | null; extract_facts: number | null; title?: string | null; source_url?: string | null;
}[]): Promise<IrPayload | null> {
  const latest = new Date(Date.parse(period.end) + 135 * 86_400_000).toISOString().slice(0, 10);
  const kinds = ["supplement", "press-release", "data", "other"];
  const candidates = documents.filter((d) => !scenarioDocument(d) && d.filed && d.filed >= period.end && d.filed <= latest &&
    Number(d.extract_facts) > 0 && kinds.includes(d.kind));
  candidates.sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind) || a.filed!.localeCompare(b.filed!) || a.id.localeCompare(b.id));
  const span = period.frequency === "y" ? 12 : period.frequency === "m" ? 1 : 3;
  const readGrid = fillReader(documentReader(), { dry: true, company: coverageOf(ticker)?.shortName });
  for (const doc of candidates.slice(0, 12)) {
    const facts = await pages<IrFact>((a, b) => supabaseAdmin.from("ir_kpi_facts").select(FACT_COLUMNS)
      .eq("ticker", ticker).eq("document_id", doc.id).eq("period_end", period.end).in("months", [0, span])
      .eq("derived", false).order("id").range(a, b) as never);
    const printed = facts.filter((f) => f.locator && "t" in f.locator && "r" in f.locator && "c" in f.locator);
    if (!printed.length || (span === 12 && !printed.some((f) => f.months === 12))) continue;
    const source = await readGrid(doc.id);
    const grid = source && source !== "wait" ? source.grid : null;
    const levels = grid ? printed.filter((f) => !isComparisonPosition(grid, f.locator as { t?: number; r?: number; c?: number })) : printed;
    const payload = buildPayload(ticker, fixPrintedSigns(levels).facts);
    if (containsIrPeriod(payload, period)) return payload;
  }
  return null;
}

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
/** The company's document rows for the rebuild's document plan (doc-plan.ts), read in pages of 1,000. */
export async function documentRows(ticker: string): Promise<PlanDocRow[]> {
  return pages<PlanDocRow>(
    (a, b) =>
      supabaseAdmin
        .from("ir_documents")
        .select(
          "id, kind, ext, filed, title, period, source_url, rendition_path, extract_facts, prose_facts, bytes, extract_status",
        )
        .eq("ticker", ticker)
        .order("id")
        .range(a, b) as never,
  );
}

/**
 * Facts of the planned documents only (filtered by document id, 50 ids a query, paged by fact id), so a rebuild
 * never loads every fact of a company with thousands of stored files.
 */
export async function loadFactsOf(ticker: string, ids: string[]): Promise<IrFact[]> {
  const out: IrFact[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    let last: string | null = null;
    for (;;) {
      const after = last;
      const { data, error } = await retry(() => {
        let q = supabaseAdmin
          .from("ir_kpi_facts")
          .select(FACT_COLUMNS)
          .eq("ticker", ticker)
          .in("document_id", chunk)
          .order("id")
          .limit(1000)
          .abortSignal(AbortSignal.timeout(90_000));
        if (after) q = q.gt("id", after);
        return q;
      });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as unknown as IrFact[];
      out.push(...rows);
      if (rows.length < 1000) break;
      last = String((rows.at(-1) as { id: string | number }).id);
    }
  }
  return out;
}

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

/** READ_LIMITS with the catch-up settings applied (see its comment). Reads the environment when called. */
export function readLimits(env: Record<string, string | undefined> = process.env): typeof READ_LIMITS {
  const within = (v: string | undefined, lo: number, hi: number) => {
    const n = Math.floor(Number(v));
    return v != null && v !== "" && Number.isFinite(n) && n >= lo ? Math.min(hi, n) : null;
  };
  const docs = within(env["IR_FILL_DOCS"], 1, 400);
  const minutes = within(env["IR_FILL_MINUTES"], 1, 30);
  if (docs == null && minutes == null) return READ_LIMITS;
  const totalMs = minutes != null ? minutes * 60_000 : READ_LIMITS.totalMs;
  return {
    ...READ_LIMITS,
    docs: docs ?? READ_LIMITS.docs,
    totalMs,
    // The byte bound follows the document count: 40 MB a document at most, as for one document.
    totalBytes: Math.max(READ_LIMITS.totalBytes, (docs ?? READ_LIMITS.docs) * 14e6),
  };
}

/**
 * Bounds on reading stored documents during one company's rebuild (table fill and captions). A rebuild reads
 * `docs` documents that have no reduced copy yet and leaves the rest waiting for the next one (the stale lane
 * comes back for them). A catch-up run on an idle machine raises both with IR_FILL_DOCS (1 to 400 documents) and
 * IR_FILL_MINUTES (1 to 30 minutes of downloads), so one rebuild reads a company's whole history (`readLimits`).
 */
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
 * Reader of one company's documents for the table fill: the reduced copy stored at `fill/<id>.v<n>.json` when there
 * is one, else the stored text (through `documentReader`, at most `limits.docs` downloads a rebuild), reduced and
 * stored for later rebuilds (not when `dry`). Past the downloads it answers "wait": the document is read by a later
 * rebuild. One document is in memory at a time; the caller drops each reduced copy after its fill.
 */
export function fillReader(
  read: (id: string) => Promise<string | null>,
  opts: { dry?: boolean; company?: string; limits?: typeof READ_LIMITS } = {},
) {
  const limits = opts.limits ?? READ_LIMITS;
  const started = Date.now();
  let downloads = 0;
  return async (id: string): Promise<FillDoc | "wait" | null> => {
    if (!UUID.test(id)) return null;
    if (Date.now() - started > limits.totalMs) return "wait";
    const path = fillCachePath(id);
    const cached = await supabaseAdmin.storage
      .from("ir-documents")
      .download(path)
      .catch(() => ({ data: null }));
    if (cached.data) {
      const doc = unpackFillDoc(await cached.data.text());
      if (doc) return doc;
    }
    if (downloads >= limits.docs) return "wait";
    downloads++;
    const html = await read(id);
    if (html == null) return null;
    const doc = reduceDocument(html, opts.company);
    if (!opts.dry)
      await supabaseAdmin.storage
        .from("ir-documents")
        .upload(path, new Blob([packFillDoc(doc)], { type: "application/json" }), {
          upsert: true,
          contentType: "application/json",
        })
        .catch(() => null);
    return doc;
  };
}

/** The fill's stats of the stored payload (for the count of rebuilds in a row that left documents waiting). */
async function storedFillStats(
  ticker: string,
): Promise<{ waiting?: number; pass?: number } | null> {
  const { data } = await supabaseAdmin
    .from("ir_company_series")
    .select("fill:stats->quality->fill")
    .eq("ticker", ticker)
    .maybeSingle();
  return ((data as { fill?: unknown } | null)?.fill as { waiting?: number; pass?: number }) ?? null;
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

/**
 * The company's table documents by their rows (releases, supplements, other HTML exhibits of the full window,
 * and the plan's older primary statement documents, newest first), so a release no stored fact points into is
 * still read; refused documents left out.
 */
export function tableDocuments(
  rows: PlanDocRow[],
  refused: Set<string>,
  older: ReadonlySet<string>,
  placed: Readonly<Record<string, string>> = {},
): TableDoc[] {
  return tableDocRows(rows as StoredDocRow[], new Date().toISOString().slice(0, 10), {
    maxBytes: READ_LIMITS.bytes,
    refused,
    older,
    placed,
  });
}

/**
 * Period ends of the company's 10-Q and 10-K reports, for its fiscal calendar and for the day of a period a
 * release heads by month and year alone. Where the filing index holds no such report for the company (about
 * a hundred covered companies: the index starts after their last one), the quarter ends of its SEC statement
 * file are used instead; without either, no period a document heads can be checked and nothing of it is read.
 */
export async function reportDates(ticker: string): Promise<string[]> {
  const { data, error } = await retry(() =>
    supabaseAdmin
      .from("sec_filings")
      .select("report")
      .eq("ticker", ticker)
      .in("form", ["10-Q", "10-K"])
      .not("report", "is", null)
      .order("report", { ascending: false })
      .limit(80)
      .abortSignal(AbortSignal.timeout(60_000)),
  );
  const filed = error
    ? []
    : ((data ?? []) as { report: string | null }[]).map((r) => r.report).filter((x): x is string => !!x);
  if (filed.length >= 4) return filed;
  const fromFile = await statementFileDates(ticker).catch(() => [] as string[]);
  return [...new Set([...filed, ...fromFile])].sort().reverse();
}

/** Quarter and year ends of the company's SEC statement file (`companies/T.json` in the datasets bucket), newest first. */
async function statementFileDates(ticker: string): Promise<string[]> {
  const { data } = await supabaseAdmin.storage.from("datasets").download(`companies/${ticker}.json`);
  if (!data) return [];
  const file = JSON.parse(await data.text()) as {
    statements?: Record<string, Record<string, { periods?: { end?: string }[] } | undefined> | undefined>;
  };
  return statementPeriodEnds(file);
}

/** Write filing dates the documents print to their rows, only where the row has none (never over a known date). */
async function storePrintedDates(dated: Map<string, string>): Promise<void> {
  const byDate = new Map<string, string[]>();
  for (const [id, filed] of dated) byDate.set(filed, [...(byDate.get(filed) ?? []), id]);
  for (const [filed, ids] of byDate)
    await retry(() =>
      supabaseAdmin.from("ir_documents").update({ filed }).in("id", ids).is("filed", null).abortSignal(AbortSignal.timeout(60_000)),
    );
}

/** A historical campaign may finish after an operator has paused it. Only newly processed,
 * current SEC source documents can then replace the published chart. */
async function preserveHeldHistory(ticker: string): Promise<boolean> {
  const held = await supabaseAdmin.from("job_state").select("paused_reason,updated_at").eq("job",holdKey(ticker)).maybeSingle();
  if (held.error) throw new Error(held.error.message);
  const cutoff = holdCutoff(held.data?.paused_reason);
  if (!cutoff || !held.data) return false;
  const previous = await supabaseAdmin.from("ir_company_series").select("built_at").eq("ticker",ticker).maybeSingle();
  if (previous.error) throw new Error(previous.error.message);
  if (!previous.data?.built_at) return false;
  const days = Number(process.env.IR_FRESH_DAYS ?? 45);
  const range = publicationWindow(cutoff, held.data.updated_at, previous.data.built_at, Number.isFinite(days) ? days : 45);
  const since = range.processedSince;
  const recent = await supabaseAdmin.from("ir_documents").select("id").eq("ticker",ticker)
    .like("source_url","https://www.sec.gov/Archives/%").gte("filed",range.filedSince)
    .or(`and(extracted_at.gt.${since},extract_status.like.ok*),and(vision_at.gt.${since},vision_status.like.ok*),and(prose_at.gt.${since},prose_status.like.ok*)`).limit(1);
  if (recent.error) throw new Error(recent.error.message);
  return !recent.data?.length;
}

export async function rebuildCompany(
  ticker: string,
  opts: { dry?: boolean; captions?: boolean; fill?: boolean; expectedBuiltAt?: string } = {},
): Promise<IrPayload | null> {
  if (!opts.dry && await preserveHeldHistory(ticker)) return null;
  // Only the planned documents' facts are loaded (doc-plan.ts): one copy per document family, decks for two
  // years, older history from the primary statement documents only; documents without a filing date are placed
  // by their period, never left out for lacking one.
  const [docRows, map, refused] = await Promise.all([
    documentRows(ticker),
    loadLabelMap(ticker),
    refusedDocs(ticker),
  ]);
  const plan: DocPlan = planDocuments(docRows.filter((r) => !refused.has(r.id)));
  for (const d of docRows) if (scenarioDocument(d)) refused.add(d.id);
  const stored = await loadFactsOf(ticker, plan.load);
  // Figures read from files of another company (reviewed list, source-guard.ts) never enter the series.
  let facts = withoutGuardedFacts(stored, refused).filter(isReportedMeasure);
  const wantFill = opts.fill !== false && opts.captions !== false;
  // A company with no stored fact is still built when its documents print statements the fill can read.
  const older = new Set(plan.older);
  const [tableDocs, reports] = wantFill
    ? [tableDocuments(docRows, refused, older, plan.placed), await reportDates(ticker)]
    : [[] as TableDoc[], [] as string[]];
  if (!facts.length && !tableDocs.length) return null;
  // STORED-FACT FIXES: pure corrections of stored facts, before table fill and buildPayload.
  // A figure whose printed text opens a parenthesis closed in the next cell was stored positive (sign-fix.ts).
  const signed = fixPrintedSigns(facts);
  facts = [...signed.facts];
  const company = coverageOf(ticker)?.shortName;
  const limits = readLimits();
  const read = documentReader(limits);
  // Filing dates and titles from the document rows: IR-site copies store facts without a filing date.
  const meta = await documentMeta([
    ...new Set(facts.map((f) => f.document_id).filter((x): x is string => !!x)),
  ]);
  for (const d of tableDocs) if (!meta.has(d.id)) meta.set(d.id, d);
  for (const f of facts) {
    const m = f.document_id ? meta.get(f.document_id) : undefined;
    if (m?.filed && !f.filed) f.filed = m.filed;
  }
  // Table fill: printed rows the readers left out, read from the stored documents (no model call).
  let run: FillRun | undefined;
  if (wantFill)
    run = await fillCompany(facts, fillReader(read, { dry: opts.dry, company, limits }), {
      company,
      docs: tableDocs,
      reports,
      older,
    });
  if (!(run?.facts ?? facts).length) return null;
  // Filing dates the documents print themselves (`FillRun.dated`): on the payload's documents, and on the rows.
  for (const [id, filed] of run?.dated ?? []) meta.set(id, { ...(meta.get(id) ?? { kind: null, title: null }), filed });
  if (!opts.dry && run?.dated.size) await storePrintedDates(run.dated).catch(() => undefined);
  let payload = buildPayload(ticker, run?.facts ?? facts, map);
  // Sections only from the newest 37 months' documents, before any caption is read for them (payload-budget.ts).
  payload = budgetPayload(payload, { cap: Infinity }).payload;
  // Printed titles of the tables the statement view is laid out from (documents already read come from the cache).
  // In rounds: a table's printed title and columns can part two tables the first layout took for one (a
  // nine-month statement printed under the same title as the three-month one), and the sections then laid out
  // need their own tables' titles. Each round only adds tables; it ends when one adds none.
  for (let round = 0; round < 3; round++) {
    const had = Object.keys(payload.tables ?? {}).length;
    if (opts.captions !== false) {
      const docsOf = payload.docs;
      payload = await withCaptions(payload, async (d) => {
        const id = docsOf[d]?.id ?? "";
        return run?.captions.get(id) ?? (await documentCaptions(id, company, read).catch(() => null));
      });
    }
    if (run) payload = withFill(payload, run);
    if (Object.keys(payload.tables ?? {}).length === had) break;
  }
  payload = withDocMeta(payload, meta, run);
  const quality = qualityOf(payload, run);
  // Rebuilds in a row that left history documents waiting: the stale lane comes back at most 8 times.
  const prev = run?.waiting ? await storedFillStats(ticker).catch(() => null) : null;
  const pass = run?.waiting ? (prev?.waiting ? (prev.pass ?? 1) : 0) + 1 : 0;
  // The page's budget: at most BUDGET_BYTES serialized, steps recorded; over it the payload is not stored.
  // Keep the untouched history when the final fallback is needed. It is private and
  // downloaded explicitly, never inflated by an ordinary page view.
  const fullHistory = payload;
  // Reserve space for the quality record and archive reference, added below.
  const reserve = new Blob([JSON.stringify({ quality, plan: plan.counts })]).size + 2048;
  // One ladder (payload-budget.ts): the rows the tables print now keep their history longest.
  const bounded = budgetPayload(payload, { cap: BUDGET_BYTES - reserve });
  // Whatever the page file leaves out stays downloadable: the full build is stored beside it.
  const archived = bounded.budget.cut;
  const archivePath = archived ? `series/${ticker}/${crypto.randomUUID()}.json.gz` : null;
  payload = bounded.payload;
  if (archivePath) payload = { ...payload, preview: { basis: "recent-statements", archivePath } };
  // Signs corrected before the fill count with the ones the fill corrected from the document.
  payload = {
    ...payload,
    stats: {
      ...payload.stats,
      quality: {
        ...quality,
        plan: plan.counts,
        budget: bounded.budget,
        fill: {
          ...quality.fill,
          signs: quality.fill.signs + signed.fixed.length,
          ...(run?.proForma.size ? { proForma: run.proForma.size } : {}),
          ...(run?.notResults ? { notResults: run.notResults } : {}),
          pass,
          at: new Date().toISOString(),
        },
      },
    },
  };
  if (!bounded.budget.ok)
    throw new Error(
      `payload over budget: ${bounded.budget.before} bytes built, ${bounded.budget.after} after every step (cap ${bounded.budget.cap})`,
    );
  if (!opts.dry) {
    if (await preserveHeldHistory(ticker)) return null;
    // Payloads for banks run to several MB: keep them in storage, with stats in the table.
    const body = JSON.stringify(payload);
    const bytes = new Blob([body]).size;
    if (bytes > BUDGET_BYTES) throw new Error(`Serialized payload exceeds the page budget: ${bytes} bytes`);
    const path = archivePath || opts.expectedBuiltAt ? `series/${ticker}/${crypto.randomUUID()}.json` : `series/${ticker}.json`;
    if (archivePath) {
      const stream = new Blob([JSON.stringify(fullHistory)]).stream().pipeThrough(new CompressionStream("gzip"));
      const archive = await new Response(stream).blob();
      const { error } = await supabaseAdmin.storage.from("ir-documents")
        .upload(archivePath, archive, { contentType: "application/gzip" });
      if (error) throw new Error(error.message);
    }
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
    const values = {
      payload: null, payload_path: path, payload_bytes: bytes,
      stats: { ...payload.stats, build: payload.build, ...(payload.preview ? { preview: payload.preview } : {}) } as never,
      built_at: payload.builtAt,
    };
    if (opts.expectedBuiltAt) {
      const {data, error} = await supabaseAdmin.from("ir_company_series").update(values).eq("ticker",ticker)
        .eq("built_at",opts.expectedBuiltAt).select("ticker").maybeSingle();
      if (error || !data) throw new Error(error?.message ?? "Another build published a newer company history");
    } else {
      const {error} = await retry(() => supabaseAdmin.from("ir_company_series").upsert({ticker,...values}).abortSignal(AbortSignal.timeout(60_000)));
      if (error) throw new Error(error.message);
    }
  }
  return payload;
}
