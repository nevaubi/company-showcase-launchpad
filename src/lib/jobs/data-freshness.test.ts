import { describe, expect, it } from "vitest";
import { dataFreshness, pausedJobs } from "./data-freshness";

describe("data freshness", () => {
  const now = new Date("2026-11-19T12:00:00Z");
  it("flags a dataset whose newest row did not advance, even if its job ran", () => {
    const r = dataFreshness([{ key: "worker_heartbeat", newest: "2026-11-19T09:00:00Z" }, { key: "ir_kpi_facts", newest: "2026-11-19T11:00:00Z" }], now);
    expect(r.find((x) => x.key === "worker_heartbeat")!.status).toBe("stale");
    expect(r.find((x) => x.key === "ir_kpi_facts")!.status).toBe("fresh");
    expect(r.find((x) => x.key === "supply_signals")!.status).toBe("missing");
  });
  it("lists every real pause reason but not per-item receipts", () => {
    const p = pausedJobs([
      { job: "ir-canon", paused_reason: "OpenAI 429", updated_at: "x" },
      { job: "filing-steps-fail:0001", paused_reason: "boom", updated_at: "x" },
      { job: "sec", paused_reason: null, updated_at: "x" },
    ]);
    expect(p.map((x) => x.job)).toEqual(["ir-canon"]);
  });
});
