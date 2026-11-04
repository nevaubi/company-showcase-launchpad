/**
 * Dry-run model comparison: re-reads already-extracted documents with a candidate model and compares
 * the cells it points at against the stored facts. Writes nothing to the database.
 *   bun scripts/ir-model-pilot.ts --model=gpt-6-luna [--n=40]
 */
import { chunkTables, EXTRACT_INSTRUCTIONS, EXTRACT_SCHEMA, factsFromModel, leadText, type ModelOutput } from "@/lib/ir/extract-core";
import { parseTables } from "@/lib/ir/tables";
import { openaiStructured } from "@/lib/openai.server";
import { pool } from "@/lib/ir/extract.server";
import { args, sb } from "./lib/supa";

const model = args.model ?? "gpt-6-luna";
const n = Number(args.n ?? 40);
const { data: docs } = await sb
  .from("ir_documents")
  .select("id, ticker, title, kind, exhibit, filed, path, rendition_path, extract_usage")
  .like("extract_status", "ok%")
  .gt("extract_facts", 10)
  .lt("extract_facts", 600)
  .order("extracted_at", { ascending: false })
  .limit(600);
const byTicker = new Map<string, (typeof docs)[number]>();
for (const d of docs ?? []) if (!byTicker.has(d.ticker)) byTicker.set(d.ticker, d);
const sample = [...byTicker.values()].slice(0, n);

const key = (f: { locator: { t: number; r: number; c: number } }) => `${f.locator.t}:${f.locator.r}:${f.locator.c}`;
let base = 0, cand = 0, both = 0, sameMetric = 0, sameTotal = 0, sameValue = 0, fails = 0;
let inTok = 0, outTok = 0, cacheTok = 0, baseIn = 0, baseOut = 0;
const started = Date.now();
await pool(sample, 8, async (d) => {
  try {
    const { data: file } = await sb.storage.from("ir-documents").download(d.rendition_path || d.path);
    const html = await file!.text();
    const tables = parseTables(html);
    const chunks = chunkTables(tables);
    const context = `Company: ${d.ticker}. Document: ${d.title} (${d.kind}${d.exhibit ? `, ${d.exhibit}` : ""}, filed ${d.filed ?? "unknown"}).\nOpening text: ${leadText(html)}`;
    const res = await pool(chunks, 4, (c, i) =>
      openaiStructured<ModelOutput>({ model, name: "ir_tables", instructions: EXTRACT_INSTRUCTIONS, input: `${context}\n\nTables (part ${i + 1} of ${chunks.length}):\n\n${c}`, schema: EXTRACT_SCHEMA as unknown as Record<string, unknown>, effort: (args.effort ?? "low") as "low" }),
    );
    const { rows } = factsFromModel({ tables: res.flatMap((r) => r.data.tables) }, tables, d.filed);
    for (const r of res) { inTok += r.usage.input_tokens; outTok += r.usage.output_tokens; cacheTok += r.usage.cached_tokens; }
    const u = d.extract_usage as { input_tokens?: number; output_tokens?: number } | null;
    baseIn += u?.input_tokens ?? 0; baseOut += u?.output_tokens ?? 0;
    const { data: stored } = await sb.from("ir_kpi_facts").select("metric, is_total, value, period_end, locator").eq("document_id", d.id).eq("method", "table");
    const s = new Map((stored ?? []).map((f) => [key(f as never), f]));
    const c = new Map(rows.map((f) => [key(f), f]));
    base += s.size; cand += c.size;
    let docBoth = 0;
    for (const [k, f] of c) {
      const o = s.get(k);
      if (!o) continue;
      both++; docBoth++;
      if (o.metric === f.metric) sameMetric++;
      if (o.is_total === f.is_total) sameTotal++;
      if (Number(o.value) === f.value && o.period_end === f.period_end) sameValue++;
    }
    console.log(`${d.ticker.padEnd(6)} stored ${String(s.size).padStart(4)}  ${model} ${String(c.size).padStart(4)}  overlap ${docBoth}`);
  } catch (e) {
    fails++;
    console.log(`${d.ticker} FAILED ${(e as Error).message.slice(0, 120)}`);
  }
});
console.log(JSON.stringify({ model, docs: sample.length, fails, stored: base, candidate: cand, overlap: both,
  recall: +(both / base).toFixed(3), precision: +(both / cand).toFixed(3),
  sameMetric: +(sameMetric / both).toFixed(3), sameTotalFlag: +(sameTotal / both).toFixed(3), sameValueAndPeriod: +(sameValue / both).toFixed(3),
  tokens: { inTok, cacheTok, outTok }, baselineTokens: { baseIn, baseOut }, seconds: Math.round((Date.now() - started) / 1000) }, null, 1));
process.exit(0);
