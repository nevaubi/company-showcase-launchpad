import { describe, expect, it } from "vitest";
import { expiredLeases, maxRunMs, reapPatch, reapSummary, staleReportRuns, staleRuns } from "./reaper";

const now = Date.parse("2026-11-20T12:00:00Z");
const ago = (min: number) => new Date(now - min * 60_000).toISOString();

describe("reaper", () => {
  it("reaps HTTP runs after 10 minutes and worker runs only after the longest step deadline (F15)", () => {
    const rows = [
      { id: 1, job: "sec-discover", started_at: ago(11), finished_at: null },
      { id: 2, job: "sec-discover", started_at: ago(5), finished_at: null },
      { id: 3, job: "macro", started_at: ago(60), finished_at: ago(59) },
      { id: 4, job: "loop:canon", started_at: ago(120), finished_at: null },
      { id: 5, job: "loop:mirror", started_at: ago(260), finished_at: null },
      // a canon run between 3 h and 4 h is alive (its deadline is 4 h)
      { id: 7, job: "ir-canon", started_at: ago(210), finished_at: null },
      { id: 6, job: "alt-data", started_at: ago(30), finished_at: null },
    ];
    expect(staleRuns(rows, now).map((r) => r.id)).toEqual([5, 6, 1]);
    expect(staleRuns(rows, now, 1).map((r) => r.id)).toEqual([5]);
    expect(maxRunMs("options")).toBe(600_000);
    expect(maxRunMs("call-archive")).toBe(600_000);
    expect(maxRunMs("supply-intel")).toBe(4 * 3600_000 + 10 * 60_000);
    expect(maxRunMs("ir-site")).toBe(maxRunMs("ir-canon"));
  });
  it("records the reap on the run itself", () => {
    const p = reapPatch({ id: 1, job: "macro", started_at: ago(30), finished_at: null });
    expect(p).toMatchObject({ finished_at: ago(30), ok: false, detail: { reaped: true } });
    expect(p.detail.reason).toMatch(/scheduler hung up/);
    expect(reapSummary([{ id: 1, job: "macro", started_at: "", finished_at: null }, { id: 2, job: "macro", started_at: "", finished_at: null }])).toEqual({ macro: 2 });
  });
  it("clears only runner leases that expired over 10 minutes ago", () => {
    const rows = [
      { job: "ir-prose-runner:AAPL", lease_until: ago(11) },
      { job: "ir-prose-runner:MSFT", lease_until: ago(5) },
      { job: "ir-deep-loop", lease_until: ago(60) },
      { job: "ir-extract-runner:NVDA", lease_until: null },
    ];
    expect(expiredLeases(rows, now).map((r) => r.job)).toEqual(["ir-prose-runner:AAPL"]);
  });
  it("closes report runs abandoned in running", () => {
    const rows = [
      { id: "a", status: "running", created_at: ago(180) },
      { id: "b", status: "running", created_at: ago(30) },
      { id: "c", status: "ready", created_at: ago(500) },
    ];
    expect(staleReportRuns(rows, now).map((r) => r.id)).toEqual(["a"]);
  });
});

describe("reaper limits follow the loop's deadlines", () => {
  it("no worker step that writes its own run row outlives the reaper's limit", async () => {
    const { STEP_LIMITS_MS } = await import("../../../scripts/lib/loop-schedule");
    const { WORKER_MAX_RUN_MS } = await import("./reaper");
    for (const [step, ms] of Object.entries(STEP_LIMITS_MS)) if (step !== "company") expect(ms, step).toBeLessThan(WORKER_MAX_RUN_MS);
  });
});
