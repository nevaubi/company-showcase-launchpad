// Extract segment / product / geography / cost / KPI facts from a stored IR document.
// Uses the owner's OpenAI key when configured (bulk IR analysis), otherwise the Lovable AI Gateway.
// The model only points at cells; values are re-read from the parsed table in factsFromModel().
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { structured } from "@/lib/ai.server";
import { chunkTables, EXTRACT_INSTRUCTIONS, EXTRACT_SCHEMA, factsFromModel, leadText, type ModelOutput } from "@/lib/ir/extract-core";
import { parseTables } from "@/lib/ir/tables";
import { hasOpenAIKey, IR_MODELS, openaiStructured, type Usage } from "@/lib/openai.server";

/** Kinds that carry numeric tables worth reading. */
export const EXTRACTABLE_KINDS = ["press-release", "supplement", "presentation", "data", "other"];

async function runChunk(input: string, model: string): Promise<{ out: ModelOutput; usage: Usage; model: string }> {
  if (hasOpenAIKey()) {
    const r = await openaiStructured<ModelOutput>({
      model,
      name: "ir_tables",
      instructions: EXTRACT_INSTRUCTIONS,
      input,
      schema: EXTRACT_SCHEMA as unknown as Record<string, unknown>,
      effort: "low",
    });
    return { out: r.data, usage: r.usage, model: r.model };
  }
  const out = await structured<ModelOutput>({
    name: "ir_tables",
    instructions: EXTRACT_INSTRUCTIONS,
    input,
    schema: EXTRACT_SCHEMA as unknown as Record<string, unknown>,
    effort: "low",
  });
  return { out, usage: { input_tokens: 0, output_tokens: 0, cached_tokens: 0 }, model: "lovable-gateway" };
}

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

export async function extractIrDocument(id: string, opts: { model?: string; concurrency?: number } = {}) {
  const { data: doc } = await supabaseAdmin.from("ir_documents").select("*").eq("id", id).maybeSingle();
  if (!doc?.path) throw new Error("Document not stored");
  const { data: file, error } = await supabaseAdmin.storage.from("ir-documents").download(doc.rendition_path || doc.path);
  if (error || !file) throw new Error(error?.message ?? "Download failed");
  const html = await file.text();
  const tables = parseTables(html);
  const chunks = chunkTables(tables);
  const mark = (patch: Record<string, unknown>) => supabaseAdmin.from("ir_documents").update({ extracted_at: new Date().toISOString(), ...patch }).eq("id", id);
  if (!chunks.length) {
    await mark({ extract_status: "no tables", extract_facts: 0 });
    return { facts: 0, rejected: 0, usage: null };
  }
  const model = opts.model ?? IR_MODELS.extract;
  const context = `Company: ${doc.ticker}. Document: ${doc.title} (${doc.kind}${doc.exhibit ? `, ${doc.exhibit}` : ""}, filed ${doc.filed ?? "unknown"}).\nOpening text: ${leadText(html)}`;
  const results = await pool(chunks, opts.concurrency ?? 4, (c, i) => runChunk(`${context}\n\nTables (part ${i + 1} of ${chunks.length}):\n\n${c}`, model));
  const merged: ModelOutput = { tables: results.flatMap((r) => r.out.tables) };
  const usage = results.reduce((u, r) => ({ input_tokens: u.input_tokens + r.usage.input_tokens, output_tokens: u.output_tokens + r.usage.output_tokens, cached_tokens: u.cached_tokens + r.usage.cached_tokens }), {
    input_tokens: 0,
    output_tokens: 0,
    cached_tokens: 0,
  });
  const { rows, rejected } = factsFromModel(merged, tables, doc.filed);
  const doc_ = doc.source_url.split("/").pop() ?? null;
  const records = rows.map((f) => ({
    document_id: id,
    ticker: doc.ticker,
    ...f,
    accn: doc.accn,
    doc: doc.source === "sec-exhibit" && !doc.rendition_path ? doc_ : null,
    document_kind: doc.kind,
    filed: doc.filed,
    method: "table",
    model: results[0]?.model ?? model,
  }));
  await supabaseAdmin.from("ir_kpi_facts").delete().eq("document_id", id).eq("method", "table");
  for (let i = 0; i < records.length; i += 500) {
    const { error: e } = await supabaseAdmin.from("ir_kpi_facts").insert(records.slice(i, i + 500) as never);
    if (e) throw new Error(e.message);
  }
  await mark({
    extract_status: rejected ? `ok (${rejected} rejected)` : "ok",
    extract_facts: records.length,
    extract_model: results[0]?.model ?? model,
    extract_usage: { ...usage, chunks: chunks.length },
  });
  return { facts: records.length, rejected, usage };
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
  if (opts.ticker) q = q.eq("ticker", opts.ticker);
  const { data } = await q;
  for (const d of data ?? []) {
    const { data: claimed } = await supabaseAdmin.from("ir_documents").update({ extract_status: "working" }).eq("id", d.id).is("extract_status", null).select("id");
    if (claimed?.length) return d;
  }
  return null;
}
