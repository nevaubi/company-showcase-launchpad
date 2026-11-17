/**
 * Dry run of the text reader on a few companies' newest releases: prints what it would store, stores nothing.
 *   bun scripts/ir-prose-pilot.ts --tickers=COST,JPM,TSLA [--per=2] [--model=google/gemini-3.1-flash-lite]
 */
import { readIrProse } from "@/lib/ir/prose.server";
import { args, sb } from "./lib/supa";

const per = Number(args.per ?? 2);
let credits = 0;
for (const t of (args.tickers ?? "COST").split(",")) {
  const { data } = await sb.from("ir_documents").select("id, title, filed, kind").eq("ticker", t).in("ext", ["htm", "html"]).in("kind", ["press-release", "supplement", "other", "presentation", "data"]).not("extract_status", "is", null).order("filed", { ascending: false }).limit(per);
  for (const d of data ?? []) {
    const t0 = Date.now();
    const r = await readIrProse(d.id, { model: args.model ?? "google/gemini-3.1-flash-lite", dry: true });
    credits += r.credits;
    console.log(`\n## ${t} ${d.filed} ${d.kind} ${d.title} — ${r.facts} figures, ${r.duplicates} already in tables, ${r.rejected} rejected, ${r.credits.toFixed(3)} cr, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    for (const f of r.records as { label: string; value: number; unit: string; months: number; period_end: string; category: string; metric: string; locator: { q: string } }[])
      console.log(`  ${f.category}/${f.metric} ${f.label} = ${f.value} ${f.unit} (${f.months}m ${f.period_end})  «${f.locator.q.slice(0, 110)}»`);
  }
}
console.log(`\ntotal ${credits.toFixed(3)} credits`);
process.exit(0);
