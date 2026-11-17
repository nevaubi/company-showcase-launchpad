import { describe, expect, it } from "vitest";
import { ftdRows, latestLikelyPeriod, nextPeriod, parseFtd, periodEnd, prevPeriod, unzipText } from "./ftd";
import { readFileSync, existsSync } from "node:fs";

const TEXT = `SETTLEMENT DATE|CUSIP|SYMBOL|QUANTITY (FAILS)|DESCRIPTION|PRICE
20261001|1|AAPL|1000|APPLE INC|250.00
20261002|1|AAPL|3000|APPLE INC|252.00
20261002|2|ZZZZ|5|NOT COVERED|1
20261005|3|BRK.B|10|BERKSHIRE|500
Trailer record count 4`;

describe("fails to deliver", () => {
  it("aggregates covered stocks per half-month with the peak day", () => {
    const [a, b] = parseFtd(TEXT, "202610a", new Set(["AAPL", "BRK-B"]));
    expect(a).toMatchObject({ ticker: "AAPL", days: 2, shares: 4000, value: 1000 * 250 + 3000 * 252, peakShares: 3000, peakDate: "2026-10-02" });
    expect(b.ticker).toBe("BRK-B");
    const [row] = ftdRows([a]);
    expect(row).toMatchObject({ uid: "ftd:AAPL:202610a", date: "2026-10-15", value: 1006000, dataset: "settlement" });
  });
  it("steps half-months across year ends", () => {
    expect(nextPeriod("202612b")).toBe("202701a");
    expect(prevPeriod("202701a")).toBe("202612b");
    expect(periodEnd("202602b")).toBe("2026-02-28");
    expect(latestLikelyPeriod(new Date("2026-11-17T00:00:00Z"))).toBe("202610b"); // Oct 16–31 ended 17 days ago
    expect(latestLikelyPeriod(new Date("2026-11-10T00:00:00Z"))).toBe("202610a");
  });
  it("reads the SEC zip format", async () => {
    if (!existsSync("/tmp/ftd.zip")) return;
    const text = await unzipText(new Uint8Array(readFileSync("/tmp/ftd.zip")));
    expect(text.startsWith("SETTLEMENT DATE|CUSIP|SYMBOL")).toBe(true);
  });
});
