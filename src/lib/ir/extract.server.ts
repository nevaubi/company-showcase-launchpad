// Extract segment / product / geography / cost / KPI facts from a stored IR document.
// Uses the owner's OpenAI key when configured (bulk IR analysis), otherwise the Lovable AI Gateway.
// The model only points at cells; values are re-read from the parsed table in factsFromModel().
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { structured } from "@/lib/ai.server";
import { screenRows } from "@/lib/ir/scale-check";
import { chunkTables, EXTRACT_INSTRUCTIONS, EXTRACT_SCHEMA, factsFromModel, leadText, type FactRow, type ModelOutput } from "@/lib/ir/extract-core";
import { decodeHtml, parseNumber, parseTables, type ParsedTable } from "@/lib/ir/tables";
import { fixRowDates, printedDates } from "@/lib/ir/dates";
import { estimateCredits, hasOpenAIKey, IR_MODELS, OpenAIError, openaiStructured, type Effort, type Usage } from "@/lib/openai.server";
import { cellKey, crossCheckBy } from "@/lib/ir/second-read";
import { EXTRACT_QUALITY_PROMPT, extractFollowUpPrompt, mergeFactRows, missedRows, needsExtractEscalation } from "@/lib/ir/extract-quality";

/** Kinds that carry numeric tables worth reading. */
export const EXTRACTABLE_KINDS = ["press-release", "supplement", "presentation", "data", "other"];

interface ChunkOpts {
  quality?: boolean;
  effort?: Effort;
}

async function runChunk(input: string, model: string, o: ChunkOpts = {}): Promise<{ out: ModelOutput; usage: Usage; model: string }> {
  const instructions = o.quality ? `${EXTRACT_INSTRUCTIONS}\n\n${EXTRACT_QUALITY_PROMPT}` : EXTRACT_INSTRUCTIONS;
  if (hasOpenAIKey()) {
    const r = await openaiStructured<ModelOutput>({
      model,
      name: "ir_tables",
      instructions,
      input,
      schema: EXTRACT_SCHEMA as unknown as Record<string, unknown>,
      effort: o.effort ?? "low",
    });
    return { out: r.data, usage: r.usage, model: r.model };
  }
  const out = await structured<ModelOutput>({
    name: "ir_tables",
    instructions,
    input,
    schema: EXTRACT_SCHEMA as unknown as Record<string, unknown>,
    effort: "low",
  });
  return { out, usage: { input_tokens: 0, output_tokens: 0, cached_tokens: 0 }, model: "lovable-gateway" };
}

const ZERO: Usage = { input_tokens: 0, output_tokens: 0, cached_tokens: 0 };
const addUsage = (a: Usage, b: Usage): Usage => ({ input_tokens: a.input_tokens + b.input_tokens, output_tokens: a.output_tokens + b.output_tokens, cached_tokens: a.cached_tokens + b.cached_tokens });

/** Run `fn` over items with at most `n` in flight (Worker runtimes allow 6 outbound connections). */
export async function pool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

export interface ReadChunkOpts {
  quality?: boolean;
  effort?: Effort;
  /** second model for parts whose first answer was unusable or had too many invalid pointers */
  escalate?: string;
  /** one review turn listing numeric rows the answer left out (missedRows) */
  followUp?: boolean;
  /** OpenAI second reader on the free allowance (on unless IR_OPENAI_TABLES=0) */
  secondRead?: boolean;
}

export interface ChunkRead {
  rows: FactRow[];
  rejected: number;
  usage: Usage;
  credits: number;
  model: string;
  escalated: boolean;
  followUp: boolean;
  /** second reader: confirmed / dropped / its own finds left out / it replaced an unusable answer */
  second?: { agreed: number; conflicts: number; secondOnly: number; rescued: boolean };
}

/** The OpenAI second reader for one part, or null when the lane is off or spent. */
async function laneChunk(input: string): Promise<ModelOutput | null> {
  const { laneEnabled, laneStructured } = await import("@/lib/ir/openai-lane.server");
  if (!laneEnabled()) return null;
  const r = await laneStructured<ModelOutput>({
    name: "ir_tables",
    instructions: `${EXTRACT_INSTRUCTIONS}\n\n${EXTRACT_QUALITY_PROMPT}\n\n${SECOND_READER_PROMPT}`,
    input,
    schema: EXTRACT_SCHEMA as unknown as Record<string, unknown>,
    effort: "medium",
    // Reasoning counts against the cap; a cut-off answer is wasted, and these tokens are free.
    maxOutputTokens: 64_000,
  });
  return r?.data ?? null;
}

const SECOND_READER_PROMPT = `You are the independent second reader. Another analyst has read these tables; your answer is compared cell by cell and any cell you two date differently is thrown out, so precision on dates matters more than anything:
- Read every column header for the period it covers: the fiscal period end it prints (not the calendar month-end unless printed), and its length (point-in-time balance = 0 months, quarter = 3, six/nine months year-to-date = 6/9, fiscal year = 12, one month = 1).
- "Three months ended", "Q4", "fourth quarter" are 3 months even in an annual release; "twelve months ended" / "full year" / "fiscal 2025" are 12.
- Balance sheet lines, headcounts, store/branch counts, assets under management and other balances at a date are 0 months.
- Name each line exactly as the table does, scoped to its segment or table heading, and keep totals marked as totals.
- Point only at cells that hold a number printed in the table. Skip a cell rather than guess its period.`;

/**
 * Read one prompt chunk: first answer, optional escalation to a second model, optional review turn
 * for rows left out. Shared by the bulk reader and the pilot so a pilot measures production.
 */
export async function readChunk(o: { input: string; chunk: string; tables: ParsedTable[]; filed: string | null; model: string } & ReadChunkOpts): Promise<ChunkRead> {
  let usage = ZERO;
  let credits = 0;
  const bill = (m: string, u: Usage | undefined) => {
    if (!u) return;
    usage = addUsage(usage, u);
    credits += estimateCredits(m, u) ?? 0;
  };
  let answer: { out: ModelOutput; model: string } | null = null;
  let failed: string | null = null;
  // The second reader runs alongside the first; it never delays or fails the part.
  const secondP = o.secondRead === false || process.env["IR_OPENAI_TABLES"] === "0" ? Promise.resolve(null) : laneChunk(o.input).catch(() => null);
  try {
    const r = await runChunk(o.input, o.model, o);
    bill(o.model, r.usage);
    answer = r;
  } catch (e) {
    if (!(o.escalate && e instanceof OpenAIError && e.kind === "rejected")) throw e;
    bill(o.model, e.usage);
    failed = e.message;
  }
  let facts = answer ? factsFromModel(answer.out, o.tables, o.filed) : { rows: [] as FactRow[], rejected: 0 };
  let model = o.model;
  let escalated = false;
  if (o.escalate && needsExtractEscalation({ failed, kept: facts.rows.length, rejected: facts.rejected })) {
    try {
      const r = await runChunk(o.input, o.escalate, { ...o, effort: "high" });
      bill(o.escalate, r.usage);
      answer = r;
      facts = factsFromModel(r.out, o.tables, o.filed);
      model = o.escalate;
      escalated = true;
    } catch (e) {
      // The first answer stands when the second read is unusable; with neither, the part fails.
      if (!(e instanceof OpenAIError && e.kind === "rejected") || !answer) throw e;
      bill(o.escalate, e.usage);
    }
  }
  const secondOut = await secondP;
  const secondFacts = secondOut ? factsFromModel(secondOut, o.tables, o.filed) : null;
  if (!answer) {
    if (!secondFacts?.rows.length) throw new Error(failed ?? "unusable answer");
    // Unusable first answer: the second reader's whole reading is the part's only one.
    return { ...secondFacts, usage, credits, model: `openai:${(await import("@/lib/ir/openai-lane.server")).LANE_MODEL}`, escalated, followUp: false, second: { agreed: 0, conflicts: 0, secondOnly: secondFacts.rows.length, rescued: true } };
  }
  let followUp = false;
  if (o.followUp) {
    const missed = missedRows(o.chunk, answer.out.tables ?? [], (c) => parseNumber(c) != null);
    if (missed.length) {
      followUp = true;
      try {
        const r = await runChunk(`${o.input}\n\n${extractFollowUpPrompt(missed)}`, model, o);
        bill(model, r.usage);
        const more = factsFromModel(r.out, o.tables, o.filed);
        facts = { rows: mergeFactRows(facts.rows, more.rows), rejected: facts.rejected + more.rejected };
      } catch (e) {
        // The first answer stands if the review turn is unusable.
        if (!(e instanceof OpenAIError && e.kind === "rejected")) throw e;
        bill(model, e.usage);
      }
    }
  }
  let second: ChunkRead["second"];
  if (secondFacts) {
    const x = crossCheckBy(facts.rows, secondFacts.rows, cellKey);
    facts = { rows: x.rows, rejected: facts.rejected };
    second = { agreed: x.agreed, conflicts: x.conflicts, secondOnly: x.secondOnly, rescued: false };
    if (x.agreed) model = `${model}+openai`;
  }
  return { ...facts, usage, credits, model, escalated, followUp, second };
}

/**
 * Read one stored document's tables. Options for bulk runs: `quality` adds the reading checklist,
 * `effort` sets the reasoning depth, `escalate` names a second model that re-reads any part whose
 * first answer was unusable or had too many invalid pointers, `followUp` adds one review turn for
 * rows left out; each fact carries the name of the model whose answer produced it.
 */
export async function extractIrDocument(id: string, opts: { model?: string; concurrency?: number; chunkChars?: number } & ReadChunkOpts = {}) {
  const { data: doc } = await supabaseAdmin.from("ir_documents").select("*").eq("id", id).maybeSingle();
  if (!doc?.path) throw new Error("Document not stored");
  const { data: file, error } = await supabaseAdmin.storage.from("ir-documents").download(doc.rendition_path || doc.path);
  if (error || !file) throw new Error(error?.message ?? "Download failed");
  const html = await file.text();
  const tables = parseTables(html);
  const chunks = chunkTables(tables, opts.chunkChars);
  const mark = (patch: Record<string, unknown>) => supabaseAdmin.from("ir_documents").update({ extracted_at: new Date().toISOString(), ...patch }).eq("id", id);
  if (!chunks.length) {
    await mark({ extract_status: "no tables", extract_facts: 0 });
    return { facts: 0, rejected: 0, usage: null, credits: 0, escalated: 0, followUps: 0, second: null };
  }
  const model = opts.model ?? IR_MODELS.extract;
  const context = `Company: ${doc.ticker}. Document: ${doc.title} (${doc.kind}${doc.exhibit ? `, ${doc.exhibit}` : ""}, filed ${doc.filed ?? "unknown"}).\nOpening text: ${leadText(html)}`;
  const results = await pool(chunks, opts.concurrency ?? 4, (c, i) =>
    readChunk({ ...opts, input: `${context}\n\nTables (part ${i + 1} of ${chunks.length}):\n\n${c}`, chunk: c, tables, filed: doc.filed, model }),
  );
  const usage = results.reduce((u, r) => addUsage(u, r.usage), ZERO);
  const credits = results.reduce((n, r) => n + r.credits, 0);
  const escalated = results.filter((r) => r.escalated).length;
  const followUps = results.filter((r) => r.followUp).length;
  const second = results.reduce((a, r) => (r.second ? { agreed: a.agreed + r.second.agreed, conflicts: a.conflicts + r.second.conflicts, secondOnly: a.secondOnly + r.second.secondOnly, rescued: a.rescued + (r.second.rescued ? 1 : 0), parts: a.parts + 1 } : a), { agreed: 0, conflicts: 0, secondOnly: 0, rescued: 0, parts: 0 });
  // Parts of one split table repeat its header rows: keep each cell once.
  const seen = new Set<string>();
  let rejected = 0;
  const doc_ = doc.source_url.split("/").pop() ?? null;
  // A column dated to a calendar month-end the document never prints ("12 Weeks Ended November 23")
  // takes the period end the document does print.
  const ends = printedDates(decodeHtml(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " "), true);
  // Plausibility marks over the whole document, so two tables of different chunks are compared too.
  const records = screenRows(results.flatMap((r) => {
    rejected += r.rejected;
    return r.rows
      .filter((f) => {
        const k = `${f.locator.t}:${f.locator.r}:${f.locator.c}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .map((f) => ({
        document_id: id,
        ticker: doc.ticker,
        ...fixRowDates(f, ends),
        accn: doc.accn,
        doc: doc.source === "sec-exhibit" && !doc.rendition_path ? doc_ : null,
        document_kind: doc.kind,
        filed: doc.filed,
        method: "table",
        model: r.model,
      }));
  }));
  await supabaseAdmin.from("ir_kpi_facts").delete().eq("document_id", id).eq("method", "table");
  for (let i = 0; i < records.length; i += 500) {
    const { error: e } = await supabaseAdmin.from("ir_kpi_facts").insert(records.slice(i, i + 500) as never);
    if (e) throw new Error(e.message);
  }
  const usedModel = escalated ? `${model}+${opts.escalate}` : (results[0]?.model ?? model);
  await mark({
    extract_status: rejected ? `ok (${rejected} rejected)` : "ok",
    extract_facts: records.length,
    extract_model: usedModel,
    extract_usage: {
      ...usage,
      chunks: chunks.length,
      ...(opts.escalate ? { escalated } : {}),
      ...(opts.followUp ? { followUps } : {}),
      ...(second.parts ? { second } : {}),
      ...(credits ? { credits: +credits.toFixed(4) } : {}),
      ...(opts.quality ? { quality: true, effort: opts.effort ?? "low" } : {}),
    },
  });
  return { facts: records.length, rejected, usage, credits, escalated, followUps, second };
}

/** Claim the next document waiting for extraction (newest first). Safe under concurrent runners. */
export async function nextToExtract(opts: { ticker?: string; before?: string } = {}) {
  let q = supabaseAdmin
    .from("ir_documents")
    .select("id, ticker, title, filed")
    .is("extracted_at", null)
    .is("extract_status", null)
    .or("ext.in.(htm,html),rendition_path.like.%html")
    .in("kind", EXTRACTABLE_KINDS)
    .or("pages.is.null,pages.lte.90")
    .order("filed", { ascending: false, nullsFirst: false })
    .limit(12);
  if (opts.ticker) q = opts.ticker.includes(",") ? q.in("ticker", opts.ticker.split(",")) : q.eq("ticker", opts.ticker);
  const { data } = await q;
  for (const d of data ?? []) {
    const { data: claimed } = await supabaseAdmin.from("ir_documents").update({ extract_status: "working" }).eq("id", d.id).is("extract_status", null).select("id");
    if (claimed?.length) return d;
  }
  return null;
}
