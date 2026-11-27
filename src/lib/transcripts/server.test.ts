import { beforeEach, describe, expect, it, vi } from "vitest";
const ctx = vi.hoisted(() => ({
  rows: new Map<string, unknown>(),
  cache: new Map<string, unknown>(),
  jobs: [] as string[],
  searches: vi.fn(),
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
vi.mock("@/lib/web.server", () => ({ tavilySearch: ctx.searches, firecrawlScrape: ctx.scrapes }));
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
    ctx.cache.clear();
    ctx.rows.clear();
    ctx.jobs.length = 0;
    vi.stubEnv("PARTNER_DATA_KEY", "test-server-key");
  });
  it("loads the index and speaker turns once across repeated cold client requests, reuses the brief", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", async (raw: string, opts: RequestInit) => {
      const path = new URL(raw).searchParams.get("path")!;
      expect(opts.headers).toEqual({ "x-partner-key": "test-server-key" });
      requests.push(path);
      return Response.json(
        path === "calls/JPM.json"
          ? index
          : {
              call_id: id,
              turns: [{ i: 0, sp: 0, sec: "prepared", x: "Deposits increased.", w: 2 }],
            },
      );
    });
    for (let i = 0; i < 2; i++) {
      const list = await listCalls(co);
      expect(list.calls.map((c) => c.url)).toEqual([original]);
      expect((await loadTranscript(co, original)).transcript?.turns[0].text).toBe(
        "Deposits increased.",
      );
      expect((await storedCallBrief(co)).brief?.summary).toBe("Deposits increased.");
    }
    expect(requests).toEqual(["calls/JPM.json", `calls/JPM/${id}.json`]);
    expect((await loadTranscript(co, "https://other.example/source")).transcript).toBeNull();
    expect(requests.length).toBe(2);
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
