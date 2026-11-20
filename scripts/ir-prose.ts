/**
 * Read the figures stated in the running text of stored IR documents (src/lib/ir/prose-core.ts):
 * store counts, memberships, deliveries, backlog, per-segment amounts written in sentences.
 *   bun scripts/ir-prose.ts [--ticker=COST[,WMT]] [--model=google/gemini-3.1-flash-lite] [--concurrency=12]
 *                           [--max=5000] [--chunk=14000] [--max-credits=20] [--spend-file=/tmp/x.json] [--resume] [--force]
 *
 * Documents are read after their tables (sentences repeating a table cell are dropped), newest first.
 * Bounded, single-flight, idempotent, with a circuit breaker — see scripts/lib/runner.ts.
 */
import { nextForProse, readIrProse, resetStaleProse } from "@/lib/ir/prose.server";
import { routeOf } from "@/lib/jobs/provider-health";
import { IR_MODELS } from "@/lib/openai.server";
import { args, sb } from "./lib/supa";
import { runBatch } from "./lib/runner";
import { loadTop } from "./lib/rank";

// The global sweep (no --ticker) serves the top 1,000 by dv20 first; every fifth claim takes the
// newest document of any company, so the tail is still read while the top has a queue.
const top = args.ticker ? null : [...(await loadTop())];
let claims = 0;
async function claimNext() {
  if (args.ticker) return nextForProse({ ticker: args.ticker });
  claims++;
  if (top?.length && claims % 5 !== 0) {
    const d = await nextForProse({ ticker: top.join(",") });
    if (d) return d;
  }
  return nextForProse({});
}

await runBatch({
  job: args.ticker ? `ir-prose-runner:${args.ticker}` : "ir-prose-runner",
  max: Number(args.max ?? 5000),
  concurrency: Number(args.concurrency ?? 12),
  maxCredits: args["max-credits"] ? Number(args["max-credits"]) : undefined,
  spendFile: args["spend-file"],
  // Text reads fall back to the free mini lane when the main route is out.
  route: [...routeOf(args.model ?? IR_MODELS.extract, process.env), "openai-free-mini"],
  claim: async () => {
    const d = await claimNext();
    return d ? { ...d, label: `${d.filed ?? ""} ${d.title}` } : null;
  },
  release: (d, status) => sb.from("ir_documents").update({ prose_status: status, prose_at: status ? new Date().toISOString() : null }).eq("id", d.id),
  // The company runs and the background sweep share the queue: only abandoned claims are re-queued.
  reset: () => resetStaleProse(args.ticker?.split(",")),
  process: async (d) => {
    const r = await readIrProse(d.id, { model: args.model, concurrency: 3, chunkChars: args.chunk ? Number(args.chunk) : undefined });
    const note = [r.check ? `checked ${r.check.agreed}✓ ${r.check.conflicts}✗` : "", r.duplicates ? `${r.duplicates} in tables` : "", r.rejected ? `(${r.rejected} rej)` : "", r.credits ? `${r.credits.toFixed(3)} cr` : ""].filter(Boolean).join(" ");
    return { facts: r.facts, note: note || undefined, usage: r.usage ? { ...r.usage, credits: r.credits } : null };
  },
});
process.exit(0);
