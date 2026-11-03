/**
 * Bulk IR table extraction with the owner's OpenAI key.
 *   bun scripts/ir-extract.ts [--concurrency=16] [--max=5000] [--ticker=AAPL] [--model=gpt-6.1-sol] [--watch --idle=30] [--resume] [--force]
 *
 * Bounded, single-flight, idempotent, with a circuit breaker — see scripts/lib/runner.ts.
 * --force takes over a lease left by a crashed runner; never use it while another runner is alive.
 */
import { extractIrDocument, nextToExtract } from "@/lib/ir/extract.server";
import { args, sb } from "./lib/supa";
import { runBatch } from "./lib/runner";

const model = args.model;
await runBatch({
  job: "ir-extract-runner",
  max: Number(args.max ?? 5000),
  concurrency: Number(args.concurrency ?? 16),
  idleMinutes: args.watch !== undefined ? Number(args.idle ?? 30) : undefined,
  claim: async () => {
    const d = await nextToExtract(args.ticker ? { ticker: args.ticker } : {});
    return d ? { ...d, label: `${d.filed ?? ""} ${d.title}` } : null;
  },
  release: (d, status) => sb.from("ir_documents").update({ extract_status: status, extracted_at: status ? new Date().toISOString() : null }).eq("id", d.id),
  reset: () => sb.from("ir_documents").update({ extract_status: null }).eq("extract_status", "working"),
  process: async (d) => {
    const r = await extractIrDocument(d.id, { model, concurrency: 4 });
    return { facts: r.facts, note: r.rejected ? `(${r.rejected} rej)` : undefined, usage: r.usage };
  },
});
process.exit(0);
