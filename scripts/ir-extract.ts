/**
 * Bulk IR table extraction with the owner's OpenAI key.
 *   bun scripts/ir-extract.ts [--concurrency=16] [--chunk-concurrency=6] [--max=5000] [--ticker=AAPL[,MSFT]] [--model=gpt-6.1-sol] [--watch --idle=30] [--resume] [--force]
 *                             [--quality] [--effort=low|medium|high] [--escalate=openai/gpt-6-luna] [--loop] [--chunk=16000] [--max-credits=50] [--spend-file=/tmp/x.json]
 *
 * --quality adds the reading checklist (src/lib/ir/extract-quality.ts); --escalate re-reads failed
 * or invalid parts with a second model; --loop adds one review turn for numeric rows left out;
 * --chunk sets the prompt size per part (smaller parts are read more thoroughly); --max-credits pauses the job once this run's estimated
 * gateway credits pass the cap.
 *
 * Bounded, single-flight, idempotent, with a circuit breaker — see scripts/lib/runner.ts.
 * --force takes over a lease left by a crashed runner; never use it while another runner is alive.
 */
import { extractIrDocument, nextToExtract } from "@/lib/ir/extract.server";
import type { Effort } from "@/lib/openai.server";
import { args, sb } from "./lib/supa";
import { runBatch } from "./lib/runner";

const model = args.model;
await runBatch({
  job: "ir-extract-runner",
  max: Number(args.max ?? 5000),
  concurrency: Number(args.concurrency ?? 16),
  idleMinutes: args.watch !== undefined ? Number(args.idle ?? 30) : undefined,
  maxCredits: args["max-credits"] ? Number(args["max-credits"]) : undefined,
  spendFile: args["spend-file"],
  claim: async () => {
    const d = await nextToExtract(args.ticker ? { ticker: args.ticker } : {});
    return d ? { ...d, label: `${d.filed ?? ""} ${d.title}` } : null;
  },
  release: (d, status) => sb.from("ir_documents").update({ extract_status: status, extracted_at: status ? new Date().toISOString() : null }).eq("id", d.id),
  reset: () => sb.from("ir_documents").update({ extract_status: null }).eq("extract_status", "working"),
  process: async (d) => {
    // Parts of one file read in parallel: long 2010s releases have 10+ table chunks.
    const r = await extractIrDocument(d.id, {
      model,
      concurrency: Number(args["chunk-concurrency"] ?? 6),
      quality: args.quality !== undefined,
      effort: args.effort as Effort | undefined,
      escalate: args.escalate,
      followUp: args.loop !== undefined,
      chunkChars: args.chunk ? Number(args.chunk) : undefined,
    });
    const note = [r.rejected ? `(${r.rejected} rej)` : "", r.escalated ? `${r.escalated} escalated` : "", r.followUps ? `${r.followUps} reviewed` : "", r.credits ? `${r.credits.toFixed(3)} cr` : ""].filter(Boolean).join(" ");
    return { facts: r.facts, note: note || undefined, usage: r.usage ? { ...r.usage, credits: r.credits } : null };
  },
});
process.exit(0);
