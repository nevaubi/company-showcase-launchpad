import { describe, expect, it } from "vitest";
import { dataFreshness, groupPaused, pausedJobs } from "./data-freshness";

describe("data freshness", () => {
  const now = new Date("2026-11-19T12:00:00Z");
  it("flags a dataset whose newest row did not advance, even if its job ran", () => {
    const r = dataFreshness([{ key: "worker_heartbeat", newest: "2026-11-19T09:00:00Z" }, { key: "ir_kpi_facts", newest: "2026-11-19T11:00:00Z" }], now);
    expect(r.find((x) => x.key === "worker_heartbeat")!.status).toBe("stale");
    expect(r.find((x) => x.key === "ir_kpi_facts")!.status).toBe("fresh");
    expect(r.find((x) => x.key === "supply_signals")!.status).toBe("missing");
  });
  it("trading-day data gets the weekend: a Friday bar is fresh on Monday, a Wednesday one is not", () => {
    const mon = new Date("2026-11-23T20:00:00Z");
    const fri = dataFreshness([{ key: "market_bars", newest: "2026-11-20T21:30:00Z" }], mon).find((x) => x.key === "market_bars")!;
    expect(fri.status).toBe("fresh");
    expect(fri.maxAgeHours).toBe(78);
    expect(dataFreshness([{ key: "market_bars", newest: "2026-11-18T21:30:00Z" }], mon).find((x) => x.key === "market_bars")!.status).toBe("stale");
  });
  it("lists real pauses but not receipts, provider circuits, alert episodes, slice rows or routine reasons", () => {
    const p = pausedJobs([
      { job: "ir-canon", paused_reason: "OpenAI 429", updated_at: "x" },
      { job: "options-backoff", paused_reason: "blocked: Cboe", updated_at: "x" },
      { job: "filing-steps-fail:0001", paused_reason: "boom", updated_at: "x" },
      { job: "reports-due-fail:AAPL:primer", paused_reason: "boom", updated_at: "x" },
      { job: "provider:openai-paid", paused_reason: "quota: x [n=1]", updated_at: "x" },
      { job: "alert:worker-heartbeat", paused_reason: "sent: x", updated_at: "x" },
      { job: "macro-slice", paused_reason: "x", updated_at: "x" },
      { job: "vendor-backfill", paused_reason: "pacing: hourly credit budget reached", updated_at: "x" },
      { job: "ir-deep-loop", paused_reason: "owner: srv", updated_at: "x" },
      { job: "sec", paused_reason: null, updated_at: "x" },
    ]);
    expect(p.map((x) => x.job)).toEqual(["ir-canon", "options-backoff"]);
  });
  it("folds per-company rows into one line with a count", () => {
    const g = groupPaused([
      { job: "ir-prose-runner:AAPL", reason: "quota: a", since: "2026-11-19T01:00:00Z" },
      { job: "ir-prose-runner:MSFT", reason: "quota: b", since: "2026-11-19T02:00:00Z" },
      { job: "ir-prose-runner:BRK-B", reason: "quota: c", since: "2026-11-19T00:00:00Z" },
      { job: "sec-discover-day", reason: "gave up", since: "2026-11-19T03:00:00Z" },
    ]);
    expect(g[0]).toEqual({ job: "ir-prose-runner", count: 3, reason: "quota: b", since: "2026-11-19T02:00:00Z", sample: ["AAPL", "MSFT", "BRK-B"] });
    expect(g[1]).toMatchObject({ job: "sec-discover-day", count: 1, sample: [] });
  });
});
