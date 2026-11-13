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
 *  - live results: companies that gained facts get their breakdowns rebuilt every few minutes, so
 *    newly read documents show up in the app without a manual rebuild
 *  - back-pressure: waits while the database is slow and sheds workers until it recovers, so the
 *    app stays usable during bulk runs
 */
import { writeFileSync } from "node:fs";
import { rebuildCompany } from "@/lib/ir/rebuild.server";
import { OpenAIError } from "@/lib/openai.server";
import { args, dbGate, dbLatency, log, sb, sleep } from "./supa";

export interface RunnerItem {
  id: string;
  ticker: string;
  label: string;
}

export interface RunUsage {
  input_tokens: number;
  output_tokens: number;
  /** estimated spend in USD when the model's prices are known */
  usd?: number;
  /** estimated Lovable AI Gateway credits */
  credits?: number;
}

export interface RunnerOpts<T extends RunnerItem> {
  job: string;
  max: number;
  concurrency: number;
  claim: () => Promise<T | null>;
  release: (item: T, status: string | null) => Promise<unknown>;
  reset: () => Promise<unknown>;
  process: (item: T) => Promise<{ facts: number; note?: string; usage?: RunUsage | null }>;
  /** keep polling for new work for this many minutes after the queue empties */
  idleMinutes?: number;
  /** pause the job once the estimated spend of this run passes this many USD */
  maxUsd?: number;
  /** pause the job once this run's estimated gateway credits pass this many */
  maxCredits?: number;
  /** write {credits, usd, done, facts, stop} here when the run ends (orchestrators keep a ledger) */
  spendFile?: string;
}

/** Database/network hiccups (statement timeouts, gateway pages) are retried instead of failing the item. */
export const isTransientInfra = (msg: string) =>
  /statement timeout|fetch failed|ECONNRESET|ETIMEDOUT|EPIPE|socket hang up|network|connection (reset|terminated|closed)|\b50[234]\b|Bad Gateway|Service Unavailable|Gateway Time-?out|<!DOCTYPE html>|upstream/i.test(msg);
const MAX_INFRA_RETRIES = 3;

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
  // Query builders only run when awaited/then'd — a bare `setInterval(renew)` never renews the lease.
  const leaseTimer = setInterval(() => {
    renew().then(({ error }) => error && log(`${o.job}: lease renewal failed: ${error.message}`));
  }, 60_000);
  await o.reset();

  let reserved = 0;
  let done = 0;
  let facts = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let usd = 0;
  let credits = 0;
  let stop: string | null = null;
  // item id → database/network failures in a row (bounded retries)
  const infraFails = new Map<string, number>();
  let rateHits = 0;
  let active = 0;
  let concurrency = o.concurrency;
  let lastWork = Date.now();
  // ticker → when it first gained facts since its last rebuild
  const dirty = new Map<string, number>();
  const cost = new Map<string, { at: number; ms: number }>();
  let flushing = false;
  const flush = async (final = false) => {
    if (flushing) return;
    flushing = true;
    try {
      for (const [t, since] of [...dirty]) {
        // Big companies (JPM: ~56k facts, ~100s) rebuild less often so they don't hog the database.
        const c = cost.get(t);
        if (!final && c && Date.now() - c.at < Math.max(3 * 60_000, c.ms * 10)) continue;
        dirty.delete(t);
        // Another runner (or the full build) may already have rebuilt it with these facts.
        const { data: row } = await sb.from("ir_company_series").select("built_at").eq("ticker", t).maybeSingle();
        if (row?.built_at && Date.parse(row.built_at) > since + 60_000) continue;
        await dbGate(`${o.job} rebuild`);
        const t0 = Date.now();
        try {
          const p = await rebuildCompany(t);
          cost.set(t, { at: Date.now(), ms: Date.now() - t0 });
          if (p) log(`${t.padEnd(5)} breakdowns rebuilt (${p.stats.facts.toLocaleString()} facts) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
        } catch (e) {
          if (!dirty.has(t)) dirty.set(t, since);
          log(`${t} rebuild failed: ${(e as Error).message.slice(0, 120)}`);
        }
      }
    } finally {
      flushing = false;
    }
  };
  const rebuildTimer = setInterval(() => void flush(), 60_000);

  const worker = async (n: number) => {
    while (!stop && reserved < o.max) {
      if (n >= concurrency) {
        await sleep(5000);
        continue;
      }
      await dbGate(o.job);
      reserved++;
      let item: T | null;
      try {
        item = await o.claim();
      } catch (e) {
        // A busy database (statement timeout) shouldn't end the batch: back off and try again.
        reserved--;
        log(`${o.job}: claim failed (${(e as Error).message.slice(0, 120)}) — retrying in 15s`);
        await sleep(15_000);
        continue;
      }
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
        if (r.facts > 0 && !dirty.has(item.ticker)) dirty.set(item.ticker, Date.now());
        tokensIn += r.usage?.input_tokens ?? 0;
        tokensOut += r.usage?.output_tokens ?? 0;
        usd += r.usage?.usd ?? 0;
        credits += r.usage?.credits ?? 0;
        rateHits = Math.max(0, rateHits - 1);
        infraFails.delete(item.id);
        log(`${item.ticker.padEnd(5)} ${String(r.facts).padStart(4)} facts ${r.note ? `${r.note} ` : ""}${((Date.now() - t0) / 1000).toFixed(0)}s  ${item.label.slice(0, 60)}`);
        if (o.maxCredits != null && credits > o.maxCredits && !stop) {
          stop = `budget: this run used about ${credits.toFixed(1)} credits (cap ${o.maxCredits}) — rerun with --resume to continue`;
          await sb.from("job_state").upsert({ job: o.job, cursor: 0, paused_reason: stop, lease_until: null, updated_at: new Date().toISOString() });
        }
        if (o.maxUsd && usd > o.maxUsd && !stop) {
          stop = `budget: this run spent about $${usd.toFixed(0)} (cap $${o.maxUsd}) — rerun with --resume to continue`;
          await sb.from("job_state").upsert({ job: o.job, cursor: 0, paused_reason: stop, lease_until: null, updated_at: new Date().toISOString() });
        }
      } catch (e) {
        const err = e as Error;
        const infra = !(err instanceof OpenAIError) && isTransientInfra(err.message);
        const tries = infra ? (infraFails.get(item.id) ?? 0) + 1 : 0;
        if (err instanceof OpenAIError && (err.kind === "auth" || err.kind === "quota")) {
          stop = `${err.kind}: ${err.message.slice(0, 200)}`;
          await o.release(item, null);
          await sb.from("job_state").upsert({ job: o.job, cursor: 0, paused_reason: stop, lease_until: null, updated_at: new Date().toISOString() });
        } else if (infra && tries <= MAX_INFRA_RETRIES) {
          // Busy database / flaky network: put the item back and slow down instead of failing it.
          infraFails.set(item.id, tries);
          reserved--;
          log(`${item.ticker} database/network hiccup (try ${tries}/${MAX_INFRA_RETRIES}): ${err.message.slice(0, 100)}`);
          await o.release(item, null).then(undefined, () => undefined);
          await sleep(20_000 + Math.random() * 20_000);
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
          infraFails.delete(item.id);
          await o.release(item, `error: ${err.message.slice(0, 200)}`);
          log(`${item.ticker} error: ${err.message.slice(0, 160)}`);
        }
      } finally {
        active--;
      }
    }
  };

  // Shed workers while database round-trips are slow; add them back one at a time once it recovers.
  const governor = setInterval(() => {
    const ms = dbLatency();
    if (ms > 800 && concurrency > 2) {
      concurrency = Math.max(2, Math.floor(concurrency * 0.75));
      log(`database slow (${ms}ms) — concurrency now ${concurrency}`);
    } else if (ms && ms < 300 && concurrency < o.concurrency) concurrency++;
  }, 20_000);
  const stats = setInterval(
    () =>
      log(
        `— ${o.job}: ${done} done, ${facts} facts, ${(tokensIn / 1e6).toFixed(2)}M in / ${(tokensOut / 1e6).toFixed(2)}M out tokens${usd ? `, ~$${usd.toFixed(2)}` : ""}${credits ? `, ~${credits.toFixed(2)} credits` : ""}, concurrency ${concurrency}`,
      ),
    120_000,
  );
  await Promise.all(Array.from({ length: o.concurrency }, (_, i) => worker(i)));
  clearInterval(stats);
  clearInterval(governor);
  clearInterval(rebuildTimer);
  while (flushing) await sleep(1000);
  await flush(true);
  clearInterval(leaseTimer);
  await sb.from("job_state").upsert({ job: o.job, cursor: 0, paused_reason: stop, lease_until: null, updated_at: new Date().toISOString() });
  log(stop ? `${o.job} STOPPED — ${stop}` : `${o.job} finished — ${done} done, ${facts} facts, ${(tokensIn / 1e6).toFixed(2)}M in / ${(tokensOut / 1e6).toFixed(2)}M out tokens${usd ? `, ~$${usd.toFixed(2)}` : ""}${credits ? `, ~${credits.toFixed(2)} credits` : ""}`);
  if (o.spendFile) writeFileSync(o.spendFile, JSON.stringify({ credits, usd, done, facts, tokensIn, tokensOut, stop }));
}
