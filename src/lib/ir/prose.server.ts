// Read the figures stated in the running text of a stored IR document (see prose-core.ts).
// Runs only in bounded batch scripts (scripts/ir-prose.ts, the deep build); page views never call it.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { structured } from "@/lib/ai.server";
import { EXTRACTABLE_KINDS, pool } from "@/lib/ir/extract.server";
import { crossCheck, dropTableDuplicates, PROSE_INSTRUCTIONS, PROSE_SCHEMA, proseBlocks, proseChunks, proseFacts, proseTokens, renderProse, type ProseFact, type ProseOutput } from "@/lib/ir/prose-core";
import { fixRowDates, printedDates } from "@/lib/ir/dates";
import { decodeHtml } from "@/lib/ir/tables";
import { laneStructured } from "@/lib/ir/openai-lane.server";
import { estimateCredits, hasOpenAIKey, IR_MODELS, OpenAIError, openaiStructured, type Usage } from "@/lib/openai.server";

const ZERO: Usage = { input_tokens: 0, output_tokens: 0, cached_tokens: 0 };
const addUsage = (a: Usage, b: Usage): Usage => ({ input_tokens: a.input_tokens + b.input_tokens, output_tokens: a.output_tokens + b.output_tokens, cached_tokens: a.cached_tokens + b.cached_tokens });

async function ask(input: string, model: string): Promise<{ out: ProseOutput; usage: Usage; model: string }> {
  if (hasOpenAIKey()) {
    const r = await openaiStructured<ProseOutput>({ model, name: "ir_prose", instructions: PROSE_INSTRUCTIONS, input, schema: PROSE_SCHEMA as unknown as Record<string, unknown>, effort: "low" });
    return { out: r.data, usage: r.usage, model: r.model };
  }
  const out = await structured<ProseOutput>({ name: "ir_prose", instructions: PROSE_INSTRUCTIONS, input, schema: PROSE_SCHEMA as unknown as Record<string, unknown>, effort: "low" });
  return { out, usage: ZERO, model: "lovable-gateway" };
}

/** Text documents the prose reader covers: HTML releases, supplements and letters (PDF text sits in the page tables). */
const proseDoc = (d: { ext: string | null }) => ["htm", "html"].includes(d.ext ?? "");

/**
 * Read one document's text. Facts the document also prints in a table (same period and value) are
 * left to the table reader; the rest are stored with method "text" and cite their sentence.
 */
export async function readIrProse(id: string, opts: { model?: string; concurrency?: number; chunkChars?: number; /** read and return, store nothing (pilots) */ dry?: boolean; /** false = skip the OpenAI second reader */ second?: boolean } = {}) {
  const { data: doc } = await supabaseAdmin.from("ir_documents").select("*").eq("id", id).maybeSingle();
  if (!doc?.path) throw new Error("Document not stored");
  const mark = (patch: Record<string, unknown>) => (opts.dry ? Promise.resolve() : supabaseAdmin.from("ir_documents").update({ prose_at: new Date().toISOString(), ...patch }).eq("id", id));
  if (!proseDoc(doc)) {
    await mark({ prose_status: "skipped:not html", prose_facts: 0 });
    return { facts: 0, rejected: 0, duplicates: 0, usage: null as Usage | null, credits: 0, records: [] as unknown[] };
  }
  const { data: file, error } = await supabaseAdmin.storage.from("ir-documents").download(doc.path);
  if (error || !file) throw new Error(error?.message ?? "Download failed");
  const html = await file.text();
  const blocks = proseBlocks(html);
  const ends = printedDates(decodeHtml(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " "), true);
  const tokens = proseTokens(blocks, 1500);
  const chunks = proseChunks(blocks, tokens, opts.chunkChars ?? 14_000);
  if (!chunks.length) {
    await mark({ prose_status: "no text figures", prose_facts: 0 });
    return { facts: 0, rejected: 0, duplicates: 0, usage: null, credits: 0, records: [] as unknown[] };
  }
  const model = opts.model ?? IR_MODELS.extract;
  const context = `Company: ${doc.ticker}. Document: ${doc.title} (${doc.kind}${doc.exhibit ? `, ${doc.exhibit}` : ""}, filed ${doc.filed ?? "unknown"}).`;
  let usage = ZERO;
  let credits = 0;
  let rejected = 0;
  let unreadable = 0;
  let agreed = 0;
  let conflicts = 0;
  let added = 0;
  let checked = 0;
  const droppedLog: string[] = [];
  const reads = await pool(chunks, opts.concurrency ?? 3, async (c, i) => {
    try {
      const input = `${context}\n\nText (part ${i + 1} of ${chunks.length}):\n\n${renderProse(c.blocks, c.tokens)}`;
      // The second reader (owner's free OpenAI allowance) reads the same numbered text in parallel.
      const [r, second] = await Promise.all([
        ask(input, model),
        opts.second === false ? null : laneStructured<ProseOutput>({ name: "ir_prose", instructions: PROSE_INSTRUCTIONS, input, schema: PROSE_SCHEMA as unknown as Record<string, unknown> }),
      ]);
      usage = addUsage(usage, r.usage);
      credits += estimateCredits(model, r.usage) ?? 0;
      const got = proseFacts(r.out, c.blocks, c.tokens, doc.filed);
      rejected += got.rejected;
      if (!second) return got.rows.map((f) => ({ ...f, model: r.model }));
      checked++;
      const other = proseFacts(second.data, c.blocks, c.tokens, doc.filed);
      const x = crossCheck(got.rows, other.rows);
      agreed += x.agreed;
      conflicts += x.conflicts;
      added += x.secondOnly.length;
      if (opts.dry) for (const d of x.dropped) droppedLog.push(`${d.f.label} = ${d.f.value} (${d.f.months}m ${d.f.period_end}) vs ${d.other.map((o) => `${o.label} (${o.months}m ${o.period_end})`).join(" / ")}`);
      return x.rows.map((f) => ({ ...f, model: x.both.has(f) ? `${r.model}+${second.model}` : r.model }));
    } catch (e) {
      // An unusable answer for one part loses that part only.
      if (e instanceof OpenAIError && e.kind === "rejected") {
        usage = addUsage(usage, e.usage ?? ZERO);
        unreadable++;
        return [] as (ProseFact & { model: string })[];
      }
      throw e;
    }
  });
  // Every part came back unusable: nothing was read, so the document isn't done (the runner retries it).
  if (unreadable && unreadable === chunks.length) throw new Error(`no usable answer for any of ${chunks.length} parts`);
  // Same-day documents (the release, its supplement and deck) print the same figures in their tables.
  // A failed lookup must not pass for "no tables": the document would store figures its tables already hold.
  const sib = doc.filed ? await supabaseAdmin.from("ir_documents").select("id").eq("ticker", doc.ticker).eq("filed", doc.filed).limit(50) : { data: [], error: null };
  if (sib.error) throw new Error(`sibling lookup failed: ${sib.error.message}`);
  const ids = [...new Set([id, ...(sib.data ?? []).map((d) => d.id)])];
  const { data: existing, error: exErr } = await supabaseAdmin.from("ir_kpi_facts").select("period_end, months, value, unit").in("document_id", ids).neq("method", "text").limit(50_000);
  if (exErr) throw new Error(`table figures lookup failed: ${exErr.message}`);
  const all = reads.flat();
  const printed = (existing ?? []).flatMap((e) => (e.period_end && e.months != null ? [{ period_end: e.period_end, months: e.months, value: e.value, unit: e.unit }] : []));
  const kept = dropTableDuplicates(all, printed);
  const records = kept.map(({ tol: _tol, ...f }) => ({
    document_id: id,
    ticker: doc.ticker,
    ...fixRowDates(f, ends),
    accn: doc.accn,
    doc: null,
    document_kind: doc.kind,
    filed: doc.filed,
    method: "text",
  }));
  const check = checked ? { checked, parts: chunks.length, agreed, conflicts, secondOnly: added, dropped: droppedLog } : null;
  if (opts.dry) return { facts: records.length, rejected, duplicates: all.length - kept.length, usage, credits, records, check };
  await supabaseAdmin.from("ir_kpi_facts").delete().eq("document_id", id).eq("method", "text");
  for (let i = 0; i < records.length; i += 500) {
    const { error: e } = await supabaseAdmin.from("ir_kpi_facts").insert(records.slice(i, i + 500) as never);
    if (e) throw new Error(e.message);
  }
  const checkNote = check ? `, cross-checked ${checked}/${chunks.length} parts: ${agreed} agreed, ${conflicts} dropped` : "";
  await mark({ prose_status: `${unreadable ? `partial (${unreadable} of ${chunks.length} parts unreadable)` : rejected ? `ok (${rejected} rejected)` : "ok"}${checkNote}`, prose_facts: records.length });
  return { facts: records.length, rejected, duplicates: all.length - kept.length, usage, credits, records: [] as unknown[], check };
}

/** Claim the next document whose text hasn't been read (newest first). Safe under concurrent runners. */
export async function nextForProse(opts: { ticker?: string } = {}) {
  let q = supabaseAdmin
    .from("ir_documents")
    .select("id, ticker, title, filed")
    .is("prose_status", null)
    .in("ext", ["htm", "html"])
    .in("kind", EXTRACTABLE_KINDS)
    .not("path", "is", null)
    // The table reader goes first, so sentences repeating a table cell are recognised.
    .not("extract_status", "is", null)
    .neq("extract_status", "working")
    .order("filed", { ascending: false, nullsFirst: false })
    .limit(12);
  if (opts.ticker) q = opts.ticker.includes(",") ? q.in("ticker", opts.ticker.split(",")) : q.eq("ticker", opts.ticker);
  const { data } = await q;
  for (const d of data ?? []) {
    // prose_at holds the claim time while working, so only abandoned claims are ever re-queued.
    const { data: claimed } = await supabaseAdmin.from("ir_documents").update({ prose_status: "working", prose_at: new Date().toISOString() }).eq("id", d.id).is("prose_status", null).select("id");
    if (claimed?.length) return d;
  }
  return null;
}

/** Re-queue documents a crashed reader left claimed (claims older than 30 minutes; a document takes seconds). */
export async function resetStaleProse(tickers?: string[]) {
  let q = supabaseAdmin
    .from("ir_documents")
    .update({ prose_status: null, prose_at: null })
    .eq("prose_status", "working")
    .or(`prose_at.is.null,prose_at.lt.${new Date(Date.now() - 30 * 60_000).toISOString()}`);
  if (tickers?.length) q = q.in("ticker", tickers);
  return q;
}
