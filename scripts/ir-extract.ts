/**
 * Bulk IR table extraction with the owner's OpenAI key.
 *   bun scripts/ir-extract.ts [--concurrency=16] [--max=5000] [--ticker=AAPL] [--model=gpt-6.1-sol] [--resume]
 *
 * Safety rails (background-job rules):
 *  - bounded: stops after --max documents even if work remains
 *  - single-flight: a lease row in job_state ("ir-extract-runner") — a second runner exits
 *  - idempotent: each document is claimed (extract_status = 'working') and marked done in the same step
 *  - circuit breaker: auth/quota errors pause the pipeline (job_state.paused_reason) and stop every worker;
 *    repeated rate limits shrink concurrency and back off
 *  - paused guard: the runner refuses to start while paused unless --resume is given
 */
import { extractIrDocument, nextToExtract } from "@/lib/ir/extract.server";
import { OpenAIError } from "@/lib/openai.server";
import { args, log, sb, sleep } from "./lib/supa";

const JOB = "ir-extract-runner";
const owner = `${process.pid}-${Date.now()}`;
const max = Number(args.max ?? 5000);
let concurrency = Number(args.concurrency ?? 16);
const model = args.model;

const { data: state } = await sb.from("job_state").select("*").eq("job", JOB).maybeSingle();
if (state?.paused_reason && args.resume === undefined) {
  log(`paused: ${state.paused_reason} — rerun with --resume once fixed`);
  process.exit(0);
}
if (state?.lease_until && new Date(state.lease_until) > new Date() && args.force === undefined) {
  log(`another runner holds the lease until ${state.lease_until}`);
  process.exit(0);
}
const renew = () => sb.from("job_state").upsert({ job: JOB, cursor: 0, paused_reason: null, lease_until: new Date(Date.now() + 3 * 60_000).toISOString(), updated_at: new Date().toISOString() });
await renew();
const leaseTimer = setInterval(renew, 60_000);

let done = 0;
let facts = 0;
let tokensIn = 0;
let tokensOut = 0;
let stop: string | null = null;
let rateHits = 0;
let active = 0;
let lastWork = Date.now();

// Single-flight lease held: documents left "working" by a crashed runner go back in the queue.
await sb.from("ir_documents").update({ extract_status: null }).eq("extract_status", "working");

async function release(id: string, status: string | null) {
  await sb.from("ir_documents").update({ extract_status: status, extracted_at: status ? new Date().toISOString() : null }).eq("id", id);
}

async function worker(n: number) {
  while (!stop && done < max) {
    if (n >= concurrency) {
      await sleep(5000);
      continue;
    }
    const next = await nextToExtract(args.ticker ? { ticker: args.ticker } : {});
    if (!next) {
      // --watch keeps polling while the collector and rendition jobs add documents.
      if (args.watch === undefined && active === 0) return;
      if (Date.now() - lastWork > Number(args.idle ?? 30) * 60_000) return;
      await sleep(30_000);
      continue;
    }
    lastWork = Date.now();
    active++;
    const t0 = Date.now();
    try {
      const r = await extractIrDocument(next.id, { model, concurrency: 4 });
      done++;
      facts += r.facts;
      tokensIn += r.usage?.input_tokens ?? 0;
      tokensOut += r.usage?.output_tokens ?? 0;
      rateHits = Math.max(0, rateHits - 1);
      log(`${next.ticker.padEnd(5)} ${String(next.filed ?? "").padEnd(10)} ${String(r.facts).padStart(4)} facts ${r.rejected ? `(${r.rejected} rej) ` : ""}${((Date.now() - t0) / 1000).toFixed(0)}s  ${next.title.slice(0, 50)}`);
    } catch (e) {
      const err = e as Error;
      if (err instanceof OpenAIError && (err.kind === "auth" || err.kind === "quota")) {
        stop = `${err.kind}: ${err.message.slice(0, 200)}`;
        await release(next.id, null);
        await sb.from("job_state").upsert({ job: JOB, cursor: 0, paused_reason: stop, lease_until: null, updated_at: new Date().toISOString() });
      } else if (err instanceof OpenAIError && (err.kind === "rate" || err.kind === "transient")) {
        await release(next.id, null);
        rateHits++;
        if (rateHits > 3 && concurrency > 2) {
          concurrency = Math.max(2, Math.floor(concurrency * 0.7));
          rateHits = 0;
          log(`rate limited — concurrency now ${concurrency}`);
        }
        await sleep(err.retryAfterMs ?? 15_000 + Math.random() * 15_000);
      } else {
        await release(next.id, `error: ${err.message.slice(0, 200)}`);
        log(`${next.ticker} error: ${err.message.slice(0, 160)}`);
      }
    } finally {
      active--;
    }
  }
}

const stats = setInterval(() => log(`— ${done} docs, ${facts} facts, ${(tokensIn / 1e6).toFixed(2)}M in / ${(tokensOut / 1e6).toFixed(2)}M out tokens, concurrency ${concurrency}`), 120_000);
await Promise.all(Array.from({ length: Number(args.concurrency ?? 16) }, (_, i) => worker(i)));
clearInterval(stats);
clearInterval(leaseTimer);
await sb.from("job_state").upsert({ job: JOB, cursor: 0, paused_reason: stop, lease_until: null, updated_at: new Date().toISOString() });
log(stop ? `STOPPED — ${stop}` : `finished — ${done} docs, ${facts} facts, ${(tokensIn / 1e6).toFixed(2)}M in / ${(tokensOut / 1e6).toFixed(2)}M out tokens`);
process.exit(0);
