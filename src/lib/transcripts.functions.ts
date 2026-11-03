import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { coverageOf } from "@/lib/coverage";
import { parseTranscript, transcriptMatches, transcriptRef, type ParsedTranscript, type TranscriptRef } from "@/lib/transcripts/parse";

/** Share classes whose calls are published under another ticker. */
const ALT_TICKERS: Record<string, string[]> = { GOOGL: ["GOOG"], "BRK-B": ["BRK"], META: ["FB"] };
const TRANSCRIPT_HOST = /^https:\/\/www\.fool\.com\/earnings\/call-transcripts\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+\/?$/;

export interface EarningsTranscript extends ParsedTranscript, TranscriptRef {
  ticker: string;
  title: string;
  source: string;
  fetchedAt: string;
}

/** Recent earnings-call transcripts for a covered company (newest first), found with web search. */
export const listEarningsCalls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ ticker: z.string().min(1).max(8) }).parse(d))
  .handler(async ({ data }): Promise<{ calls: TranscriptRef[]; error?: string }> => {
    const co = coverageOf(data.ticker);
    if (!co) return { calls: [], error: "Not a covered company" };
    const { cached } = await import("@/lib/ai.server");
    return cached(`calls:v1:${co.ticker}`, 12 * 3600_000, () => findCalls(co.ticker, co.shortName), (r) => r.calls.length > 0);
  });

async function findCalls(ticker: string, name: string): Promise<{ calls: TranscriptRef[]; error?: string }> {
  const { tavilySearch } = await import("@/lib/web.server");
  const q = `${name} ${ticker} earnings call transcript`;
  const settled = await Promise.allSettled([
    tavilySearch(q, { topic: "news", days: 200, maxResults: 12, domains: ["fool.com"] }),
    tavilySearch(q, { maxResults: 15, domains: ["fool.com"] }),
    tavilySearch(`${name} ${ticker} quarterly earnings conference call transcript ${new Date().getUTCFullYear()}`, { maxResults: 10, domains: ["fool.com"] }),
  ]);
  const results = settled.flatMap((s) => (s.status === "fulfilled" ? s.value.results : []));
  if (!results.length) {
    const err = settled.find((s) => s.status === "rejected") as PromiseRejectedResult | undefined;
    return { calls: [], error: err ? (err.reason as Error).message : "No transcripts found" };
  }
  const byQuarter = new Map<string, TranscriptRef>();
  for (const r of results) {
    if (!transcriptMatches(r.url, ticker, name, ALT_TICKERS[ticker] ?? [])) continue;
    const ref = transcriptRef(r.url);
    if (!ref.date) continue;
    const key = ref.quarter ?? ref.date;
    const prev = byQuarter.get(key);
    if (!prev || (prev.date ?? "") < ref.date) byQuarter.set(key, ref);
  }
  const calls = [...byQuarter.values()].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).slice(0, 10);
  return calls.length ? { calls } : { calls: [], error: "No transcripts found for this company" };
}

/** Full transcript, parsed into speaker turns. Transcripts never change, so they're cached for 60 days. */
export const getEarningsTranscript = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ ticker: z.string().min(1).max(8), url: z.string().url().max(300) }).parse(d))
  .handler(async ({ data }): Promise<{ transcript: EarningsTranscript | null; error?: string }> => {
    const co = coverageOf(data.ticker);
    if (!co) return { transcript: null, error: "Not a covered company" };
    const url = data.url.replace(/\/$/, "");
    if (!TRANSCRIPT_HOST.test(url) || !transcriptMatches(url, co.ticker, co.shortName, ALT_TICKERS[co.ticker] ?? []))
      return { transcript: null, error: "That isn't a transcript for this company" };
    const { cached } = await import("@/lib/ai.server");
    const slug = url.split("/").slice(-4).join("/");
    return cached(
      `transcript:v1:${slug}`,
      60 * 86400_000,
      async () => {
        const { firecrawlScrape } = await import("@/lib/web.server");
        try {
          const page = await firecrawlScrape(url);
          const parsed = parseTranscript(page.markdown);
          if (parsed.turns.length < 5) return { transcript: null, error: "Couldn't find the transcript text on that page" };
          const ref = transcriptRef(url);
          return {
            transcript: {
              ...ref,
              ...parsed,
              ticker: co.ticker,
              title: `${co.shortName} ${ref.quarter ?? ""} earnings call`.replace(/\s+/g, " "),
              source: "The Motley Fool",
              fetchedAt: new Date().toISOString(),
            },
          };
        } catch (e) {
          console.error("transcript fetch failed", e);
          return { transcript: null, error: (e as Error).message };
        }
      },
      (r) => !!r.transcript,
    );
  });
