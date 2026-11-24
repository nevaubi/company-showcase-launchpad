/**
 * Bounded, single-flight batch runner shared by the IR pipeline scripts.
 *  - bounded: at most `max` items are claimed (slots are reserved before claiming, so concurrent
 *    workers can't overshoot)
 *  - single-flight: a lease row in job_state; a second runner exits while the lease is live
 *  - idempotent: `claim` marks an item as taken in the database; `reset` re-queues items left
 *    half-done by a crashed runner (only after this runner holds the lease)
 *  - failure classes (src/lib/jobs/failure.ts): quota and config errors release the item untouched,
 *    trip the provider circuit (job_state `provider:<id>`, not the job key) and stop all workers;
 *    rate/transient errors back off with jitter and give an item a bounded number of tries;
 *    only permanent errors charge the item
 *  - provider circuit: a run whose provider route is open does not start (no lease, no calls)
 *  - paused guard: refuses to start while paused unless --resume is given
 *  - live results: companies that gained facts get their breakdowns rebuilt every few minutes, so
 *    newly read documents show up in the app without a manual rebuild
 *  - back-pressure: waits while the database is slow and sheds workers until it recovers, so the
 *    app stays usable during bulk runs
 */
import { writeFileSync } from "node:fs";
import { rebuildCompany } from "@/lib/ir/rebuild.server";
import { isTransientInfra as infraPattern, maxAttempts } from "@/lib/jobs/failure";
import { configStrike, configStrikeKey, failureAction, noteAttempt, type Attempt } from "./runner-failure";
export { failureAction, type FailureAction } from "./runner-failure";
import { closedMessage, providerStates, providerTrip, providerTripError } from "@/lib/jobs/provider-health.server";
import { routeDecision, type ProviderId } from "@/lib/jobs/provider-health";
import { GUARD_STATUS, guardedSourceOf, hasGuardedSources } from "@/lib/ir/source-guard";
import { args, dbGate, dbLatency, log, sb, sleep } from "./supa";

export interface RunnerItem {
  id: string;
  ticker: string;
  label: string;
  /** the file's source URL when the claim already has it (otherwise looked up for guarded tickers) */
  source_url?: string | null;
}

/**
 * The reviewed wrong-source entry (source-guard.ts) that refuses a claimed IR document, or null.
 * Only tickers with a listed wrong source cost one lookup by id.
 */
export async function refusedClaim(item: RunnerItem): Promise<string | null> {
  if (!hasGuardedSources(item.ticker)) return null;
  let url = item.source_url;
  if (url === undefined) {
    const { data, error } = await sb.from("ir_documents").select("source_url").eq("id", item.id).maybeSingle();
    if (error) throw new Error(error.message);
    url = (data?.source_url as string | null | undefined) ?? null;
  }
  return guardedSourceOf(item.ticker, url)?.owner ?? null;
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
  /** providers this run's calls go through (`routeOf(model, env)`); the run does not start while all are open */
  route?: ProviderId[];
  /** provider to trip when a quota/config error arrives untagged (calls through openai.server tag their own) */
  provider?: ProviderId;
  /** longest single backoff sleep of one worker (default 2 min; the item's tries stay bounded either way) */
  maxSleepMs?: number;
}

/** Database/network hiccups (statement timeouts, gateway pages) are retried instead of failing the item. */
export const isTransientInfra = infraPattern;

export async function runBatch<T extends RunnerItem>(o: RunnerOpts<T>) {
  /** the route is due a probe: one worker reads until the first item succeeds (review F2) */
  let probing = false;
  if (o.route?.length) {
    try {
      const d = routeDecision(await providerStates(o.route), o.route, Date.now());
      probing = d.state === "probe";
      if (d.state === "open") {
        const stop = `${d.cls === "config" ? "auth" : "quota"}: ${closedMessage(d.provider ?? o.route[0], d)}`;
        log(`${o.job}: ${stop} — not starting`);
        if (o.spendFile) writeFileSync(o.spendFile, JSON.stringify({ credits: 0, usd: 0, done: 0, facts: 0, tokensIn: 0, tokensOut: 0, stop }));
        return;
      }
    } catch (e) {
      log(`${o.job}: provider state unreadable (${(e as Error).message.slice(0, 120)}) — starting anyway`);
    }
  }
  const { data: state } = await sb.from("job_state").select("*").eq("job", o.job).maybeSingle();
  if (state?.paused_reason && args.resume === undefined) {
    log(`${o.job} paused: ${state.paused_reason} — rerun with --resume once fixed`);
    return;
  }
  if (state?.lease_until && new Date(state.lease_until) > new Date() && args.force === undefined) {
    // A per-company lease (job "reader:TICKER") left by a container that was just replaced runs out
    // within 3 minutes: wait for it, so the company's files are read instead of the run counting as done.
    let until = new Date(state.lease_until);
    const deadline = Date.now() + 4 * 60_000;
    while (o.job.includes(":") && until > new Date() && Date.now() < deadline) {
      log(`${o.job}: another runner holds the lease until ${until.toISOString()} — waiting`);
      await new Promise((r) => setTimeout(r, 15_000));
      const { data } = await sb.from("job_state").select("lease_until").eq("job", o.job).maybeSingle();
      until = data?.lease_until ? new Date(data.lease_until) : new Date(0);
    }
    if (until > new Date()) {
      log(`${o.job}: another runner holds the lease until ${until.toISOString()}`);
      if (o.spendFile) writeFileSync(o.spendFile, JSON.stringify({ credits: 0, usd: 0, done: 0, facts: 0, tokensIn: 0, tokensOut: 0, stop: `busy: another runner holds ${o.job}` }));
      return;
    }
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
  /** set when the stop came from a provider (quota/config): it lives on the provider circuit, not on this job key */
  let providerStop = false;
  // item id → rate/transient failures in this run (bounded retries)
  const infraFails = new Map<string, number>();
  let rateHits = 0;
  let active = 0;
  // While probing, the other workers would only meet the claimed probe and read it as a stop.
  let concurrency = probing ? 1 : o.concurrency;
  let lastWork = Date.now();
  /** last attempts (ok or transient failure) for the outage detector */
  let attempts: Attempt[] = [];
  const strikeKey = configStrikeKey(o.job);
  let strike: { cursor: number | null; paused_reason: string | null } | null = null;
  try {
    const { data } = await sb.from("job_state").select("cursor, paused_reason").eq("job", strikeKey).maybeSingle();
    strike = (data as typeof strike) ?? null;
  } catch {
    strike = null;
  }
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
      // Files of another company (reviewed list) are never read: mark them so they leave the queue.
      let refusedBy: string | null = null;
      try {
        refusedBy = await refusedClaim(item);
      } catch (e) {
        reserved--;
        await o.release(item, null).then(undefined, () => undefined);
        log(`${o.job}: guard lookup failed (${(e as Error).message.slice(0, 120)}) — item released, retrying in 15s`);
        await sleep(15_000);
        continue;
      }
      if (refusedBy) {
        reserved--;
        await o.release(item, GUARD_STATUS).then(undefined, () => undefined);
        log(`${item.ticker} ${item.id}: not read, file of ${refusedBy}`);
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
        attempts = noteAttempt(attempts, { id: item.id, ok: true }).window;
        if (probing) {
          probing = false;
          concurrency = o.concurrency;
          log(`${o.job}: probe succeeded — concurrency ${concurrency}`);
        }
        if (strike) {
          strike = null;
          await sb.from("job_state").delete().eq("job", strikeKey).then(undefined, () => undefined);
        }
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
        const err = e as Error & { provider?: string; kind?: string };
        const a = failureAction(err, infraFails.get(item.id) ?? 0, Math.random, o.maxSleepMs);
        // Transient failures feed the outage detector; a permanent rejection means the provider answered.
        let outage = false;
        if (a.act === "retry" && a.cls === "transient") ({ window: attempts, outage } = noteAttempt(attempts, { id: item.id, ok: false }));
        else if (a.act === "fail" && a.cls === "permanent") attempts = noteAttempt(attempts, { id: item.id, ok: true }).window;
        if (a.act === "stop") {
          // Never charge the item: no money or a wrong setting says nothing about the document,
          // unless the same item stopped the run on configuration twice in a row (review F5).
          if (!stop) {
            stop = a.stop;
            providerStop = true;
          }
          const s2 = a.cls === "config" ? configStrike(strike, item.id) : null;
          if (s2?.charge) {
            await o.release(item, `error: config: ${err.message.slice(0, 185)}`).then(undefined, () => undefined);
            await sb.from("job_state").delete().eq("job", strikeKey).then(undefined, () => undefined);
            strike = null;
            log(`${item.ticker} config stop on the same item twice — item charged so the provider can heal`);
          } else {
            if (s2?.row) {
              strike = s2.row;
              await sb.from("job_state").upsert({ job: strikeKey, ...s2.row, updated_at: new Date().toISOString() }).then(undefined, () => undefined);
            }
            await o.release(item, null).then(undefined, () => undefined);
          }
          if (!err.provider && o.provider) await providerTripError(o.provider, err).catch((x: Error) => log(`${o.job}: provider trip failed: ${x.message}`));
          log(`${item.ticker} ${a.cls} stop: ${err.message.slice(0, 160)} — item released untouched`);
        } else if (outage) {
          // Most recent attempts across several items failed transiently: the provider is down.
          // Trip it for 2 minutes and stop; the item is released untouched.
          reserved--;
          if (!stop) {
            stop = `outage: ${err.message.slice(0, 190)}`;
            providerStop = true;
          }
          await o.release(item, null).then(undefined, () => undefined);
          const pid = (err.provider as ProviderId | undefined) ?? o.provider;
          if (pid) await providerTrip(pid, "transient", err.message).catch((x: Error) => log(`${o.job}: provider trip failed: ${x.message}`));
          log(`${o.job}: provider outage (${attempts.filter((x) => !x.ok).length} of the last ${attempts.length} attempts failed) — stopping: ${err.message.slice(0, 120)}`);
        } else if (a.act === "retry") {
          infraFails.set(item.id, a.tries);
          reserved--;
          await o.release(item, null).then(undefined, () => undefined);
          if (a.cls === "rate") {
            rateHits++;
            if (rateHits > 3 && concurrency > 2) {
              concurrency = Math.max(2, Math.floor(concurrency * 0.7));
              rateHits = 0;
              log(`rate limited — concurrency now ${concurrency}`);
            }
          }
          log(`${item.ticker} ${a.cls} (try ${a.tries}/${maxAttempts(a.cls)}): ${err.message.slice(0, 100)} — retrying in ${Math.round(a.sleepMs / 1000)}s`);
          await sleep(a.sleepMs);
        } else {
          infraFails.delete(item.id);
          await o.release(item, a.status);
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
    } else if (ms && ms < 300 && concurrency < o.concurrency && !probing) concurrency++;
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
  // Budget stops pause this job key; provider stops live on the provider circuit (one row per provider,
  // healed by its probe), so per-company reader keys no longer pile up stale "quota" pauses.
  await sb.from("job_state").upsert({ job: o.job, cursor: 0, paused_reason: providerStop ? null : stop, lease_until: null, updated_at: new Date().toISOString() });
  log(stop ? `${o.job} STOPPED — ${stop}` : `${o.job} finished — ${done} done, ${facts} facts, ${(tokensIn / 1e6).toFixed(2)}M in / ${(tokensOut / 1e6).toFixed(2)}M out tokens${usd ? `, ~$${usd.toFixed(2)}` : ""}${credits ? `, ~${credits.toFixed(2)} credits` : ""}`);
  if (o.spendFile) writeFileSync(o.spendFile, JSON.stringify({ credits, usd, done, facts, tokensIn, tokensOut, stop }));
}
