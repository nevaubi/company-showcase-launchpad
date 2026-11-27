// The partner job builds the company archive twice an hour. This worker fills uncovered calls
// and grades commitments off the request path. Items survive deploys in job_state.
import { COVERAGE, coverageOf } from "@/lib/coverage";
import {
  DEMAND_PREFIX,
  PROMISE_PREFIX,
  listCalls,
  refreshWebCalls,
} from "@/lib/transcripts.server";
import { analyzePromises } from "@/lib/earnings/promises.server";
import { args, dbGate, sb, sleep } from "./lib/supa";

async function next(prefix: string) {
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
      const remaining = await refreshWebCalls(co);
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
  }
  return true;
}

// Walk coverage alongside reader requests. listCalls schedules discovery only for missing or
// aged-out periods, without making search or model calls itself.
async function inspectCoverage() {
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

do {
  await dbGate("transcript-worker");
  if (process.env.TAVILY_API_KEY && process.env.FIRECRAWL_API_KEY) await next(DEMAND_PREFIX);
  await next(PROMISE_PREFIX);
  await inspectCoverage();
  if (args.once) break;
  await sleep(5 * 60_000);
} while (true);
