import { createClient } from "@supabase/supabase-js";
import { chunkTables, EXTRACT_INSTRUCTIONS, EXTRACT_SCHEMA, factsFromModel, leadText, type ModelOutput } from "@/lib/ir/extract-core";
import { parseTables } from "@/lib/ir/tables";
import { openaiStructured } from "@/lib/openai.server";
import { buildIrSeries } from "@/lib/ir/kpis";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const [docId, ...models] = process.argv.slice(2);
const { data: doc } = await sb.from("ir_documents").select("*").eq("id", docId).single();
const { data: file } = await sb.storage.from("ir-documents").download(doc!.rendition_path || doc!.path);
const html = await file!.text();
const tables = parseTables(html);
const chunks = chunkTables(tables);
console.log(doc!.ticker, doc!.title, "chunks", chunks.length, "chars", chunks.reduce((n, c) => n + c.length, 0));
await Promise.all(models.map(async (spec) => {
  const [model, effort] = spec.split(":");
  const t0 = Date.now();
  try {
    const res = await Promise.all(chunks.map((c, i) => openaiStructured<ModelOutput>({ model, name: "ir_tables", instructions: EXTRACT_INSTRUCTIONS, input: `Company: ${doc!.ticker}. Document: ${doc!.title} filed ${doc!.filed}.\nOpening text: ${leadText(html)}\n\nTables (part ${i + 1} of ${chunks.length}):\n\n${c}`, schema: EXTRACT_SCHEMA as never, effort: (effort as never) || "low" })));
    const merged = { tables: res.flatMap((r) => r.data.tables) };
    const { rows, rejected } = factsFromModel(merged, tables, doc!.filed);
    const { series, checks } = buildIrSeries(rows.map((r) => ({ ...r, accn: null, doc: null, filed: doc!.filed })) as never);
    const bad = checks.filter((c) => !c.ok);
    const u = res.reduce((a, r) => [a[0] + r.usage.input_tokens, a[1] + r.usage.output_tokens], [0, 0]);
    console.log(spec.padEnd(22), `${((Date.now() - t0) / 1000).toFixed(0)}s`, "facts", rows.length, "rej", rejected, "series", series.length, `checks ${checks.length - bad.length}/${checks.length}`, "tok", u.join("/"), bad.slice(0, 3).map((b) => `${b.group}@${b.period} ${(b.sum / 1e6).toFixed(0)}≠${(b.total / 1e6).toFixed(0)}`).join("; "));
    await Bun.write(`/tmp/irb/${doc!.ticker}_${spec}.json`, JSON.stringify(rows.map((r) => [r.category, r.metric, r.breakdown, r.parent, r.label, r.is_total, r.months, r.period_end, r.value]), null, 0));
  } catch (e) { console.log(spec, "ERR", (e as Error).message.slice(0, 300)); }
}));
