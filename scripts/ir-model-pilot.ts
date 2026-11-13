/**
 * Dry-run model comparison: re-reads already-extracted documents with a candidate model and compares
 * the cells it points at against the stored facts. Writes nothing to the database.
 *   bun scripts/ir-model-pilot.ts --model=gpt-6-luna [--n=40] [--effort=low] [--quality] [--loop] [--chunk=16000] [--escalate=<model>] [--offset=0]
 */
import { chunkTables, leadText } from "@/lib/ir/extract-core";
import { parseTables } from "@/lib/ir/tables";
import type { Effort } from "@/lib/openai.server";
import { pool, readChunk } from "@/lib/ir/extract.server";
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
const sample = [...byTicker.values()].slice(Number(args.offset ?? 0), Number(args.offset ?? 0) + n);
let credits = 0, escalations = 0, reviews = 0;
const dump: unknown[] = [];

const key = (f: { locator: { t: number; r: number; c: number } }) => `${f.locator.t}:${f.locator.r}:${f.locator.c}`;
let base = 0, cand = 0, both = 0, sameMetric = 0, sameTotal = 0, sameValue = 0, fails = 0;
let inTok = 0, outTok = 0, cacheTok = 0, baseIn = 0, baseOut = 0;
const started = Date.now();
await pool(sample, 8, async (d) => {
  try {
    const { data: file } = await sb.storage.from("ir-documents").download(d.rendition_path || d.path);
    const html = await file!.text();
    const tables = parseTables(html);
    const chunks = chunkTables(tables, args.chunk ? Number(args.chunk) : undefined);
    const context = `Company: ${d.ticker}. Document: ${d.title} (${d.kind}${d.exhibit ? `, ${d.exhibit}` : ""}, filed ${d.filed ?? "unknown"}).\nOpening text: ${leadText(html)}`;
    const res = await pool(chunks, 4, (c, i) =>
      readChunk({ input: `${context}\n\nTables (part ${i + 1} of ${chunks.length}):\n\n${c}`, chunk: c, tables, filed: d.filed, model, quality: args.quality !== undefined, effort: (args.effort ?? "low") as Effort, escalate: args.escalate, followUp: args.loop !== undefined }),
    );
    const rows = res.flatMap((r) => r.rows);
    for (const r of res) { credits += r.credits; inTok += r.usage.input_tokens; outTok += r.usage.output_tokens; cacheTok += r.usage.cached_tokens; escalations += r.escalated ? 1 : 0; reviews += r.followUp ? 1 : 0; }
    const u = d.extract_usage as { input_tokens?: number; output_tokens?: number } | null;
    baseIn += u?.input_tokens ?? 0; baseOut += u?.output_tokens ?? 0;
    const { data: stored } = await sb.from("ir_kpi_facts").select("metric, is_total, value, period_end, months, label, locator").eq("document_id", d.id).eq("method", "table");
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
      else if (args.dump) dump.push({ kind: "differs", ticker: d.ticker, doc: d.title, cell: k, header: tables[f.locator.t]?.rows.slice(0, 4).map((r) => r.join(" | ")), row: tables[f.locator.t]?.rows[f.locator.r]?.join(" | "), stored: { label: o.label, period_end: o.period_end, months: o.months, value: o.value }, candidate: { label: f.label, period_end: f.period_end, months: f.months, value: f.value } });
    }
    if (args.dump) {
      for (const [k, f] of c) if (!s.has(k)) dump.push({ kind: "extra", ticker: d.ticker, cell: k, row: tables[f.locator.t]?.rows[f.locator.r]?.join(" | ").slice(0, 200), candidate: { label: f.label, metric: f.metric, period_end: f.period_end, value: f.value } });
      for (const [k, o] of s) if (!c.has(k)) dump.push({ kind: "missed", ticker: d.ticker, cell: k, stored: { label: o.label, metric: o.metric, period_end: o.period_end, value: o.value } });
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
  effort: args.effort ?? "low", quality: args.quality !== undefined, chunk: args.chunk ?? 40000, loop: args.loop !== undefined, escalate: args.escalate ?? null, escalations, reviews, credits: +credits.toFixed(3), tokens: { inTok, cacheTok, outTok }, baselineTokens: { baseIn, baseOut }, seconds: Math.round((Date.now() - started) / 1000) }, null, 1));
if (args.dump) (await import("node:fs")).writeFileSync(args.dump, JSON.stringify(dump, null, 1));
process.exit(0);
