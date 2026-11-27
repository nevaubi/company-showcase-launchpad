import { requireAppAccess } from "@/lib/app-access-middleware";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { coverageOf } from "@/lib/coverage";
import type { transcriptStatistics } from "./transcripts/statistics";
import type { ParsedTranscript, TranscriptRef } from "@/lib/transcripts/parse";

export interface EarningsTranscript extends ParsedTranscript, TranscriptRef {
  ticker: string;
  title: string;
  source: string;
  fetchedAt: string;
  statistics?: ReturnType<typeof transcriptStatistics>;
  archiveSummary?: { text: string; asOf: string | null };
}

/** Recent earnings-call transcripts for a covered company (newest first), read from the archive. */
export const listEarningsCalls = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .inputValidator((d: unknown) => z.object({ ticker: z.string().min(1).max(8) }).parse(d))
  .handler(async ({ data }): Promise<{ calls: TranscriptRef[]; error?: string }> => {
    const co = coverageOf(data.ticker);
    if (!co) return { calls: [], error: "Not a covered company" };
    const { listCalls } = await import("@/lib/transcripts.server");
    return listCalls(co);
  });

/** Full transcript, parsed into speaker turns. Stored speaker turns, keyed to the source document. */
export const getEarningsTranscript = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .inputValidator((d: unknown) => z.object({ ticker: z.string().min(1).max(8), url: z.string().url().max(2048) }).parse(d))
  .handler(async ({ data }): Promise<{ transcript: EarningsTranscript | null; error?: string }> => {
    const co = coverageOf(data.ticker);
    if (!co) return { transcript: null, error: "Not a covered company" };
    const { loadTranscript } = await import("@/lib/transcripts.server");
    return loadTranscript(co, data.url);
  });
