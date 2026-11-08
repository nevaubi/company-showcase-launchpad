import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { coverageOf } from "@/lib/coverage";

/** Web search (Tavily) for signed-in users. */
export const webSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        query: z.string().min(2).max(400),
        topic: z.enum(["general", "news", "finance"]).default("general"),
        days: z.number().int().min(1).max(365).optional(),
        maxResults: z.number().int().min(1).max(15).default(8),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { tavilySearch } = await import("@/lib/web.server");
    try {
      return await tavilySearch(data.query, data);
    } catch (e) {
      return { results: [], error: (e as Error).message };
    }
  });

/** Read one web page as markdown (Firecrawl). */
export const readWebpage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ url: z.string().url().max(2000) }).parse(d))
  .handler(async ({ data }) => {
    const { firecrawlScrape } = await import("@/lib/web.server");
    try {
      const r = await firecrawlScrape(data.url);
      return { ...r, markdown: r.markdown.slice(0, 40000) };
    } catch (e) {
      return { url: data.url, markdown: "", error: (e as Error).message };
    }
  });

export interface EarningsBrief {
  title: string;
  period: string;
  summary: string;
  highlights: { label: string; detail: string }[];
  guidance: string[];
  analystQuestions: string[];
  sources: { title: string; url: string }[];
  generatedAt: string;
}

/**
 * Latest earnings call brief: Tavily finds call coverage / transcripts / IR pages,
 * Firecrawl reads the best pages, the AI writes a sourced brief. Cached per ticker for 12h.
 */
export const getEarningsCallBrief = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ ticker: z.string().min(1).max(8), refresh: z.boolean().default(false) }).parse(d))
  .handler(async ({ data }): Promise<{ brief: EarningsBrief | null; error?: string }> => {
    const co = coverageOf(data.ticker);
    if (!co) return { brief: null, error: "Not a covered company" };
    const { cached } = await import("@/lib/ai.server");
    const key = `earnings-call:v1:${co.ticker}${data.refresh ? `:${Date.now()}` : ""}`;
    return cached(key, 12 * 3600_000, () => buildBrief(co));
  });

async function buildBrief(co: NonNullable<ReturnType<typeof coverageOf>>): Promise<{ brief: EarningsBrief | null; error?: string }> {
    const { tavilySearch, firecrawlScrape } = await import("@/lib/web.server");
    const { structured } = await import("@/lib/ai.server");
    try {
      const { coverageDetails } = await import("@/lib/coverage-details.server");
      const irSite = co.ir || coverageDetails(co.ticker).ir || "";
      const irHost = irSite ? new URL(irSite).hostname : null;
      const [calls, ir] = await Promise.all([
        tavilySearch(`${co.shortName} ${co.ticker} latest quarterly earnings call transcript highlights guidance`, { topic: "news", days: 120, maxResults: 8 }),
        irHost
          ? tavilySearch(`${co.shortName} quarterly results press release`, { maxResults: 4, domains: [irHost] }).catch(() => ({ results: [] }))
          : Promise.resolve({ results: [] as Awaited<ReturnType<typeof tavilySearch>>["results"] }),
      ]);
      const ranked = [...ir.results, ...calls.results].filter((r, i, a) => a.findIndex((x) => x.url === r.url) === i);
      if (!ranked.length) return { brief: null, error: "No recent earnings call coverage found" };
      const toRead = ranked.slice(0, 3);
      const pages = await Promise.all(
        toRead.map((r) => firecrawlScrape(r.url).then((p) => ({ ...r, body: p.markdown.slice(0, 14000) })).catch(() => ({ ...r, body: r.content }))),
      );
      const corpus = [
        ...pages.map((p, i) => `[S${i + 1}] ${p.title} — ${p.url}\n${p.body}`),
        ...ranked.slice(3, 9).map((r, i) => `[S${i + 4}] ${r.title} — ${r.url}${r.publishedAt ? ` (${r.publishedAt})` : ""}\n${r.content}`),
      ].join("\n\n---\n\n");
      const out = await structured<Omit<EarningsBrief, "sources" | "generatedAt"> & { sourceIdx: number[] }>({
        name: "earnings_brief",
        instructions: `You are an equity analyst. From the sources below, write a brief on ${co.shortName}'s (${co.ticker}) MOST RECENT quarterly earnings call/results only. Use only facts stated in the sources; quote numbers exactly with their period. If sources disagree, prefer the company's own release. No markdown links. sourceIdx lists the S-numbers (as integers) you relied on.`,
        input: corpus,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["title", "period", "summary", "highlights", "guidance", "analystQuestions", "sourceIdx"],
          properties: {
            title: { type: "string", description: "e.g. 'Q3 FY2026 earnings call'" },
            period: { type: "string" },
            summary: { type: "string", description: "3-4 sentence overview" },
            highlights: {
              type: "array",
              items: { type: "object", additionalProperties: false, required: ["label", "detail"], properties: { label: { type: "string" }, detail: { type: "string" } } },
            },
            guidance: { type: "array", items: { type: "string" } },
            analystQuestions: { type: "array", items: { type: "string" }, description: "Key topics analysts pressed management on" },
            sourceIdx: { type: "array", items: { type: "integer" } },
          },
        },
      });
      const all = [...pages, ...ranked.slice(3, 9)];
      const used = (out.sourceIdx ?? []).map((n) => all[n - 1]).filter(Boolean);
      const brief: EarningsBrief = {
        title: out.title,
        period: out.period,
        summary: out.summary,
        highlights: out.highlights.slice(0, 8),
        guidance: out.guidance.slice(0, 6),
        analystQuestions: out.analystQuestions.slice(0, 6),
        sources: (used.length ? used : all.slice(0, 4)).map((s) => ({ title: s.title, url: s.url })),
        generatedAt: new Date().toISOString(),
      };
      return { brief };
    } catch (e) {
      console.error("earnings brief failed", e);
      return { brief: null, error: (e as Error).message };
    }
}

const errOut = (e: unknown) => ({ error: (e as Error).message });

/** Discover URLs on a site (Firecrawl map). */
export const mapSite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ url: z.string().url().max(2000), search: z.string().max(200).optional(), limit: z.number().int().min(1).max(500).default(100) }).parse(d))
  .handler(async ({ data }) => {
    const { firecrawlMap } = await import("@/lib/web.server");
    try {
      return { links: (await firecrawlMap(data.url, { search: data.search, limit: data.limit })).slice(0, data.limit) };
    } catch (e) {
      return { links: [] as string[], ...errOut(e) };
    }
  });

/** Bounded multi-page crawl (Firecrawl crawl). */
export const crawlSite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ url: z.string().url().max(2000), limit: z.number().int().min(1).max(25).default(8), includePaths: z.array(z.string().max(200)).max(10).optional() }).parse(d))
  .handler(async ({ data }) => {
    const { firecrawlCrawl } = await import("@/lib/web.server");
    try {
      const r = await firecrawlCrawl(data.url, data);
      return { status: r.status, pages: r.pages.map((p) => ({ ...p, markdown: p.markdown.slice(0, 8000) })) };
    } catch (e) {
      return { status: "failed", pages: [] as { url: string; title?: string; markdown: string }[], ...errOut(e) };
    }
  });

/** Prompted structured extraction from a page (Firecrawl json). */
export const extractFromPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ url: z.string().url().max(2000), prompt: z.string().min(3).max(2000) }).parse(d))
  .handler(async ({ data }) => {
    const { firecrawlExtract } = await import("@/lib/web.server");
    try {
      const r = await firecrawlExtract(data.url, data.prompt);
      return { url: r.url, title: r.title, json: JSON.stringify(r.json) };
    } catch (e) {
      return { url: data.url, json: "", ...errOut(e) };
    }
  });

/** Raw GET of a public URL (APIs, JSON, CSV). */
export const fetchUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ url: z.string().url().max(2000) }).parse(d))
  .handler(async ({ data }) => {
    const { fetchPublic } = await import("@/lib/web.server");
    try {
      return await fetchPublic(data.url);
    } catch (e) {
      return { status: 0, contentType: "", body: "", url: data.url, ...errOut(e) };
    }
  });
