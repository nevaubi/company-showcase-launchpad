import { describe, expect, it } from "vitest";
import { decide, healRow, lanesAllowed, nextProbe, nextUtcDay, parseReason, pausedToClear, providerKey, routeDecision, routeOf, staggerDelays, tripFromError, tripRow, type CircuitRow } from "./provider-health";

const T0 = Date.parse("2026-11-20T10:00:00Z");
const S0 = T0 / 1000;

describe("provider circuit state machine", () => {
  it("is closed without a row or a reason, open before retry-at, probe after", () => {
    expect(decide(null, T0).state).toBe("closed");
    expect(decide(healRow("openai-paid", T0), T0).state).toBe("closed");
    const row = tripRow("openai-paid", "quota", "OpenAI 429 credit_balance_exhausted", null, T0);
    expect(decide(row, T0)).toMatchObject({ state: "open", retryAt: S0 + 1800, cls: "quota", failures: 1 });
    expect(decide(row, T0 + 1801_000).state).toBe("probe");
  });
  it("hides a claimed probe for 10 minutes, then offers it again", () => {
    const row = tripRow("openai-paid", "quota", "x", null, T0);
    const claimedAt = T0 + 1900_000;
    const claimed: CircuitRow = { ...row, updated_at: new Date(claimedAt).toISOString() };
    expect(decide(claimed, claimedAt + 1000).state).toBe("open");
    expect(decide(claimed, claimedAt + 10 * 60_000 + 1).state).toBe("probe");
  });
  it("backs off quota 30m, 1h, 2h then 4h; config 1h; rate 5 then 15 min; allowance to 00:05 UTC", () => {
    let prev: CircuitRow | null = null;
    const gaps: number[] = [];
    for (let i = 0; i < 5; i++) {
      prev = tripRow("openai-paid", "quota", "credit", prev, T0);
      gaps.push(prev.cursor! - S0);
    }
    expect(gaps).toEqual([1800, 3600, 7200, 14400, 14400]);
    expect(parseReason(prev!.paused_reason)).toEqual({ cls: "quota", message: "credit", failures: 5 });
    expect(nextProbe("config", 3, T0) - S0).toBe(3600);
    expect(nextProbe("rate", 1, T0) - S0).toBe(300);
    expect(nextProbe("rate", 2, T0) - S0).toBe(900);
    expect(new Date(nextProbe("allowance", 1, T0) * 1000).toISOString()).toBe("2026-11-21T00:05:00.000Z");
    expect(nextUtcDay(Date.parse("2026-11-30T23:59:00Z"))).toBe(Date.parse("2026-12-01T00:05:00Z") / 1000);
  });
  it("resets the streak when the class changes, and trips only on provider faults", () => {
    const q = tripRow("openai-paid", "quota", "a", null, T0);
    expect(parseReason(tripRow("openai-paid", "config", "b", q, T0).paused_reason)!.failures).toBe(1);
    expect(tripFromError("openai-paid", { status: 400, kind: "rejected", message: "OpenAI 400 invalid_value: Invalid model ID." }, null, T0)!.paused_reason).toMatch(/^config: /);
    expect(tripFromError("openai-free-mini", { message: "free-only mode: OpenAI free allowance spent or unavailable" }, null, T0)!.paused_reason).toMatch(/^allowance: /);
    expect(tripFromError("openai-paid", { status: 400, kind: "rejected", message: "context too long" }, null, T0)).toBeNull();
  });
  it("lets exactly one of N concurrent callers claim a probe (compare-and-swap on updated_at)", async () => {
    let row: CircuitRow = tripRow("openai-paid", "quota", "x", null, T0);
    const now = T0 + 2000_000;
    // fake store: update ... where updated_at = expected
    const cas = async (expected: string | null, next: string) => {
      await Promise.resolve();
      if (row.updated_at !== expected) return false;
      row = { ...row, updated_at: next };
      return true;
    };
    const caller = async () => {
      const seen = row;
      if (decide(seen, now).state !== "probe") return false;
      return cas(seen.updated_at, new Date(now).toISOString());
    };
    const wins = (await Promise.all(Array.from({ length: 8 }, caller))).filter(Boolean);
    expect(wins).toHaveLength(1);
    expect(decide(row, now + 1000).state).toBe("open");
  });
});

describe("routes", () => {
  it("mirrors openaiStructured routing", () => {
    expect(routeOf("gpt-6.1-sol", { IR_FREE_ONLY: "1", IR_OPENAI_PAID: "1" })).toEqual(["openai-free-mini", "openai-paid"]);
    expect(routeOf("gpt-5.4", { IR_FREE_ONLY: "1" })).toEqual(["openai-free-large"]);
    expect(routeOf("gpt-6.1-sol", {})).toEqual(["gateway"]);
    expect(routeOf("gpt-6.1-sol", { IR_AI_PROVIDER: "openai" })).toEqual(["openai-paid"]);
    expect(routeOf("claude-sonnet-5-5", { IR_AI_PROVIDER: "openai" })).toEqual(["anthropic"]);
    expect(routeOf("inclusionai/ling-3.0-flash-vl", { IR_FREE_ONLY: "1" })).toEqual(["openrouter-free"]);
  });
  it("one decision for the route: closed if any provider is closed, else probe, else open", () => {
    const route = routeOf("gpt-6.1-sol", { IR_FREE_ONLY: "1", IR_OPENAI_PAID: "1" });
    const mini = tripRow("openai-free-mini", "allowance", "free allowance spent", null, T0);
    const paid = tripRow("openai-paid", "quota", "credit_balance_exhausted", null, T0);
    const rows = new Map([[mini.job, mini], [paid.job, paid]]);
    expect(routeDecision(new Map([[mini.job, mini]]), route, T0)).toMatchObject({ state: "closed", provider: "openai-paid" });
    const open = routeDecision(rows, route, T0);
    expect(open).toMatchObject({ state: "open", retryAt: S0 + 1800, provider: "openai-paid" });
    expect(lanesAllowed(open, 3)).toBe(0);
    const probe = routeDecision(rows, route, T0 + 1801_000);
    expect(probe).toMatchObject({ state: "probe", provider: "openai-paid" });
    expect(lanesAllowed(probe, 3)).toBe(1);
    expect(lanesAllowed({ state: "closed" }, 3)).toBe(3);
    expect(providerKey("openai-paid")).toBe("provider:openai-paid");
  });
});

describe("resume on heal", () => {
  it("clears only quota/auth reader pauses", () => {
    const rows = [
      { job: "ir-prose-runner:AAPL", paused_reason: "quota: OpenAI 429 credit_balance_exhausted: no credits" },
      { job: "ir-prose-runner:MSFT", paused_reason: "quota: AI 402 payment_required" },
      { job: "ir-vision-runner:CPRT", paused_reason: "auth: OpenAI 401" },
      { job: "ir-prose-verify", paused_reason: "quota: free-only mode: OpenAI free allowance spent or unavailable" },
      { job: "ir-canon", paused_reason: "OpenAI credit balance exhausted and the free lane is spent for today" },
      { job: "ir-prose-runner", paused_reason: "budget: this run used about 40 credits (cap 30)" },
      { job: "vendor-backfill", paused_reason: "pacing: hourly credit budget reached" },
      { job: "sec-discover-day", paused_reason: "gave up on 2026-11-19: 108 companies unresolved" },
      { job: "filing-steps-fail:0001", paused_reason: "quota: x" },
      { job: "ir-extract-runner:NVDA", paused_reason: null },
      { job: "ir-extract-runner:AMD", paused_reason: "owner: srv-1" },
    ];
    expect(pausedToClear(rows)).toEqual(["ir-prose-runner:AAPL", "ir-prose-runner:MSFT", "ir-vision-runner:CPRT", "ir-prose-verify", "ir-canon"]);
  });
  it("staggers lane starts", () => {
    expect(staggerDelays(3)).toEqual([0, 300_000, 600_000]);
  });
});
