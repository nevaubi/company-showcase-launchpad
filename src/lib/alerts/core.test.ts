import { describe, expect, it } from "vitest";
import { buildAlerts, type AlertInputs } from "./core";

const base: AlertInputs = { tickers: ["NVDA"], since: "2026-01-01", filings: [], insiders: [], links: [], alt: [], ideas: [] };
const rl = (o: Partial<NonNullable<AlertInputs["redlines"]>[number]>) => ({
  ticker: "NVDA", form: "10-K", to_accn: "0001045810-26-000021", to_filed: "2026-02-25", high: 0, medium: 0,
  stats: [{ title: "Risk factors", high: 17, found: "both" }, { title: "MD&A", high: 1, found: "both" }], ...o,
});

describe("filing-change alerts", () => {
  it("alerts when a new 10-K has high-materiality wording changes, naming the sections", () => {
    const a = buildAlerts({ ...base, redlines: [rl({ high: 18 })] });
    expect(a).toHaveLength(1);
    expect(a[0].title).toBe("10-K wording changes: 18 high-materiality vs last year's report");
    expect(a[0].detail).toBe("Risk factors 17 · MD&A 1");
    expect(a[0].redline).toEqual({ form: "10-K" });
  });

  it("needs at least one high or five medium changes", () => {
    expect(buildAlerts({ ...base, redlines: [rl({ high: 0, medium: 4 })] })).toHaveLength(0);
    expect(buildAlerts({ ...base, redlines: [rl({ high: 0, medium: 5 })] })).toHaveLength(1);
  });

  it("ignores comparisons for companies not followed or filed before the window", () => {
    expect(buildAlerts({ ...base, redlines: [rl({ high: 9, ticker: "AAPL" }), rl({ high: 9, to_filed: "2025-12-31" })] })).toHaveLength(0);
  });
});
