import { describe, expect, it } from "vitest";
import { rereadTickers } from "../../scripts/lib/ir-requeue";
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
