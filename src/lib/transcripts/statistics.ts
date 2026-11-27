import type { ParsedTranscript } from "./parse";
import { talkShare } from "./analyze";
import { callFigures, callTone, checkSummary, checkTakeaways } from "./insights";

/** Computed at ingestion from the stored turns. Numbers, claims and speakers retain their turn references. */
export function transcriptStatistics(t: ParsedTranscript) {
  return {
    version: 1 as const,
    share: talkShare(t),
    figures: callFigures(t, 8),
    tone: callTone(t),
    summary: t.digest?.summary ? checkSummary(t, t.digest.summary) : null,
    takeaways: t.digest?.takeaways.length ? checkTakeaways(t, t.digest.takeaways) : null,
  };
}
