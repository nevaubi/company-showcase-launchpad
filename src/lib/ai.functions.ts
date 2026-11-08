import { requireAppAccess } from "@/lib/app-access-middleware";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchYahooNews, type NewsItem } from "@/lib/market.functions";

export interface Narrative {
  title: string;
  summary: string;
  sentiment: "bullish" | "bearish" | "mixed";
  headlineIds: string[];
}

const tickerSchema = z.string().regex(/^[A-Z.]{1,6}$/);

const NARRATIVE_ITEM = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "sentiment", "headlineIds"],
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    sentiment: { type: "string", enum: ["bullish", "bearish", "mixed"] },
    headlineIds: { type: "array", items: { type: "string" } },
  },
} as const;

type StructuredFn = typeof import("@/lib/ai.server").structured;

/** When the headline feed is unavailable, let the model gather recent coverage with hosted web search. */
async function webNarratives(ticker: string, name: string, structured: StructuredFn) {
  const today = new Date().toISOString().slice(0, 10);
  const out = await structured<{
    narratives: Narrative[];
    headlines: { id: string; title: string; publisher: string; url: string; date: string }[];
  }>({
    name: "narratives_web",
    tools: [{ type: "web_search" }],
    instructions:
      "You are an equity research editor. Search the web for news coverage of the company from the last 30 days (earnings, guidance, products, regulation, analyst moves). List 6-12 real articles you actually found, with their exact URLs, publisher and publish date (YYYY-MM-DD), ids h1..hN. Then cluster them into the 3-4 narratives driving the stock now. Be specific and factual; use only what the articles say. Each summary is one or two plain sentences. Cite the headline ids that support each narrative. Never put URLs, markdown links or source names in parentheses inside titles or summaries — sources go only in the headlines list.",
    input: `Company: ${name} (${ticker})\nToday: ${today}`,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["narratives", "headlines"],
      properties: {
        narratives: { type: "array", items: NARRATIVE_ITEM },
        headlines: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "title", "publisher", "url", "date"],
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              publisher: { type: "string" },
              url: { type: "string" },
              date: { type: "string" },
            },
          },
        },
      },
    },
  });
  const news: NewsItem[] = out.headlines
    .filter((h) => /^https?:\/\//.test(h.url))
    .map((h) => ({
      id: h.id,
      title: h.title,
      publisher: h.publisher,
      link: h.url,
      publishedAt: Number.isNaN(Date.parse(h.date)) ? today : new Date(h.date).toISOString(),
      tickers: [ticker],
    }));
  const clean = (t: string) =>
    t
      .replace(/\s*\(\[[^\]]*\]\([^)]*\)\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\s*\(https?:\/\/[^)]*\)/g, "")
      .trim();
  const ids = new Set(news.map((n) => n.id));
  const narratives = out.narratives.slice(0, 4).map((n) => ({ ...n, title: clean(n.title), summary: clean(n.summary), headlineIds: n.headlineIds.filter((id) => ids.has(id)) }));
  return { narratives, news, via: "web" as const };
}

export const getNarratives = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .inputValidator((d: unknown) => z.object({ ticker: tickerSchema, name: z.string().max(80) }).parse(d))
  .handler(async ({ data }) => {
    const { cached, structured } = await import("@/lib/ai.server");
    const bucket = new Date().toISOString().slice(0, 13).replace(/T(\d\d)$/, (_, h) => `T${String(Math.floor(Number(h) / 6) * 6).padStart(2, "0")}`);
    return cached(`narratives:v3:${data.ticker}:${bucket}`, 6 * 3600_000, async () => {
      let news: NewsItem[] = [];
      try {
        news = await fetchYahooNews(data.ticker, 16);
      } catch {
        news = [];
      }
      let via: "feed" | "web" = "feed";
      if (!news.length) {
        try {
          const { tavilySearch } = await import("@/lib/web.server");
          const r = await tavilySearch(`${data.name} ${data.ticker} stock`, { topic: "news", days: 21, maxResults: 14, depth: "basic" });
          news = r.results.map((x, i) => ({
            id: `w${i + 1}`,
            title: x.title,
            publisher: new URL(x.url).hostname.replace(/^www\./, ""),
            link: x.url,
            publishedAt: x.publishedAt && !Number.isNaN(Date.parse(x.publishedAt)) ? new Date(x.publishedAt).toISOString() : new Date().toISOString(),
            tickers: [data.ticker],
          }));
          via = "web";
        } catch {
          news = [];
        }
      }
      if (!news.length) return webNarratives(data.ticker, data.name, structured);
      const list = news.map((n) => `[${n.id}] ${n.publishedAt.slice(0, 10)} · ${n.publisher}: ${n.title}`).join("\n");
      const out = await structured<{ narratives: Narrative[] }>({
        name: "narratives",
        instructions:
          "You are an equity research editor. Cluster recent headlines about a company into the 3-4 narratives driving the stock right now. Be specific and factual; only use information present in the headlines. Each summary is one or two plain sentences. Cite the headline ids that support each narrative.",
        input: `Company: ${data.name} (${data.ticker})\nHeadlines:\n${list}`,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["narratives"],
          properties: {
            narratives: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["title", "summary", "sentiment", "headlineIds"],
                properties: {
                  title: { type: "string" },
                  summary: { type: "string" },
                  sentiment: { type: "string", enum: ["bullish", "bearish", "mixed"] },
                  headlineIds: { type: "array", items: { type: "string" } },
                },
              },
            },
          },
        },
      });
      return { narratives: out.narratives.slice(0, 4), news, via };
    });
  });

export const getChartInsight = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .inputValidator((d: unknown) =>
    z
      .object({
        symbol: z.string().max(12),
        asOf: z.string().max(30),
        stats: z.record(z.string().max(40), z.union([z.number(), z.string().max(80), z.null()])).refine((r) => Object.keys(r).length <= 40),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { cached, structured } = await import("@/lib/ai.server");
    return cached(`chart:${data.symbol}:${data.asOf}`, 3 * 3600_000, async () =>
      structured<{ headline: string; bullets: string[]; levels: { label: string; value: string }[]; bias: "bullish" | "bearish" | "neutral" }>({
        name: "chart_insight",
        instructions:
          "You are a technical analyst. Using only the computed statistics provided, write a concise read of the chart: trend, momentum, volatility, relative strength vs. the benchmark, and how the stock has reacted around earnings. Never invent numbers; quote the ones given. 3-5 bullets, each under 30 words.",
        input: `Symbol: ${data.symbol}\nAs of: ${data.asOf}\nStatistics (JSON): ${JSON.stringify(data.stats)}`,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["headline", "bullets", "levels", "bias"],
          properties: {
            headline: { type: "string" },
            bullets: { type: "array", items: { type: "string" } },
            levels: {
              type: "array",
              items: { type: "object", additionalProperties: false, required: ["label", "value"], properties: { label: { type: "string" }, value: { type: "string" } } },
            },
            bias: { type: "string", enum: ["bullish", "bearish", "neutral"] },
          },
        },
      }),
    );
  });

export const getMacroBrief = createServerFn({ method: "POST" })
  .middleware([requireAppAccess])
  .inputValidator((d: unknown) =>
    z
      .object({
        asOf: z.string().max(30),
        readings: z
          .array(z.object({ id: z.string().max(30), title: z.string().max(140), latest: z.string().max(40), date: z.string().max(12), change: z.string().max(160) }))
          .max(160),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { cached, structured } = await import("@/lib/ai.server");
    return cached(`macro:${data.asOf}`, 6 * 3600_000, async () =>
      structured<{ headline: string; regime: string; sections: { title: string; body: string; seriesIds: string[] }[] }>({
        name: "macro_brief",
        instructions:
          "You are a macro strategist writing a morning brief for equity investors. Use only the U.S. government and Federal Reserve readings provided (latest value, date, change, year-ago value and where the reading sits in its 10-year range). Cover rates & curve, inflation, labor, growth & the consumer, liquidity & credit, fiscal and energy, and what it implies for US equities and sectors. Plain, specific sentences with numbers. Cite the series ids you used in each section.",
        input: `Readings as of ${data.asOf}:\n${data.readings.map((r) => `${r.id} — ${r.title}: ${r.latest} (${r.date}); ${r.change}`).join("\n")}`,
        effort: "medium",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["headline", "regime", "sections"],
          properties: {
            headline: { type: "string" },
            regime: { type: "string" },
            sections: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["title", "body", "seriesIds"],
                properties: { title: { type: "string" }, body: { type: "string" }, seriesIds: { type: "array", items: { type: "string" } } },
              },
            },
          },
        },
      }),
    );
  });
