import { beforeEach, describe, expect, it, vi } from "vitest";
const ctx = vi.hoisted(() => ({
  rows: new Map<string, unknown>(),
  cache: new Map<string, unknown>(),
  jobs: [] as string[],
  searches: vi.fn(),
  fireSearch: vi.fn(),
  scrapes: vi.fn(),
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (name: string) => ({
      select: () => ({
        eq: (_col: string, key: string) => ({
          maybeSingle: async () => ({
            data: ctx.rows.has(key) ? { payload: ctx.rows.get(key) } : null,
            error: null,
          }),
        }),
        like: (_col: string, pattern: string) => ({
          order: () => ({
            range: async (from: number, to: number) => ({
              data: [...ctx.rows.keys()]
                .filter((k) => k.startsWith(pattern.slice(0, -1)))
                .sort()
                .slice(from, to + 1)
                .map((key) => ({ key })),
              error: null,
            }),
          }),
        }),
        in: (_col: string, keys: string[]) => {
          const rows = keys
            .filter((k) => ctx.rows.has(k))
            .map((key) => ({ key, payload: ctx.rows.get(key) }));
          return { data: rows, error: null, order: async () => ({ data: rows, error: null }) };
        },
      }),
      upsert: async ({ job, key, payload }: { job: string; key: string; payload: unknown }) => {
        if (name === "ai_cache") ctx.rows.set(key, payload);
        if (name === "job_state") ctx.jobs.push(job);
        return { error: null };
      },
    }),
  },
}));
vi.mock("@/lib/web.server", () => ({
  tavilySearch: ctx.searches,
  firecrawlTranscriptUrls: ctx.fireSearch,
  firecrawlScrape: ctx.scrapes,
}));
vi.mock("@/lib/ai.server", () => ({
  cached: async (key: string, _ttl: number, fn: () => Promise<unknown>) => {
    if (!ctx.cache.has(key)) ctx.cache.set(key, await fn());
    return ctx.cache.get(key);
  },
}));
import { listCalls, loadTranscript, storedCallBrief, refreshWebCalls } from "../transcripts.server";
const co = { ticker: "JPM", shortName: "JPMorgan Chase" };
const original = "https://ir.example.com/Q3.pdf";
const id = "JPM-2026-10-13-abc123";
const index = {
  ticker: "JPM",
  generated: "2026-10-14",
  docs: { a: { url: original, fiscal_label: "Q3 FY26" } },
  calls: [
    {
      call_id: id,
      ticker: "JPM",
      event_type: "earnings",
      kind: "transcript",
      doc: "a",
      date: "2026-10-13",
      sha: "1234",
      summary: "Deposits increased.",
      speakers: [
        {
          idx: 0,
          name: "Test Officer",
          role: "CEO",
          kind: "management",
          words: 2,
          turns: 1,
          firm: null,
        },
      ],
    },
  ],
};
describe("archive-only page requests", () => {
  beforeEach(() => {
    ctx.searches.mockReset();
    ctx.scrapes.mockReset();
    ctx.fireSearch.mockReset();
    vi.stubEnv("TAVILY_API_KEY", "test-search");
    ctx.cache.clear();
    ctx.rows.clear();
    ctx.jobs.length = 0;
    vi.stubEnv("PARTNER_DATA_KEY", "test-server-key");
  });
  it("loads the index and speaker turns once across repeated cold client requests, reuses the brief", async () => {
    const external = vi.fn(async () => {
      throw new Error("External fetch on a page read");
    });
    vi.stubGlobal("fetch", external);
    ctx.rows.set("issuer-index:v1:JPM", { bundle: index, sha256: "index" });
    ctx.rows.set(`issuer-turns:v1:JPM:${id}:1234`, {
      ticker: "JPM",
      kind: "transcript",
      sourceHash: "1234",
      sourceUrl: original,
      sha256: "turns",
      file: {
        call_id: id,
        turns: [{ i: 0, sp: 0, sec: "prepared", x: "Deposits increased.", w: 2 }],
      },
    });
    ctx.rows.set(`issuer-evidence:v1:JPM:${id}:1234`, {
      analysisAt: null,
      sourceHash: "1234",
      sourceUrl: original,
      quotes: [
        {
          section: "theme",
          label: "Funding",
          detail: "Deposits increased.",
          turn: 0,
          speaker: "Test Officer",
        },
      ],
    });
    for (let i = 0; i < 2; i++) {
      const list = await listCalls(co);
      expect(list.calls.map((c) => c.url)).toEqual([original]);
      expect((await loadTranscript(co, original)).transcript?.turns[0].text).toBe(
        "Deposits increased.",
      );
      expect((await storedCallBrief(co)).brief).toMatchObject({
        summary: "Deposits increased.",
        highlights: [{ label: "Funding", detail: "Deposits increased." }],
      });
    }
    expect(external).not.toHaveBeenCalled();
    expect((await loadTranscript(co, "https://other.example/source")).transcript).toBeNull();
    expect(external).not.toHaveBeenCalled();
  });
  it("finishes later download batches without repeating discovery or downloading earlier quarters again", async () => {
    const refs = [1, 2, 3, 4].map((q) => ({
      url: `https://www.fool.com/earnings/call-transcripts/2026/10/13/jpmorgan-chase-jpm-q${q}-2026-earnings-call-transcript`,
    }));
    ctx.searches.mockResolvedValue({ results: refs });
    ctx.scrapes.mockImplementation(async (url: string) => ({
      url,
      markdown:
        "## Prepared Remarks\n\n**Operator:** Good afternoon everyone.\n\n**Jane Doe:** First quarter sales increased.\n\n**Sam Smith:** We reported income yesterday.\n\n**Operator:** Please proceed with questions.\n\n**Jane Doe:** Thank you for joining.",
    }));
    expect(await refreshWebCalls(co)).toBe(1);
    expect(ctx.scrapes).toHaveBeenCalledTimes(3);
    expect(await refreshWebCalls(co)).toBe(0);
    expect(ctx.scrapes).toHaveBeenCalledTimes(4);
    expect(ctx.searches).toHaveBeenCalledTimes(3);
    expect(ctx.rows.get("call-web-ready:v1:JPM")).toMatchObject({
      calls: expect.arrayContaining(refs.map((r) => expect.objectContaining(r))),
      remaining: [],
    });
  });
  it.each([
    ["fc-test", "https://api.firecrawl.dev/v2"],
    ["lovc_test", "https://connector-gateway.lovable.dev/firecrawl/v2"],
  ])(
    "discovers and stores a verified publisher transcript using only Firecrawl (%s)",
    async (key, base) => {
      vi.stubEnv("TAVILY_API_KEY", "");
      vi.stubEnv("FIRECRAWL_API_KEY", key);
      vi.stubEnv("LOVABLE_API_KEY", "test-gateway");
      const url =
        "https://www.fool.com/earnings/call-transcripts/2026/10/13/jpmorgan-chase-jpm-q3-2026-earnings-call-transcript";
      const actual = await vi.importActual<typeof import("@/lib/web.server")>("@/lib/web.server");
      ctx.fireSearch.mockImplementation(actual.firecrawlTranscriptUrls);
      ctx.scrapes.mockImplementation(actual.firecrawlScrape);
      const fetcher = vi.fn(async (path: string, init: RequestInit) => {
        expect(init.signal).toBeInstanceOf(AbortSignal);
        const body = JSON.parse(init.body as string);
        if (path === base + "/search") {
          expect(body).toMatchObject({ includeDomains: ["fool.com"], sources: ["web"] });
          return Response.json({
            success: true,
            data: {
              web: [
                { url: url.replace("www.fool.com", "other.example") },
                { url: url.replace("jpmorgan-chase-jpm", "citigroup-c") },
                { url },
              ],
            },
          });
        }
        expect(path).toBe(base + "/scrape");
        expect(body.url).toBe(url);
        return Response.json({
          data: {
            metadata: { sourceURL: url },
            markdown:
              "## Prepared Remarks\n\n**Operator:** Welcome, everyone.\n\n**Jane Doe:** Sales increased.\n\n**Sam Smith:** The quarter ended yesterday.\n\n**Operator:** Please proceed.\n\n**Jane Doe:** Thank you.",
          },
        });
      });
      vi.stubGlobal("fetch", fetcher);
      expect(await refreshWebCalls(co)).toBe(0);
      expect(ctx.rows.get("call-web-ready:v1:JPM")).toMatchObject({
        calls: [expect.objectContaining({ url })],
      });
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(ctx.searches).not.toHaveBeenCalled();
    },
  );
  it("filters the historical AAPL/APLE mismatch before any download and queues an empty catalog", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 404 }));
    const url =
      "https://www.fool.com/earnings/call-transcripts/2026/11/06/apple-hospitality-aple-q3-2026-earnings-call-transcript";
    ctx.rows.set("calls:v1:AAPL", { calls: [{ url, date: "2026-11-06" }] });
    expect((await listCalls({ shortName: "Apple", ticker: "AAPL" })).calls).toEqual([]);
    expect(ctx.jobs).toContain("call-archive-demand:AAPL");
    expect(
      (await loadTranscript({ shortName: "Apple", ticker: "AAPL" }, url)).transcript,
    ).toBeNull();
  });
});
