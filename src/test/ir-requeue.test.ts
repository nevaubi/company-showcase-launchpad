import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { rereadTickers, requeueReaderErrors, VISION_REVIEW_FILTER } from "../../scripts/lib/ir-requeue";

describe("reader retries within the same build", () => {
  it.each(["extract_status", "vision_status", "prose_status"] as const)(
    "atomically excludes held and output-limited files when resetting %s",
    async (field) => {
      let request: Request | undefined;
      const client = createClient("https://test.invalid", "test", {
        global: { fetch: async (url, init) => {
          request = new Request(url, init);
          return new Response(null, { status: 204, headers: { "Content-Range": "*/3" } });
        } },
      });
      expect(await requeueReaderErrors(client, "BAC", field)).toBe(3);
      const query = new URL(request!.url).searchParams;
      expect(request!.method).toBe("PATCH");
      expect(query.get("ticker")).toBe("eq.BAC");
      expect(query.getAll(field)).toEqual(["like.error:%", String.raw`not.ilike.%max\_output\_tokens%`]);
      expect(await request!.json()).toEqual(field === "extract_status"
        ? { extract_status: null, extracted_at: null }
        : field === "prose_status" ? { prose_status: null, prose_at: null } : { vision_status: null });
    },
  );
  it("counts held reviews and regular errors without counting held unread slides", () => {
    const prefixes = VISION_REVIEW_FILTER.split(",").map((term) => term.slice("vision_status.like.".length, -1));
    const counted = (status: string) => prefixes.some(prefix => status.startsWith(prefix));
    expect(counted("held:historical-vision:review | error: Response incomplete (max_output_tokens)")).toBe(true);
    expect(counted("held:historical-vision:unread")).toBe(false);
    expect(counted("error: rate limited")).toBe(true);
  });
});
const today = new Date("2026-11-19T00:00:00Z");
const row = (ticker: string, filed: string | null, fetched_at = "2026-11-19T08:00:00Z", kind = "press-release") => ({ ticker, filed, fetched_at, kind });
describe("finished-company re-read", () => {
  it("one new file filed in the last 30 days re-queues a finished company", () => {
    expect(rereadTickers(["AAPL"], [row("AAPL", "2026-11-18")], "2026-11-19T00:00:00Z", today).tickers).toEqual(["AAPL"]);
  });
  it("ignores files filed more than 30 days ago, files seen before, and unfinished companies", () => {
    const r = rereadTickers(["AAPL"], [row("AAPL", "2026-10-01"), row("AAPL", "2026-11-18", "2026-11-18T00:00:00Z"), row("MSFT", "2026-11-18")], "2026-11-18T12:00:00Z", today);
    expect(r.tickers).toEqual([]);
    expect(r.last).toBe("2026-11-19T08:00:00Z");
  });
  it("counts files from any source, but not SEC filing copies", () => {
    expect(rereadTickers(["X"], [row("X", "2026-11-18", undefined, "image")], "2026-11-19T00:00:00Z", today).tickers).toEqual(["X"]);
    expect(rereadTickers(["X"], [row("X", "2026-11-18", undefined, "sec-copy")], "2026-11-19T00:00:00Z", today).tickers).toEqual([]);
  });
});

import { isConfigFailure, requeueEnabled, requeueLimit, requeuePlan } from "../../scripts/lib/ir-requeue";
describe("configuration-failed re-queue", () => {
  it("matches only the stored configuration errors", () => {
    expect(isConfigFailure("error: OpenAI 400 invalid_value: Invalid model ID.")).toBe(true);
    expect(isConfigFailure("error: Escalation failed on page 7: OpenAI 400 invalid_value: Invalid model ID.")).toBe(true);
    expect(isConfigFailure("rendition failed: Invalid row number in model")).toBe(false);
    expect(isConfigFailure("error: pdftoppm exited with code 1")).toBe(false);
    expect(isConfigFailure("error: convert: no images defined")).toBe(false);
    expect(isConfigFailure("error: OpenAI 400 invalid_request_error: context too long")).toBe(false);
    expect(isConfigFailure("error: Model returned invalid JSON")).toBe(false);
    expect(isConfigFailure("ok 12 facts")).toBe(false);
    expect(isConfigFailure(null)).toBe(false);
  });
  it("resets top-ranked companies first, bounded per pass", () => {
    const rank = new Map([["NVDA", 1], ["AAPL", 2]]);
    const rows = [
      { id: "1", ticker: "TINY", status: "error: OpenAI 400 invalid_value: Invalid model ID." },
      { id: "2", ticker: "AAPL", status: "error: OpenAI 400 invalid_value: Invalid model ID." },
      { id: "3", ticker: "NVDA", status: "error: OpenAI 400 invalid_value: Invalid model ID." },
      { id: "4", ticker: "NVDA", status: "error: pdftoppm exited with code 1" },
      { id: "5", ticker: "AAPL", status: "error: OpenAI 400 invalid_value: Invalid model ID." },
    ];
    expect(requeuePlan(rows, rank, 10)).toEqual({ ids: ["3", "2", "5", "1"], tickers: ["NVDA", "AAPL", "TINY"] });
    expect(requeuePlan(rows, rank, 2).ids).toEqual(["3", "2"]);
  });
  it("is off unless switched on, and bounded", () => {
    expect(requeueEnabled({})).toBe(false);
    expect(requeueEnabled({ IR_REQUEUE_CONFIG: "1" })).toBe(true);
    expect(requeueLimit({})).toBe(2000);
    expect(requeueLimit({ IR_REQUEUE_CONFIG_MAX: "99999" })).toBe(5000);
  });
});
