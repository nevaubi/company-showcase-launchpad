import { describe, expect, it } from "vitest";
import { createProviderHealth, ProviderClosedError, type CircuitStore } from "./provider-health.server";
import { decide, parseReason, providerKey, tripRow, type CircuitRow } from "./provider-health";

function fakeStore(initial: CircuitRow[] = [], pauses: { job: string; paused_reason: string | null }[] = []) {
  const rows = new Map(initial.map((r) => [r.job, { ...r }]));
  const calls = { read: 0, write: 0, cleared: 0 };
  const store: CircuitStore = {
    async read(jobs) {
      calls.read++;
      await Promise.resolve();
      return jobs.map((j) => rows.get(j)).filter((r): r is CircuitRow => !!r).map((r) => ({ ...r }));
    },
    async write(row) {
      calls.write++;
      rows.set(row.job, { ...row });
    },
    async claim(job, expected, next) {
      await Promise.resolve();
      const r = rows.get(job);
      if (!r || r.updated_at !== expected) return false;
      r.updated_at = next;
      return true;
    },
    async clearReaderPauses() {
      let n = 0;
      for (const p of pauses) {
        if (!p.paused_reason || !/^ir-/.test(p.job)) continue;
        p.paused_reason = null;
        n++;
      }
      calls.cleared += n;
      return n;
    },
  };
  return { store, rows, calls, pauses };
}

const T0 = Date.parse("2026-11-20T10:00:00Z");
const quota = () => Object.assign(new Error("OpenAI 429 credit_balance_exhausted: You have no credits remaining."), { kind: "quota", status: 429 });

describe("provider circuit store", () => {
  it("trips on quota, then fails fast without calling the provider", async () => {
    const f = fakeStore();
    let t = T0;
    const h = createProviderHealth(f.store, { env: {}, log: () => undefined });
    let calls = 0;
    const call = () => h.withProvider("openai-paid", async () => (calls++, Promise.reject(quota())), { now: () => t });
    await expect(call()).rejects.toMatchObject({ provider: "openai-paid" });
    expect(parseReason(f.rows.get("provider:openai-paid")!.paused_reason)!.cls).toBe("quota");
    t += 60_000;
    await expect(call()).rejects.toBeInstanceOf(ProviderClosedError);
    expect(calls).toBe(1);
  });
  it("never trips on an ordinary rejected request", async () => {
    const f = fakeStore();
    const h = createProviderHealth(f.store, { env: {}, log: () => undefined });
    await expect(h.withProvider("openai-paid", async () => Promise.reject(Object.assign(new Error("context too long"), { kind: "rejected", status: 400 })))).rejects.toThrow();
    expect(f.rows.size).toBe(0);
  });
  it("trips on a configuration error (invalid model id)", async () => {
    const f = fakeStore();
    const h = createProviderHealth(f.store, { env: {}, log: () => undefined });
    await expect(h.withProvider("openai-free-mini", async () => Promise.reject(Object.assign(new Error("OpenAI 400 invalid_value: Invalid model ID."), { kind: "rejected", status: 400 })))).rejects.toThrow();
    expect(f.rows.get("provider:openai-free-mini")!.paused_reason).toMatch(/^config: /);
  });
  it("lets one of many concurrent callers probe; success heals and clears reader pauses", async () => {
    const tripped = tripRow("openai-paid", "quota", "credit_balance_exhausted", null, T0);
    const pauses = [{ job: "ir-prose-runner:AAPL", paused_reason: "quota: credit" }];
    const f = fakeStore([tripped], pauses);
    const now = T0 + 31 * 60_000;
    const h = createProviderHealth(f.store, { env: {}, log: () => undefined });
    let calls = 0;
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => h.withProvider("openai-paid", async () => (calls++, "ok"), { now: () => now })));
    expect(calls).toBe(1);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(decide(f.rows.get("provider:openai-paid")!, now).state).toBe("closed");
    expect(pauses[0].paused_reason).toBeNull();
  });
  it("healing a data host (Cboe) clears only its own row, never the AI reader or report pauses (W1b)", async () => {
    const cboe = tripRow("cboe", "rate", "Cboe refused option chains (403 x4)", null, T0);
    const pauses = [{ job: "ir-prose-runner:AAPL", paused_reason: "quota: credit" }];
    const f = fakeStore([cboe], pauses);
    const h = createProviderHealth(f.store, { env: {}, log: () => undefined });
    expect(await h.providerHeal("cboe", T0 + 600_000)).toEqual({ healed: true, cleared: 0 });
    expect(f.rows.get("provider:cboe")!.paused_reason).toBeNull();
    expect(pauses[0].paused_reason).toBe("quota: credit");
    expect(f.calls.cleared).toBe(0);
    const ai = tripRow("gateway", "quota", "AI 402 payment_required", null, T0);
    f.rows.set(ai.job, ai);
    expect(await h.providerHeal("gateway", T0 + 600_000)).toEqual({ healed: true, cleared: 1 });
    expect(pauses[0].paused_reason).toBeNull();
  });
  it("a failed probe re-trips with a longer backoff", async () => {
    const f = fakeStore([tripRow("openai-paid", "quota", "x", null, T0)]);
    const now = T0 + 31 * 60_000;
    const h = createProviderHealth(f.store, { env: {}, log: () => undefined });
    await expect(h.withProvider("openai-paid", async () => Promise.reject(quota()), { now: () => now })).rejects.toThrow();
    const row = f.rows.get("provider:openai-paid")!;
    expect(parseReason(row.paused_reason)!.failures).toBe(2);
    expect(Number(row.cursor) - Math.floor(now / 1000)).toBe(3600);
  });
  it("parallel trips of one outage do not lengthen the backoff", async () => {
    const f = fakeStore();
    const h = createProviderHealth(f.store, { env: {}, log: () => undefined });
    await h.providerTrip("openai-paid", "quota", "a", T0);
    await h.providerTrip("openai-paid", "quota", "a", T0 + 1000);
    expect(parseReason(f.rows.get(providerKey("openai-paid"))!.paused_reason)!.failures).toBe(1);
  });
  it("fails open when the state cannot be read, and is a pass-through with PROVIDER_CIRCUIT=0", async () => {
    const broken: CircuitStore = { read: () => Promise.reject(new Error("db down")), write: async () => undefined, claim: async () => false, clearReaderPauses: async () => 0 };
    const h = createProviderHealth(broken, { env: {}, log: () => undefined });
    expect(await h.withProvider("gateway", async () => 7)).toBe(7);
    const f = fakeStore([tripRow("gateway", "quota", "x", null, Date.now())]);
    const off = createProviderHealth(f.store, { env: { PROVIDER_CIRCUIT: "0" }, log: () => undefined });
    expect(await off.withProvider("gateway", async () => 8)).toBe(8);
  });
  it("caches reads for 30 seconds", async () => {
    const f = fakeStore();
    const h = createProviderHealth(f.store, { env: {}, log: () => undefined });
    await h.providerState("sec", T0);
    await h.providerState("sec", T0 + 10_000);
    expect(f.calls.read).toBe(1);
    await h.providerState("sec", T0 + 31_000);
    expect(f.calls.read).toBe(2);
  });
});
