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

export async function nextTranscriptDemand(prefix: string, downloadLimit = 3, failRun = false) {
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
    if (failRun) throw new Error(message);
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
    failure: string | null = null;
  try {
    const co = coverageOf(ticker);
    if (co)
      further =
        (await analyzeIssuerSlice(co, limit)) > 0 ||
        (await mirrorIssuerSlice(co, limit)).remaining > 0;
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
  return { ticker, remaining: further, error: failure };
}

/** One bounded issuer slice on the managed scheduler; also used by the standalone worker. */
export async function scheduledCallArchive() {
  await inspectCoverage();
  // Give both queues their own recurring slot so a deep issuer backlog cannot postpone them.
  const slot = Math.floor(Date.now() / 120000) % 5;
  if (
    slot === 1 &&
    process.env.TAVILY_API_KEY &&
    process.env.FIRECRAWL_API_KEY &&
    (await nextTranscriptDemand(DEMAND_PREFIX, 1, true))
  )
    return { ok: true, items: 1, detail: { queue: "transcript discovery" } };
  if (slot === 3 && (await nextTranscriptDemand(PROMISE_PREFIX, 1, true)))
    return { ok: true, items: 1, detail: { queue: "management commitments" } };
  const mirror = await mirrorNext(1);
  return {
    ok: !mirror?.error,
    items: mirror ? 1 : 0,
    detail: mirror || { busy: true },
  };
}
