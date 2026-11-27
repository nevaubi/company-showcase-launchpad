// External requests run on independent worker lanes. An occupied model or crawler cannot delay
// the other queues. Only source-backed measurements from local data run on the managed HTTP job.
import { DEMAND_PREFIX, PROMISE_PREFIX } from "@/lib/transcripts.server";
import {
  inspectCoverage,
  mirrorNext,
  nextTranscriptDemand,
} from "@/lib/transcripts/issuer-jobs.server";
import { args, dbGate, sb, sleep } from "./lib/supa";
import { heldReason, working } from "./lib/lanes";

type Outcome = {
  items: number;
  detail?: Record<string, string | number | boolean | null | undefined>;
};
async function superviseLane(job: string, cadenceMs: number, work: () => Promise<Outcome>) {
  let lastReceipt = 0;
  let heldSaid = false;
  do {
    // The owner stopped this lane (src/lib/jobs/lanes.ts): nothing is read or asked until it is released.
    const why = await heldReason(job);
    if (why != null) {
      if (!heldSaid) console.log(job, `stopped by the owner (${why.slice(0, 140)})`);
      heldSaid = true;
      if (args.once) return;
      await sleep(60_000);
      continue;
    }
    if (heldSaid) console.log(job, "released by the owner");
    heldSaid = false;
    const started = new Date().toISOString();
    let ok = true;
    let outcome: Outcome;
    const done = working(job);
    try {
      await dbGate(job);
      outcome = await work();
    } catch (error) {
      ok = false;
      outcome = {
        items: 0,
        detail: {
          error: error instanceof Error ? error.message.slice(0, 200) : "Transcript worker failed",
        },
      };
      console.error(job, outcome.detail?.error);
    } finally {
      done();
    }
    if (!ok || outcome.items > 0 || Date.now() - lastReceipt >= 5 * 60_000) {
      const receipt = await sb.from("job_runs").insert({
        job,
        started_at: started,
        finished_at: new Date().toISOString(),
        ok,
        items: outcome.items,
        detail: outcome.detail || {},
      });
      if (receipt.error) console.error(job, receipt.error.message);
      else lastReceipt = Date.now();
    }
    if (args.once) return;
    await sleep(cadenceMs);
  } while (true);
}
await Promise.all([
  superviseLane("call-source-worker", 30_000, async () => {
    const result = await mirrorNext();
    if (result?.error) throw new Error(result.error);
    return {
      items: result?.copied || 0,
      detail: result ? { ticker: result.ticker, remaining: result.remaining } : { busy: true },
    };
  }),
  superviseLane("call-discovery-worker", 5 * 60_000, async () => {
    await inspectCoverage();
    if (!process.env.FIRECRAWL_API_KEY)
      throw new Error("Transcript page reader is not configured on this worker");
    return { items: Number(await nextTranscriptDemand(DEMAND_PREFIX)) };
  }),
  superviseLane("call-commitments-worker", 5 * 60_000, async () => ({
    items: Number(await nextTranscriptDemand(PROMISE_PREFIX)),
  })),
]);
