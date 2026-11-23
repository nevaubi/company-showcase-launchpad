/**
 * runBatch against the real provider circuit (createProviderHealth on an in-memory store) and an
 * in-memory job_state: review F2 (a probe with many workers), F3 (outage trips the provider instead of
 * charging the queue) and F5 (an item that stops the run on configuration twice is charged).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CircuitRow } from "@/lib/jobs/provider-health";

const m = vi.hoisted(() => ({ rows: new Map<string, CircuitRow>(), db: null as unknown as ReturnType<typeof import("./fake-supabase").fakeSupabase> }));

vi.mock("../../scripts/lib/supa", async () => {
  const { fakeSupabase } = await import("./fake-supabase");
  m.db = fakeSupabase();
  return { sb: { from: (t: string) => m.db.client.from(t) }, args: { resume: "true" }, dbGate: async () => undefined, dbLatency: () => 100, log: () => undefined, sleep: async () => undefined };
});
vi.mock("@/lib/ir/rebuild.server", () => ({ rebuildCompany: async () => null }));
vi.mock("@/lib/jobs/provider-health.server", async () => {
  const real = await vi.importActual<typeof import("@/lib/jobs/provider-health.server")>("@/lib/jobs/provider-health.server");
  const h = real.createProviderHealth(
    {
      read: async (jobs) => jobs.flatMap((j) => (m.rows.has(j) ? [{ ...m.rows.get(j)! }] : [])),
      write: async (row) => void m.rows.set(row.job, { ...row }),
      claim: async (job, expected, next) => {
        const r = m.rows.get(job);
        if (!r || (r.updated_at ?? null) !== expected) return false;
        m.rows.set(job, { ...r, updated_at: next });
        return true;
      },
      clearReaderPauses: async () => 0,
    },
    { env: {}, log: () => undefined },
  );
  return { ...real, ...h, resetProviderCache: h.resetCache, _h: h };
});

import { runBatch } from "../../scripts/lib/runner";
import { decide, providerKey, tripRow } from "@/lib/jobs/provider-health";
import * as ph from "@/lib/jobs/provider-health.server";

const health = (ph as unknown as { _h: ReturnType<typeof ph.createProviderHealth> })._h;
const err = (message: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(message), extra);

function queue(n: number) {
  const q = Array.from({ length: n }, (_, i) => ({ id: `d${i}`, ticker: "AAPL", label: `doc ${i}` }));
  const released: [string, string | null][] = [];
  const processed: string[] = [];
  return {
    claim: async () => q.shift() ?? null,
    release: async (it: { id: string }, status: string | null) => {
      released.push([it.id, status]);
      if (status === null) q.unshift(it as (typeof q)[number]);
    },
    released,
    processed,
    left: () => q.length,
  };
}

beforeEach(() => {
  m.rows.clear();
  health.resetCache();
  for (const k of Object.keys(m.db.tables ?? {})) delete (m.db.tables as Record<string, unknown>)[k];
});

describe("runBatch on a probe-due route", () => {
  it("six workers: the probe heals the circuit and every item is read, no stop (F2)", async () => {
    const t0 = Date.now() - 3 * 3600_000;
    const row = tripRow("openai-paid", "quota", "credit_balance_exhausted", null, t0);
    m.rows.set(row.job, row);
    expect(decide(row, Date.now()).state).toBe("probe");
    const q = queue(10);
    await runBatch({
      job: "ir-extract-runner:AAPL",
      max: 50,
      concurrency: 6,
      route: ["openai-paid"],
      claim: q.claim,
      release: q.release,
      reset: async () => undefined,
      process: (it) => health.withProvider("openai-paid", async () => (q.processed.push(it.id), { facts: 1 })),
    });
    expect(q.processed.length).toBe(10);
    expect(q.released).toEqual([]);
    expect(m.rows.get(providerKey("openai-paid"))!.paused_reason).toBeNull();
  });
});

describe("runBatch during a provider brownout", () => {
  it("trips the provider (transient) and stops after a few failures instead of charging the queue (F3)", async () => {
    const q = queue(20);
    await runBatch({
      job: "ir-prose-runner:AAPL",
      max: 50,
      concurrency: 1,
      claim: q.claim,
      release: q.release,
      reset: async () => undefined,
      process: () => health.withProvider("openai-paid", async () => Promise.reject(err("OpenAI 503 Service Unavailable", { status: 503, kind: "transient" }))),
    });
    const charged = q.released.filter((r) => r[1] !== null);
    expect(charged.length).toBeLessThanOrEqual(1);
    expect(q.left()).toBeGreaterThanOrEqual(19);
    const row = m.rows.get(providerKey("openai-paid"))!;
    expect(row.paused_reason).toMatch(/^transient: /);
    expect(decide(row, Date.now()).state).toBe("open");
  });
});

describe("runBatch configuration strikes", () => {
  it("releases the item on the first config stop and charges it when the same item stops the next run (F5)", async () => {
    const opts = (q: ReturnType<typeof queue>) => ({
      job: "ir-extract-runner:AAPL",
      max: 50,
      concurrency: 1,
      claim: q.claim,
      release: q.release,
      reset: async () => undefined,
      process: async (it: { id: string }) => {
        if (it.id === "d0") throw err("OpenAI 400 invalid_value: Invalid model ID.", { status: 400, kind: "rejected", provider: "openai-paid" });
        return { facts: 1 };
      },
    });
    const first = queue(3);
    await runBatch(opts(first));
    expect(first.released).toEqual([["d0", null]]);
    const second = queue(3);
    await runBatch(opts(second));
    expect(second.released[0]).toEqual(["d0", "error: config: OpenAI 400 invalid_value: Invalid model ID."]);
    expect((m.db.tables.job_state ?? []).some((r) => String(r.job).startsWith("config-strike:"))).toBe(false);
  });
});
