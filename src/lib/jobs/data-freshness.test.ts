import { describe, expect, it } from "vitest";
import { dataFreshness, groupPaused, needsAttention, pausedJobs } from "./data-freshness";
import { ownerHolds } from "./lane-hold";

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
  it("a dataset whose collector the owner stopped is held, not stale or missing, and says why", () => {
    const holds = ownerHolds([{ job: "vendor-backfill", paused_reason: "owner: hold. Vendor collection stopped at the owner's request (since 2026-11-27)" }]);
    const silent = [{ key: "vendor_backfill", newest: "2026-11-18T12:00:00Z" }, { key: "macro", newest: "2026-11-17T12:00:00Z" }];
    // without the hold: a day of silence against a two-hour limit is stale
    expect(dataFreshness(silent, now).find((x) => x.key === "vendor_backfill")!.status).toBe("stale");
    const r = dataFreshness(silent, now, holds);
    const vendor = r.find((x) => x.key === "vendor_backfill")!;
    expect(vendor.status).toBe("held");
    expect(vendor.note).toBe("Vendor collection stopped at the owner's request (since 2026-11-27)");
    expect(needsAttention(vendor)).toBe(false);
    // a collector that never stored anything is held too, not "no data"
    expect(dataFreshness([], now, holds).find((x) => x.key === "vendor_backfill")!.status).toBe("held");
    // the hold covers only what that lane feeds: another late dataset is still late
    const macro = r.find((x) => x.key === "macro")!;
    expect(macro.status).toBe("stale");
    expect(macro.note).toBeUndefined();
    expect(needsAttention(macro)).toBe(true);
    // late first, then held, then on time
    const order = dataFreshness([...silent, { key: "ir_kpi_facts", newest: "2026-11-19T11:00:00Z" }], now, holds).map((x) => x.status);
    expect(order.indexOf("held")).toBeGreaterThan(order.lastIndexOf("stale"));
    expect(order.indexOf("held")).toBeGreaterThan(order.lastIndexOf("missing"));
    expect(order.indexOf("held")).toBeLessThan(order.indexOf("fresh"));
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
