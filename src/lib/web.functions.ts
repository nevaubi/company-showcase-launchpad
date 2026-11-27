import { requireAppAccess, requireFeature } from "@/lib/app-access-middleware";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { coverageOf } from "@/lib/coverage";

/** Web search (Tavily) for signed-in users. */
export const webSearch = createServerFn({ method: "POST" })
  .middleware([requireFeature("web_research")])
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
  .middleware([requireFeature("web_research")])
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

/** Read the latest stored call brief. */
export const getEarningsCallBrief = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .inputValidator((d: unknown) => z.object({ ticker: z.string().min(1).max(8), refresh: z.boolean().default(false) }).parse(d))
  .handler(async ({ data }): Promise<{ brief: EarningsBrief | null; error?: string }> => {
    const co = coverageOf(data.ticker);
    if (!co) return { brief: null, error: "Not a covered company" };
    const { storedCallBrief } = await import("@/lib/transcripts.server");
    return storedCallBrief(co);
  });

const errOut = (e: unknown) => ({ error: (e as Error).message });

/** Discover URLs on a site (Firecrawl map). */
export const mapSite = createServerFn({ method: "POST" })
  .middleware([requireFeature("web_research")])
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
  .middleware([requireFeature("web_research")])
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
  .middleware([requireFeature("web_research")])
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
  .middleware([requireFeature("web_research")])
  .inputValidator((d: unknown) => z.object({ url: z.string().url().max(2000) }).parse(d))
  .handler(async ({ data }) => {
    const { fetchPublic } = await import("@/lib/web.server");
    try {
      return await fetchPublic(data.url);
    } catch (e) {
      return { status: 0, contentType: "", body: "", url: data.url, ...errOut(e) };
    }
  });
