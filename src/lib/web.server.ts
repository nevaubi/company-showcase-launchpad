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

/** Discover URLs on a site (Firecrawl map). Supports direct and gateway-backed keys. */
export async function firecrawlMap(url: string, opts: { search?: string; limit?: number } = {}): Promise<string[]> {
  const key = process.env["FIRECRAWL_API_KEY"];
  if (!key) throw new Error("Page reader is not configured");
  const gateway = key.startsWith("lovc_");
  const endpoint = gateway ? "https://connector-gateway.lovable.dev/firecrawl/v2/map" : "https://api.firecrawl.dev/v2/map";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (gateway) {
    headers["Authorization"] = `Bearer ${process.env["LOVABLE_API_KEY"] ?? ""}`;
    headers["X-Connection-Api-Key"] = key;
  } else headers["Authorization"] = `Bearer ${key}`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ url, search: opts.search, limit: opts.limit ?? 500, includeSubdomains: true }),
  });
  if (!res.ok) throw new Error(`Firecrawl map failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { links?: (string | { url: string })[]; data?: { links?: (string | { url: string })[] } };
  return (j.links ?? j.data?.links ?? []).map((l) => (typeof l === "string" ? l : l.url));
}

/** All links on a rendered page (Firecrawl scrape, `links` format) — finds JS-loaded IR file links. */
export async function firecrawlLinks(url: string): Promise<string[]> {
  const key = process.env["FIRECRAWL_API_KEY"];
  if (!key) throw new Error("Page reader is not configured");
  const gateway = key.startsWith("lovc_");
  const endpoint = gateway ? "https://connector-gateway.lovable.dev/firecrawl/v2/scrape" : "https://api.firecrawl.dev/v2/scrape";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (gateway) {
    headers["Authorization"] = `Bearer ${process.env["LOVABLE_API_KEY"] ?? ""}`;
    headers["X-Connection-Api-Key"] = key;
  } else headers["Authorization"] = `Bearer ${key}`;
  const res = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ url, formats: ["links"], waitFor: 2500, timeout: 45000 }) });
  if (!res.ok) throw new Error(`Firecrawl scrape failed (${res.status})`);
  const j = (await res.json()) as { data?: { links?: string[] }; links?: string[] };
  return j.data?.links ?? j.links ?? [];
}

function firecrawlReq(path: string, init: { method?: string; body?: unknown } = {}) {
  const key = process.env["FIRECRAWL_API_KEY"];
  if (!key) throw new Error("Page reader is not configured");
  const gateway = key.startsWith("lovc_");
  const base = gateway ? "https://connector-gateway.lovable.dev/firecrawl/v2" : "https://api.firecrawl.dev/v2";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (gateway) {
    headers["Authorization"] = `Bearer ${process.env["LOVABLE_API_KEY"] ?? ""}`;
    headers["X-Connection-Api-Key"] = key;
  } else headers["Authorization"] = `Bearer ${key}`;
  return fetch(`${base}${path}`, { method: init.method ?? "POST", headers, body: init.body ? JSON.stringify(init.body) : undefined });
}

async function okJson<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) {
    const body = await res.text();
    console.error(`${what} failed [${res.status}]: ${body}`);
    throw new Error(`${what} failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/** Structured extraction from one page (Firecrawl json format, prompt-driven). */
export async function firecrawlExtract(url: string, prompt: string): Promise<{ json: unknown; title?: string; url: string }> {
  const j = await okJson<{ data?: { json?: unknown; metadata?: { title?: string } }; json?: unknown }>(
    await firecrawlReq("/scrape", { body: { url, formats: [{ type: "json", prompt }], onlyMainContent: true, timeout: 50000 } }),
    "Extract",
  );
  return { json: j.data?.json ?? j.json ?? null, title: j.data?.metadata?.title, url };
}

/** Crawl a site (bounded): starts a job and polls for up to ~45s; returns what finished. */
export async function firecrawlCrawl(url: string, opts: { limit?: number; includePaths?: string[] } = {}): Promise<{ status: string; pages: { url: string; title?: string; markdown: string }[] }> {
  const start = await okJson<{ id?: string }>(
    await firecrawlReq("/crawl", { body: { url, limit: Math.min(opts.limit ?? 10, 25), maxDiscoveryDepth: 2, includePaths: opts.includePaths, scrapeOptions: { formats: ["markdown"], onlyMainContent: true } } }),
    "Crawl",
  );
  if (!start.id) throw new Error("Crawl did not start");
  type P = { status: string; data?: { markdown?: string; metadata?: { title?: string; sourceURL?: string; url?: string } }[] };
  let last: P = { status: "scraping" };
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    last = await okJson<P>(await firecrawlReq(`/crawl/${start.id}`, { method: "GET" }), "Crawl status");
    if (last.status === "completed" || last.status === "failed") break;
  }
  return {
    status: last.status,
    pages: (last.data ?? []).map((d) => ({ url: d.metadata?.sourceURL ?? d.metadata?.url ?? url, title: d.metadata?.title, markdown: d.markdown ?? "" })),
  };
}

const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|\[?f[cd])/i;

/** Raw HTTP GET for public APIs/JSON/CSV/text (no JS rendering). Blocks private hosts. */
export async function fetchPublic(url: string): Promise<{ status: number; contentType: string; body: string; url: string }> {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol) || PRIVATE_HOST.test(u.hostname)) throw new Error("Only public http(s) URLs are allowed");
  const res = await fetch(u, { headers: { "User-Agent": "FiledUnder research admin@filedunder.ai", Accept: "application/json, text/csv, text/plain, text/html;q=0.8, */*;q=0.5" }, redirect: "follow", signal: AbortSignal.timeout(20000) });
  const contentType = res.headers.get("content-type") ?? "";
  if (/image|video|audio|octet-stream|pdf|zip/.test(contentType)) return { status: res.status, contentType, body: `(binary ${contentType}; use read_webpage for PDFs)`, url: res.url };
  const text = await res.text();
  return { status: res.status, contentType, body: text.slice(0, 120_000), url: res.url };
}
