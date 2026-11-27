import type { CoverageCompany } from "@/lib/coverage";
import {
  parseTranscript,
  datedTranscriptRef,
  upgradeLegacyTranscript,
  transcriptMatches,
  transcriptRef,
  SHARE_CLASS_TICKERS,
  type TranscriptRef,
} from "@/lib/transcripts/parse";
import type { EarningsTranscript } from "@/lib/transcripts.functions";

import { fromArchive, mergeCalls } from "@/lib/transcripts/archive";
import {
  archiveIndex,
  issuerStatisticsKey,
  issuerTurns,
} from "@/lib/transcripts/issuer-archive.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { cached } from "@/lib/ai.server";
import type { EarningsBrief } from "@/lib/web.functions";
import { transcriptStatistics } from "./transcripts/statistics";

const ALT_TICKERS = SHARE_CLASS_TICKERS;
const DAY = 86400_000;
export const PROMISE_PREFIX = "call-promise-demand:";
export const DEMAND_PREFIX = "call-archive-demand:";
async function stored<T>(key: string): Promise<T | null> {
  const { data, error } = await supabaseAdmin
    .from("ai_cache")
    .select("payload")
    .eq("key", key)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.payload as T) ?? null;
}
function webKey(url: string) {
  return "transcript:v3:" + url.replace(/\/$/, "").split("/").slice(-4).join("/");
}
function webKeys(url: string) {
  const key = webKey(url);
  return [
    key,
    key.replace("transcript:v3:", "transcript:v2:"),
    key.replace("transcript:v3:", "transcript:v1:"),
  ];
}
async function storedWeb(co: Co, url: string) {
  if (!webUrl(co, url)) return null;
  const keys = webKeys(url);
  const { data, error } = await supabaseAdmin
    .from("ai_cache")
    .select("key,payload")
    .in("key", keys)
    .order("key", { ascending: false });
  if (error) throw new Error(error.message);
  for (const row of data || []) {
    const t = (row.payload as unknown as { transcript?: EarningsTranscript })?.transcript;
    if (
      !t ||
      t.ticker !== co.ticker ||
      t.url.replace(/\/$/, "") !== url.replace(/\/$/, "") ||
      !t.turns?.length ||
      !t.speakers?.length
    )
      continue;
    return row.key === keys[0] ? t : upgradeLegacyTranscript(t);
  }
  return null;
}
function webUrl(co: Co, url: string) {
  return (
    TRANSCRIPT_HOST.test(url) &&
    transcriptMatches(url, co.ticker, co.shortName, ALT_TICKERS[co.ticker] || [])
  );
}
export async function queue(ticker: string, prefix = DEMAND_PREFIX) {
  const { error } = await supabaseAdmin
    .from("job_state")
    .upsert({ job: prefix + ticker }, { ignoreDuplicates: true });
  if (error) console.warn("Could not queue transcript", ticker, error.code);
}
export const TRANSCRIPT_HOST =
  /^https:\/\/www\.fool\.com\/earnings\/call-transcripts\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+\/?$/;

type Co = Pick<CoverageCompany, "ticker" | "shortName">;

/** Page loads only read stored files. The background worker fills missing periods and extracts web copies. */
export async function listCalls(co: Co): Promise<{ calls: TranscriptRef[]; error?: string }> {
  const [archive, legacy, ready] = await Promise.all([
    archiveIndex(co.ticker),
    stored<{ calls: TranscriptRef[] }>(`calls:v1:${co.ticker}`),
    stored<{ calls: TranscriptRef[]; checked: string }>(`call-web-ready:v1:${co.ticker}`),
  ]);
  // Older list caches contain discoveries which the user may never have opened. Offer only downloaded calls.
  let web = ready?.calls ?? [];
  if (!ready && legacy?.calls.length) {
    const refs = legacy.calls.filter((r) => webUrl(co, r.url));
    const { data, error } = await supabaseAdmin
      .from("ai_cache")
      .select("key")
      .in(
        "key",
        refs.flatMap((r) => webKeys(r.url)),
      );
    if (error) throw new Error(error.message);
    const keys = new Set((data ?? []).map((r) => r.key));
    web = refs.filter((r) => webKeys(r.url).some((k) => keys.has(k)));
  }
  const calls = mergeCalls(
    archive.entries,
    web.filter((r) => webUrl(co, r.url)),
  );
  if (
    (!calls[0]?.date || Date.now() - Date.parse(calls[0].date) > 75 * DAY) &&
    (!ready || Date.now() - Date.parse(ready.checked) > 7 * DAY)
  )
    await queue(co.ticker);
  return calls.length
    ? { calls }
    : { calls, error: "No stored call is available yet. Coverage is refreshed in the background." };
}

export async function loadTranscript(
  co: Co,
  rawUrl: string,
): Promise<{ transcript: EarningsTranscript | null; error?: string }> {
  if (webUrl(co, rawUrl)) {
    const old = await storedWeb(co, rawUrl);
    if (old) return { transcript: old };
  }
  const { entries } = await archiveIndex(co.ticker);
  // Never fetch a caller-supplied URL. Resolve the original source to this ticker's own archive index.
  const entry = entries.find((r) => r.url === rawUrl);
  if (!entry) return { transcript: null, error: "No stored transcript matches this source." };
  const file = await issuerTurns(co.ticker, entry);
  const transcript = file && fromArchive(co.ticker, co.shortName, entry, file);
  if (!transcript)
    return { transcript: null, error: "The archived speaker turns are temporarily unavailable." };
  const { statistics } = await cached(
    issuerStatisticsKey(co.ticker, entry.archiveId, entry.textHash),
    Infinity,
    async () => ({ statistics: transcriptStatistics(transcript) }),
  );
  return { transcript: { ...transcript, statistics } };
}

async function findCalls(
  ticker: string,
  name: string,
): Promise<{ calls: TranscriptRef[]; error?: string }> {
  const { tavilySearch } = await import("@/lib/web.server");
  const q = `${name} ${ticker} earnings call transcript`;
  const settled = await Promise.allSettled([
    tavilySearch(q, { topic: "news", days: 200, maxResults: 12, domains: ["fool.com"] }),
    tavilySearch(q, { maxResults: 15, domains: ["fool.com"] }),
    tavilySearch(
      `${name} ${ticker} quarterly earnings conference call transcript ${new Date().getUTCFullYear()}`,
      { maxResults: 10, domains: ["fool.com"] },
    ),
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
  const calls = [...byQuarter.values()]
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, 10);
  return calls.length ? { calls } : { calls: [], error: "No transcripts found for this company" };
}

/** Background-only acquisition. Publish a reference only after its verified source text is durable. */
async function downloadWebTranscript(co: Co, url: string): Promise<boolean> {
  if (!webUrl(co, url)) return false;
  const { firecrawlScrape } = await import("@/lib/web.server");
  const page = await firecrawlScrape(url);
  if (page.url && (!webUrl(co, page.url.replace(/\/$/, "")) || webKey(page.url) !== webKey(url)))
    return false;
  const parsed = parseTranscript(page.markdown);
  if (parsed.turns.length < 5) return false;
  const ref = datedTranscriptRef(url, page.markdown);
  const transcript: EarningsTranscript = {
    ...ref,
    ...parsed,
    statistics: transcriptStatistics(parsed),
    ticker: co.ticker,
    title: [co.shortName, ref.quarter, "earnings call"].filter(Boolean).join(" "),
    source: "The Motley Fool",
    fetchedAt: new Date().toISOString(),
  };
  const { error } = await supabaseAdmin.from("ai_cache").upsert({
    key: webKey(url),
    payload: { transcript } as never,
    created_at: transcript.fetchedAt,
  });
  if (error) throw new Error(error.message);
  return true;
}

/** Run only from the background worker. Publish the index after the downloads have succeeded. */
export async function refreshWebCalls(co: Co, limit = 3) {
  type WebIndex = { calls: TranscriptRef[]; remaining?: TranscriptRef[]; checked: string };
  const key = `call-web-ready:v1:${co.ticker}`;
  const previous = await stored<WebIndex>(key);
  const old = await stored<{ calls: TranscriptRef[] }>(`calls:v1:${co.ticker}`);
  const resuming =
    !!previous?.remaining?.length && Date.now() - Date.parse(previous.checked) < 7 * DAY;
  const found = resuming
    ? { calls: previous!.remaining! }
    : await findCalls(co.ticker, co.shortName);
  if (
    "error" in found &&
    found.error &&
    !found.calls.length &&
    !/^No transcripts found/.test(found.error)
  )
    throw new Error(found.error);
  const refs = mergeCalls(
    [],
    [...found.calls, ...(previous?.calls || []), ...(resuming ? [] : old?.calls || [])].filter(
      (r) => webUrl(co, r.url),
    ),
  );
  const calls: TranscriptRef[] = [];
  const remaining: TranscriptRef[] = [];
  let attempted = 0;
  for (const ref of refs) {
    let transcript = await storedWeb(co, ref.url);
    if (!transcript) {
      if (attempted >= limit) {
        remaining.push(ref);
        continue;
      }
      attempted++;
      if (await downloadWebTranscript(co, ref.url)) transcript = await storedWeb(co, ref.url);
    }
    if (transcript)
      calls.push({
        ...ref,
        date: transcript.date,
        publishedDate: transcript.publishedDate,
        dateBasis: transcript.dateBasis,
      });
  }
  const now = new Date().toISOString();
  const checked = resuming ? previous!.checked : now;
  const { error } = await supabaseAdmin
    .from("ai_cache")
    .upsert({ key, payload: { calls, remaining, checked } as never, created_at: now });
  if (error) throw new Error(error.message);
  return remaining.length;
}

/** Reuse the worker's quote-checked call analysis. Older existing briefs remain available as a fallback. */
export async function storedCallBrief(
  co: Co,
): Promise<{ brief: EarningsBrief | null; error?: string }> {
  const { calls } = await listCalls(co);
  const first = calls[0];
  if (first?.archiveKind) {
    const { entries } = await archiveIndex(co.ticker);
    const row = entries.find((r) => r.url === first.url);
    if (row?.summary) {
      const verification = await stored<{
        analysisAt: string | null;
        sourceHash: string;
        sourceUrl: string;
        quotes: {
          section: string;
          label: string | null;
          detail: string;
          turn: number;
          speaker: string;
        }[];
      }>(`issuer-evidence:v1:${co.ticker}:${row.archiveId}:${row.textHash}`);
      const quotes =
        verification &&
        verification.sourceHash === row.textHash &&
        verification.sourceUrl === row.url &&
        verification.analysisAt === row.analyzedAt
          ? verification.quotes
          : [];
      return {
        brief: {
          title: [
            row.quarter || row.date,
            row.archiveKind === "remarks" ? "prepared remarks" : "earnings call",
          ].join(" "),
          period: row.quarter || row.date!,
          summary: row.summary,
          highlights: quotes
            .filter((q) => q.section === "theme" && q.label)
            .slice(0, 6)
            .map((q) => ({ label: q.label!, detail: q.detail })),
          guidance: quotes
            .filter((q) => q.section === "guidance")
            .slice(0, 5)
            .map((q) => q.detail),
          analystQuestions: quotes
            .filter((q) => q.section === "question")
            .slice(0, 4)
            .map((q) => q.detail),
          sources: [{ title: co.shortName + " investor relations", url: row.url }],
          generatedAt: row.analyzedAt || row.generated,
        },
      };
    }
  }
  if (first) {
    const { transcript } = await loadTranscript(co, first.url);
    if (transcript) {
      const stats =
        transcript.statistics?.version === 1
          ? transcript.statistics
          : transcriptStatistics(transcript);
      const figures = stats.figures.slice(0, 4);
      const summary = stats.summary?.text;
      if (summary || figures.length)
        return {
          brief: {
            title: transcript.title,
            period: transcript.quarter || transcript.date!,
            summary: summary || "",
            highlights: figures.map((f) => ({ label: f.topic, detail: f.sentence })),
            guidance: [],
            analystQuestions: [],
            sources: [{ title: transcript.source, url: transcript.url }],
            generatedAt: transcript.fetchedAt,
          },
        };
    }
  }
  const previous = await stored<{ brief: EarningsBrief | null }>(`earnings-call:v1:${co.ticker}`);
  return previous?.brief
    ? previous
    : { brief: null, error: "A call brief is not available in the archive yet." };
}
