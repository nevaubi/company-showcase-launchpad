// Server-only web research providers: Tavily (search) and Firecrawl (page reading).
// Keys are read from process.env inside each call.

export interface WebResult {
  title: string;
  url: string;
  content: string;
  publishedAt?: string;
  score?: number;
}

export async function tavilySearch(
  query: string,
  opts: { topic?: "general" | "news" | "finance"; days?: number; maxResults?: number; domains?: string[]; depth?: "basic" | "advanced" } = {},
): Promise<{ answer?: string; results: WebResult[] }> {
  const key = process.env["TAVILY_API_KEY"];
  if (!key) throw new Error("Web search is not configured");
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      query,
      topic: opts.topic ?? "general",
      search_depth: opts.depth ?? "advanced",
      max_results: opts.maxResults ?? 8,
      include_answer: false,
      ...(opts.days ? { days: opts.days } : {}),
      ...(opts.domains?.length ? { include_domains: opts.domains } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`Tavily failed [${res.status}]: ${body}`);
    throw new Error(`Web search failed (${res.status})`);
  }
  const j = (await res.json()) as { answer?: string; results?: { title: string; url: string; content: string; published_date?: string; score?: number }[] };
  return {
    answer: j.answer,
    results: (j.results ?? []).map((r) => ({ title: r.title, url: r.url, content: r.content, publishedAt: r.published_date, score: r.score })),
  };
}

/** Scrape a page to markdown. Supports both direct (fc-) and gateway-backed (lovc_) Firecrawl keys. */
export async function firecrawlScrape(url: string): Promise<{ markdown: string; title?: string; url: string }> {
  const key = process.env["FIRECRAWL_API_KEY"];
  if (!key) throw new Error("Page reader is not configured");
  const gateway = key.startsWith("lovc_");
  const endpoint = gateway ? "https://connector-gateway.lovable.dev/firecrawl/v2/scrape" : "https://api.firecrawl.dev/v2/scrape";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (gateway) {
    headers["Authorization"] = `Bearer ${process.env["LOVABLE_API_KEY"] ?? ""}`;
    headers["X-Connection-Api-Key"] = key;
  } else headers["Authorization"] = `Bearer ${key}`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true, timeout: 45000 }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`Firecrawl failed [${res.status}]: ${body}`);
    throw new Error(`Couldn't read that page (${res.status})`);
  }
  const j = (await res.json()) as { data?: { markdown?: string; metadata?: { title?: string; sourceURL?: string } }; markdown?: string; metadata?: { title?: string } };
  const markdown = j.data?.markdown ?? j.markdown ?? "";
  return { markdown, title: j.data?.metadata?.title ?? j.metadata?.title, url };
}
