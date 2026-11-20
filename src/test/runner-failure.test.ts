import { describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ upserts: [] as Record<string, unknown>[], trips: [] as string[], states: new Map<string, unknown>() }));
vi.mock("../../scripts/lib/supa", () => {
  const q: Record<string, unknown> = {};
  for (const k of ["select", "eq"]) q[k] = () => q;
  q.maybeSingle = async () => ({ data: null });
  q.upsert = (row: Record<string, unknown>) => {
    m.upserts.push(row);
    return Promise.resolve({ error: null });
  };
  return { sb: { from: () => q }, args: { resume: "true" }, dbGate: async () => undefined, dbLatency: () => 100, log: () => undefined, sleep: async () => undefined };
});
vi.mock("@/lib/ir/rebuild.server", () => ({ rebuildCompany: async () => null }));
vi.mock("@/lib/jobs/provider-health.server", () => ({
  providerStates: async () => m.states,
  providerTripError: async (id: string) => (m.trips.push(id), null),
  closedMessage: (id: string) => `provider ${id} closed`,
}));

import { failureAction, runBatch } from "../../scripts/lib/runner";
import { tripRow } from "@/lib/jobs/provider-health";

const err = (message: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(message), extra);

describe("runner failure actions", () => {
  it("stops on quota and config without charging the item", () => {
    expect(failureAction(err("OpenAI 429 credit_balance_exhausted: no credits", { kind: "quota", status: 429 }), 0)).toMatchObject({ act: "stop", cls: "quota" });
    const a = failureAction(err("OpenAI 400 invalid_value: Invalid model ID.", { kind: "rejected", status: 400 }), 0);
    expect(a).toMatchObject({ act: "stop", cls: "config" });
    expect((a as { stop: string }).stop).toMatch(/^auth: /);
  });
  it("retries transient errors 4 times, then charges the item with its class", () => {
    const e = err("fetch failed");
    for (let i = 0; i < 4; i++) expect(failureAction(e, i, () => 0.5).act).toBe("retry");
    expect(failureAction(e, 4)).toMatchObject({ act: "fail", status: "error: transient: fetch failed" });
    expect(failureAction(err("HTTP 429"), 5).act).toBe("retry");
    expect(failureAction(err("HTTP 429"), 6).act).toBe("fail");
  });
  it("caps a worker's sleep and fails permanent errors at once", () => {
    const r = failureAction(err("OpenAI 429 rate limit", { kind: "rate", status: 429, retryAfterMs: 600_000 }), 0, () => 1);
    expect(r).toMatchObject({ act: "retry", sleepMs: 120_000 });
    expect(failureAction(err("context too long", { kind: "rejected", status: 400 }), 0)).toMatchObject({ act: "fail", status: "error: context too long" });
  });
});

describe("runBatch with failure classes", () => {
  function items(n: number) {
    const queue = Array.from({ length: n }, (_, i) => ({ id: `d${i}`, ticker: "AAPL", label: `doc ${i}` }));
    const released: [string, string | null][] = [];
    return {
      claim: async () => queue.shift() ?? null,
      release: async (it: { id: string }, status: string | null) => {
        released.push([it.id, status]);
        if (status === null) queue.unshift(it as (typeof queue)[number]);
      },
      released,
    };
  }
  it("a config error releases the item untouched, stops, and does not pause the job key", async () => {
    m.upserts.length = 0;
    const q = items(3);
    await runBatch({ job: "ir-extract-runner:AAPL", max: 10, concurrency: 1, claim: q.claim, release: q.release, reset: async () => undefined, provider: "openai-paid", process: async () => Promise.reject(err("OpenAI 400 invalid_value: Invalid model ID.", { kind: "rejected", status: 400 })) });
    expect(q.released).toEqual([["d0", null]]);
    expect(m.trips).toEqual(["openai-paid"]);
    expect(m.upserts.at(-1)).toMatchObject({ job: "ir-extract-runner:AAPL", paused_reason: null });
  });
  it("a transient error is retried 4 times, then the item fails", async () => {
    const q = items(1);
    await runBatch({ job: "ir-prose-runner", max: 10, concurrency: 1, claim: q.claim, release: q.release, reset: async () => undefined, process: async () => Promise.reject(err("socket hang up")) });
    expect(q.released.map((r) => r[1])).toEqual([null, null, null, null, "error: transient: socket hang up"]);
  });
  it("does not start while every provider on its route is open", async () => {
    const row = tripRow("openai-paid", "quota", "credit_balance_exhausted", null, Date.now());
    m.states = new Map([[row.job, row]]);
    let claimed = 0;
    await runBatch({ job: "ir-prose-runner", max: 10, concurrency: 1, route: ["openai-paid"], claim: async () => (claimed++, null), release: async () => undefined, reset: async () => undefined, process: async () => ({ facts: 0 }) });
    expect(claimed).toBe(0);
    m.states = new Map();
  });
});
