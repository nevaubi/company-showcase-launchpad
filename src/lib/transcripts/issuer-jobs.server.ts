import { COVERAGE, coverageOf } from "@/lib/coverage";
import { supabaseAdmin as sb } from "@/integrations/supabase/client.server";
import {
  DEMAND_PREFIX,
  PROMISE_PREFIX,
  listCalls,
  refreshWebCalls,
} from "@/lib/transcripts.server";
import { analyzePromises } from "@/lib/earnings/promises.server";
import { analyzeIssuerSlice, mirrorIssuerSlice } from "./issuer-mirror.server";
import { issuerKeys } from "./issuer-archive.server";

export async function nextTranscriptDemand(prefix: string, downloadLimit = 3) {
  const now = new Date().toISOString();
  const { data, error } = await sb
    .from("job_state")
    .select("job")
    .like("job", prefix + "%")
    .or(`lease_until.is.null,lease_until.lt.${now}`)
    .order("updated_at")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return false;
  const job = data.job;
  const until = new Date(Date.now() + 15 * 60_000).toISOString();
  const claimed = await sb
    .from("job_state")
    .update({ lease_until: until, paused_reason: null })
    .eq("job", job)
    .or(`lease_until.is.null,lease_until.lt.${now}`)
    .select("job")
    .maybeSingle();
  if (claimed.error) throw claimed.error;
  if (!claimed.data) return false;
  try {
    const co = coverageOf(job.slice(prefix.length));
    if (!co) throw new Error("Unknown ticker");
    if (prefix === DEMAND_PREFIX) {
      const remaining = await refreshWebCalls(co, downloadLimit);
      if (remaining) {
        const resumed = await sb
          .from("job_state")
          .update({ lease_until: null, updated_at: new Date().toISOString() })
          .eq("job", job)
          .eq("lease_until", until);
        if (resumed.error) throw resumed.error;
        return true;
      }
    } else await analyzePromises(co);
    const done = await sb.from("job_state").delete().eq("job", job).eq("lease_until", until);
    if (done.error) throw done.error;
    console.log("Stored call coverage", job);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Call refresh unavailable";
    const failed = await sb
      .from("job_state")
      .update({
        paused_reason: message.slice(0, 150),
        updated_at: now,
        lease_until: new Date(Date.now() + 6 * 3600_000).toISOString(),
      })
      .eq("job", job)
      .eq("lease_until", until);
    if (failed.error) throw failed.error;
    console.error(job, message);
    throw new Error(message);
  }
  return true;
}

// Walk coverage alongside reader requests. listCalls schedules discovery only for missing or
// aged-out periods, without making search or model calls itself.
export async function inspectCoverage() {
  const job = "call-archive-rotation";
  const now = new Date().toISOString();
  const seed = await sb.from("job_state").upsert({ job }, { ignoreDuplicates: true });
  if (seed.error) throw seed.error;
  const claim = await sb
    .from("job_state")
    .update({ lease_until: new Date(Date.now() + 20 * 60_000).toISOString(), updated_at: now })
    .eq("job", job)
    .or(`lease_until.is.null,lease_until.lt.${now}`)
    .select("cursor")
    .maybeSingle();
  if (claim.error) throw claim.error;
  if (!claim.data) return;
  const cursor = claim.data.cursor % COVERAGE.length;
  await listCalls(COVERAGE[cursor]);
  const updated = await sb
    .from("job_state")
    .update({ cursor: (cursor + 1) % COVERAGE.length })
    .eq("job", job)
    .eq("updated_at", now);
  if (updated.error) throw updated.error;
}

const priority = ["JPM", "C", "BAC", "WFC", "NVDA", "MSFT", "AAPL", "GS", "MS", "SCHW"];
const issuers = [...new Set([...priority, ...COVERAGE.map((c) => c.ticker)])];
export async function mirrorNext(limit = 5) {
  const job = "issuer-calls-mirror";
  const now = new Date().toISOString();
  const seed = await sb.from("job_state").upsert({ job }, { ignoreDuplicates: true });
  if (seed.error) throw seed.error;
  const lease = new Date(Date.now() + 5 * 60_000).toISOString();
  const claim = await sb
    .from("job_state")
    .update({ lease_until: lease, updated_at: now })
    .eq("job", job)
    .or(`lease_until.is.null,lease_until.lt.${now}`)
    .select("cursor")
    .maybeSingle();
  if (claim.error) throw claim.error;
  if (!claim.data) return null;
  const i = claim.data.cursor % issuers.length;
  const ticker = issuers[i];
  let further = false,
    copied = 0,
    failure: string | null = null;
  try {
    const co = coverageOf(ticker);
    if (co) {
      const result = await mirrorIssuerSlice(co, limit);
      further = result.remaining > 0;
      copied = result.copied;
      await analyzeIssuerSlice(co, 8);
    }
  } catch (e) {
    failure = ticker + ": " + (e instanceof Error ? e.message : "source unavailable");
    console.error("Issuer call mirror", failure);
  }
  // Failed files remain staged and are revisited on the next rotation. Other companies keep updating.
  const updated = await sb
    .from("job_state")
    .update({
      cursor: further ? i : (i + 1) % issuers.length,
      paused_reason: failure,
      lease_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq("job", job)
    .eq("lease_until", lease);
  if (updated.error) throw updated.error;
  return { ticker, copied, remaining: further, error: failure };
}

/** The managed HTTP caller closes after five seconds. Use only material already in Cloud,
 * abort storage work at 2.7 s, and leave time for the cursor and job-run receipts. */
export async function scheduledCallArchive() {
  const job = "issuer-call-statistics";
  const signal = AbortSignal.timeout(2700);
  const now = new Date().toISOString();
  const lease = new Date(Date.now() + 8000).toISOString();
  let cursor = 0,
    claimed = false,
    visited = 0;
  let ticker: string | undefined;
  try {
    const seed = await sb
      .from("job_state")
      .upsert({ job }, { ignoreDuplicates: true })
      .abortSignal(signal);
    if (seed.error) throw seed.error;
    const claim = await sb
      .from("job_state")
      .update({ lease_until: lease, updated_at: now })
      .eq("job", job)
      .or(`lease_until.is.null,lease_until.lt.${now}`)
      .select("cursor")
      .abortSignal(signal)
      .maybeSingle();
    if (claim.error) throw claim.error;
    if (!claim.data) return { ok: true, items: 0, detail: { busy: true } };
    claimed = true;
    cursor = claim.data.cursor;
    const prefixes = ["issuer-index:v1:", "issuer-direct-index:v1:"];
    const catalogs = await Promise.all(prefixes.map((prefix) => issuerKeys(prefix, signal)));
    const native = new Set(
      catalogs.flatMap((keys, i) =>
        [...keys]
          .filter((key) => key.startsWith(prefixes[i]))
          .map((key) => key.slice(prefixes[i].length)),
      ),
    );
    const names = [...new Set([...priority.filter((t) => native.has(t)), ...[...native].sort()])];
    if (!names.length) return { ok: true, items: 0, detail: { issuers: 0 } };
    ticker = names[cursor % names.length];
    // Advance on the next tick even after an oversized issuer, so shorter names still get served.
    visited = names.length;
    const result = await analyzeIssuerSlice(
      { ticker, shortName: coverageOf(ticker)?.shortName || ticker },
      1,
      signal,
    );
    return { ok: true, items: result.processed, detail: { ticker, remaining: result.remaining } };
  } catch (error) {
    if (signal.aborted)
      return {
        ok: true,
        items: 0,
        detail: { ticker, cut: true, reason: "local database time budget spent" },
      };
    throw error;
  } finally {
    if (claimed) {
      const release = await sb
        .from("job_state")
        .update({
          cursor: visited ? (cursor + 1) % visited : cursor,
          lease_until: null,
          updated_at: new Date().toISOString(),
        })
        .eq("job", job)
        .eq("lease_until", lease)
        .abortSignal(AbortSignal.timeout(400));
      if (release.error && !signal.aborted) throw release.error;
    }
  }
}
