// Resolve durable transcript requests and fill the issuer archive from its published source.
import { DEMAND_PREFIX, PROMISE_PREFIX } from "@/lib/transcripts.server";
import {
  inspectCoverage,
  mirrorNext,
  nextTranscriptDemand,
} from "@/lib/transcripts/issuer-jobs.server";
import { args, dbGate, sleep } from "./lib/supa";

let nextAnalysis = 0;
do {
  await dbGate("transcript-worker");
  await mirrorNext();
  if (Date.now() >= nextAnalysis) {
    if (process.env.TAVILY_API_KEY && process.env.FIRECRAWL_API_KEY)
      await nextTranscriptDemand(DEMAND_PREFIX);
    await nextTranscriptDemand(PROMISE_PREFIX);
    await inspectCoverage();
    nextAnalysis = Date.now() + 5 * 60_000;
  }
  if (args.once) break;
  await sleep(30_000);
} while (true);
