/**
 * Bounded, single-flight batch runner shared by the IR pipeline scripts.
 *  - bounded: at most `max` items are claimed (slots are reserved before claiming, so concurrent
 *    workers can't overshoot)
 *  - single-flight: a lease row in job_state; a second runner exits while the lease is live
 *  - idempotent: `claim` marks an item as taken in the database; `reset` re-queues items left
 *    half-done by a crashed runner (only after this runner holds the lease)
 *  - circuit breaker: auth/quota errors pause the job (job_state.paused_reason) and stop all workers;
 *    rate limits shrink concurrency and back off
 *  - paused guard: refuses to start while paused unless --resume is given
 */
import { OpenAIError } from "@/lib/openai.server";
import { args, log, sb, sleep } from "./supa";

export interface RunnerItem {
  id: string;
  ticker: string;
  label: string;
}

export interface RunnerOpts<T extends RunnerItem> {
  job: string;
  max: number;
  concurrency: number;
  claim: () => Promise<T | null>;
  release: (item: T, status: string | null) => Promise<unknown>;
  reset: () => Promise<unknown>;
  process: (item: T) => Promise<{ facts: number; note?: string; usage?: { input_tokens: number; output_tokens: number } | null }>;
  /** keep polling for new work for this many minutes after the queue empties */
  idleMinutes?: number;
}

export async function runBatch<T extends RunnerItem>(o: RunnerOpts<T>) {
  const { data: state } = await sb.from("job_state").select("*").eq("job", o.job).maybeSingle();
  if (state?.paused_reason && args.resume === undefined) {
    log(`${o.job} paused: ${state.paused_reason} — rerun with --resume once fixed`);
    return;
  }
  if (state?.lease_until && new Date(state.lease_until) > new Date() && args.force === undefined) {
    log(`${o.job}: another runner holds the lease until ${state.lease_until}`);
    return;
  }
  const renew = () => sb.from("job_state").upsert({ job: o.job, cursor: 0, paused_reason: null, lease_until: new Date(Date.now() + 3 * 60_000).toISOString(), updated_at: new Date().toISOString() });
  await renew();
  const leaseTimer = setInterval(renew, 60_000);
  await o.reset();

  let reserved = 0;
  let done = 0;
  let facts = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let stop: string | null = null;
  let rateHits = 0;
  let active = 0;
  let concurrency = o.concurrency;
  let lastWork = Date.now();

  const worker = async (n: number) => {
    while (!stop && reserved < o.max) {
      if (n >= concurrency) {
        await sleep(5000);
        continue;
      }
      reserved++;
      const item = await o.claim();
      if (!item) {
        reserved--;
        if (o.idleMinutes == null && active === 0) return;
        if (Date.now() - lastWork > (o.idleMinutes ?? 0) * 60_000 && active === 0) return;
        await sleep(30_000);
        continue;
      }
      lastWork = Date.now();
      active++;
      const t0 = Date.now();
      try {
        const r = await o.process(item);
        done++;
        facts += r.facts;
        tokensIn += r.usage?.input_tokens ?? 0;
        tokensOut += r.usage?.output_tokens ?? 0;
        rateHits = Math.max(0, rateHits - 1);
        log(`${item.ticker.padEnd(5)} ${String(r.facts).padStart(4)} facts ${r.note ? `${r.note} ` : ""}${((Date.now() - t0) / 1000).toFixed(0)}s  ${item.label.slice(0, 60)}`);
      } catch (e) {
        const err = e as Error;
        if (err instanceof OpenAIError && (err.kind === "auth" || err.kind === "quota")) {
          stop = `${err.kind}: ${err.message.slice(0, 200)}`;
          await o.release(item, null);
          await sb.from("job_state").upsert({ job: o.job, cursor: 0, paused_reason: stop, lease_until: null, updated_at: new Date().toISOString() });
        } else if (err instanceof OpenAIError && (err.kind === "rate" || err.kind === "transient")) {
          await o.release(item, null);
          reserved--;
          rateHits++;
          if (rateHits > 3 && concurrency > 2) {
            concurrency = Math.max(2, Math.floor(concurrency * 0.7));
            rateHits = 0;
            log(`rate limited — concurrency now ${concurrency}`);
          }
          await sleep(err.retryAfterMs ?? 15_000 + Math.random() * 15_000);
        } else {
          await o.release(item, `error: ${err.message.slice(0, 200)}`);
          log(`${item.ticker} error: ${err.message.slice(0, 160)}`);
        }
      } finally {
        active--;
      }
    }
  };

  const stats = setInterval(() => log(`— ${o.job}: ${done} done, ${facts} facts, ${(tokensIn / 1e6).toFixed(2)}M in / ${(tokensOut / 1e6).toFixed(2)}M out tokens, concurrency ${concurrency}`), 120_000);
  await Promise.all(Array.from({ length: o.concurrency }, (_, i) => worker(i)));
  clearInterval(stats);
  clearInterval(leaseTimer);
  await sb.from("job_state").upsert({ job: o.job, cursor: 0, paused_reason: stop, lease_until: null, updated_at: new Date().toISOString() });
  log(stop ? `${o.job} STOPPED — ${stop}` : `${o.job} finished — ${done} done, ${facts} facts, ${(tokensIn / 1e6).toFixed(2)}M in / ${(tokensOut / 1e6).toFixed(2)}M out tokens`);
}
