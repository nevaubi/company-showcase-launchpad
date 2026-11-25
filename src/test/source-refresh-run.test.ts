// The rules of one refresh run (scripts/lib/source-refresh-run.ts), without a database or a publisher:
// what a run may start, what a failed or cut-off dataset leaves behind, when a silent family is left
// alone, what the receipt lists and how the process ends. The cases follow what failed in production
// on 25 Nov 2026 (review rev-workers, finding M1).
import { createServer } from "node:http";
import { createServer as createHttp2Server } from "node:http2";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { parseReason } from "@/lib/jobs/provider-health";
import { authoritativeCsvUrl, OFFICIAL_USER_AGENT, type RefreshState } from "@/lib/sources/refresh-plan";
import {
  FAMILY_TRIP_AFTER,
  FRED_PROBE_EVERY_MS,
  FRED_PROBE_OLD_REFRESH_UA,
  FamilyBreaker,
  RefreshStoreError,
  RefreshTransferError,
  TRANSFER_ALLOWANCE_MS,
  attemptDataset,
  canStart,
  familyCircuit,
  familyCircuitJob,
  familyRetryAt,
  fredProbeDue,
  fredProbeRequests,
  fredProbeUrl,
  http1Probe,
  http2Probe,
  providerStatus,
  readFredProbe,
  refreshExitCode,
  refreshReceipt,
  runFredProbe,
  runQueue,
  transferFault,
  type CircuitRow,
  type FredProbeResult,
  type ProbeTransport,
  type QueueUnit,
  type RefreshOutcome,
  type RefreshStore,
  type StopCause,
} from "../../scripts/lib/source-refresh-run";
import { FredTransportError } from "../../scripts/lib/fred-transport";

const NOW = Date.parse("2026-11-25T19:00:00Z");
const FRED_ID = "official_08_consumer_discretionary_raw_fred_rsafs_a6e0a3815f";
const EIA_ID = "official_04_energy_raw_mer_t01_10_1c5a7c2f0e";

function fakeStore(initial: Record<string, RefreshState> = {}) {
  const states = new Map(Object.entries(initial));
  const locks = new Set<string>();
  const calls: string[] = [];
  const store: RefreshStore = {
    async readState(id) {
      calls.push(`read:${id}`);
      return states.get(id) ?? {};
    },
    async writeState(id, state) {
      calls.push(`write:${id}`);
      states.set(id, state);
    },
    async claim(id) {
      calls.push(`claim:${id}`);
      if (locks.has(id)) return false;
      locks.add(id);
      return true;
    },
    async release(id) {
      calls.push(`release:${id}`);
      locks.delete(id);
    },
  };
  return { store, states, locks, calls };
}

describe("budget: a dataset starts only when the rest of the run covers its transfer", () => {
  it("needs the transfer limit plus ten seconds of bookkeeping", () => {
    expect(TRANSFER_ALLOWANCE_MS.fred).toBe(20_000);
    expect(TRANSFER_ALLOWANCE_MS.eia_mer).toBe(120_000);
    expect(canStart(130_000, TRANSFER_ALLOWANCE_MS.eia_mer)).toBe(true);
    expect(canStart(129_999, TRANSFER_ALLOWANCE_MS.eia_mer)).toBe(false);
    // the old rule started a 120 second transfer with 10 seconds left
    expect(canStart(10_000, TRANSFER_ALLOWANCE_MS.fhfa)).toBe(false);
    expect(canStart(30_000, TRANSFER_ALLOWANCE_MS.fred)).toBe(true);
    expect(canStart(29_999, TRANSFER_ALLOWANCE_MS.fred)).toBe(false);
  });
});

describe("whose failure a failed transfer is", () => {
  it("counts no answer and a refusal against the publisher, a bad file against the dataset", () => {
    expect([403, 429, 500, 503, 504].every(providerStatus)).toBe(true);
    expect([200, 304, 400, 404, 410].some(providerStatus)).toBe(false);
    expect(transferFault(new RefreshTransferError("Official source did not answer", "provider"))).toBe("provider");
    expect(transferFault(new RefreshTransferError("Endpoint returned a document", "dataset"))).toBe("dataset");
    expect(transferFault(new FredTransportError("FRED download deadline exceeded", "deadline"))).toBe("provider");
    expect(transferFault(new FredTransportError("FRED request failed (network_error): x", "network_error"))).toBe("provider");
    // FRED answered: the series, not the publisher
    expect(transferFault(new FredTransportError("FRED request failed (http_status): x", "http_status"))).toBe("dataset");
    expect(transferFault(new FredTransportError("FRED request failed (http_status 404): x", "http_status", 404))).toBe("dataset");
    // FRED turned this client away or is down: the publisher
    for (const status of [403, 429, 503]) expect(transferFault(new FredTransportError("FRED request failed (http_status): x", "http_status", status))).toBe("provider");
    expect(transferFault(new Error("Stage refreshed snapshot: timeout"))).toBe("dataset");
  });
});

describe("one dataset: a failure always leaves a state and never leaves a lock", () => {
  it("records an error with its next try and releases the lock", async () => {
    const { store, states, locks } = fakeStore({ [FRED_ID]: { last_attempt_at: "2026-11-25T18:00:00.000Z" } });
    const outcome = await attemptDataset({
      id: FRED_ID, family: "fred", store, stopCause: () => null, now: () => new Date(NOW),
      work: async () => {
        throw new FredTransportError("FRED download deadline exceeded", "deadline");
      },
    });
    expect(outcome).toEqual({ id: FRED_ID, family: "fred", outcome: "failed", error: "FRED download deadline exceeded", fault: "provider" });
    expect(states.get(FRED_ID)).toMatchObject({ failures: 1, last_error: "FRED download deadline exceeded", next_due_at: "2026-11-25T19:30:00.000Z" });
    expect(locks.size).toBe(0);
  });

  it("the dataset in flight when the run budget fires keeps a failure state and loses its lock", async () => {
    // Production, 25 Nov: this dataset held only last_attempt_at and its lock stayed leased, so it was
    // first in line again on every run.
    const { store, states, locks, calls } = fakeStore({ [FRED_ID]: { last_attempt_at: "2026-11-25T19:04:10.890Z" } });
    const stop = new AbortController();
    let cause: StopCause = null;
    const pending = attemptDataset({
      id: FRED_ID, family: "fred", store, stopCause: () => cause, now: () => new Date(NOW),
      work: () => new Promise((_, reject) => stop.signal.addEventListener("abort", () => reject(stop.signal.reason), { once: true })),
    });
    await new Promise((r) => setTimeout(r, 5));
    cause = "budget";
    stop.abort(new Error("Refresh runtime budget reached"));
    const outcome = await pending;
    expect(outcome).toMatchObject({ outcome: "failed", fault: "budget" });
    expect(states.get(FRED_ID)).toMatchObject({ failures: 1, next_due_at: "2026-11-25T19:30:00.000Z" });
    expect(states.get(FRED_ID)?.last_error).toMatch(/^Run budget reached before this dataset finished/);
    expect(locks.size).toBe(0);
    expect(calls).toEqual([`claim:${FRED_ID}`, `read:${FRED_ID}`, `write:${FRED_ID}`, `release:${FRED_ID}`]);
  });

  it("a stop signal from outside counts nothing against the dataset and still releases the lock", async () => {
    const before = { failures: 2, next_due_at: "2026-11-25T18:00:00.000Z" };
    const { store, states, locks } = fakeStore({ [EIA_ID]: before });
    const outcome = await attemptDataset({
      id: EIA_ID, family: "eia_mer", store, stopCause: () => "signal",
      work: async () => {
        throw new Error("Refresh stopped by SIGTERM");
      },
    });
    expect(outcome.outcome).toBe("skipped");
    expect(states.get(EIA_ID)).toEqual(before);
    expect(locks.size).toBe(0);
  });

  it("leaves a dataset alone that another collector holds", async () => {
    const { store, locks, calls } = fakeStore();
    locks.add(EIA_ID);
    let worked = false;
    const outcome = await attemptDataset({ id: EIA_ID, family: "eia_mer", store, stopCause: () => null, work: async () => { worked = true; return { outcome: "unchanged" }; } });
    expect(outcome).toMatchObject({ outcome: "skipped" });
    expect(worked).toBe(false);
    expect(calls).toEqual([`claim:${EIA_ID}`]);
    expect(locks.has(EIA_ID)).toBe(true);
  });

  it("runs the cleanup before the lock is released, whatever happened", async () => {
    const { store, calls } = fakeStore();
    const seen: string[] = [];
    await attemptDataset({ id: EIA_ID, family: "eia_mer", store, stopCause: () => null, work: async () => ({ outcome: "staged", snapshot_id: "c".repeat(64), rows: 12 }),
      cleanup: async (o) => { seen.push(o.outcome); calls.push("cleanup"); } });
    await attemptDataset({ id: EIA_ID, family: "eia_mer", store, stopCause: () => null, work: async () => { throw new Error("x"); },
      cleanup: async (o) => { seen.push(o.outcome); throw new Error("cleanup failed too"); } });
    expect(seen).toEqual(["staged", "failed"]);
    expect(calls.indexOf("cleanup")).toBeLessThan(calls.indexOf(`release:${EIA_ID}`));
    expect(calls.filter((c) => c === `release:${EIA_ID}`)).toHaveLength(2);
  });

  it("a state store that fails is the run's failure, and the lock is still given back", async () => {
    const { store, calls } = fakeStore();
    store.writeState = async () => {
      throw new RefreshStoreError("Write refresh state: no database reply");
    };
    await expect(attemptDataset({ id: EIA_ID, family: "eia_mer", store, stopCause: () => null, work: async () => { throw new Error("boom"); } }))
      .rejects.toBeInstanceOf(RefreshStoreError);
    expect(calls.at(-1)).toBe(`release:${EIA_ID}`);
  });

  it("stores the error without query strings or anything that looks like a key", async () => {
    const { store, states } = fakeStore();
    const outcome = await attemptDataset({ id: FRED_ID, family: "fred", store, stopCause: () => null, now: () => new Date(NOW),
      work: async () => {
        throw new Error("GET https://api.stlouisfed.org/fred/series/observations?series_id=DGS10&api_key=0123456789abcdef0123456789abcdef failed, token=eyJhbGciOiJIUzI1NiJ9.payload.sig");
      } });
    const stored = JSON.stringify([states.get(FRED_ID), outcome]);
    expect(stored).toContain("https://api.stlouisfed.org/fred/series/observations");
    expect(stored).not.toMatch(/api_key|0123456789abcdef|eyJhbGci|series_id/);
  });
});

describe("family circuit: a publisher that does not answer is left alone", () => {
  const silence = "FRED download deadline exceeded";

  it("opens after two transfers in a row without an answer, in the provider circuit's own form", () => {
    expect(FAMILY_TRIP_AFTER).toBe(2);
    const breaker = new FamilyBreaker();
    expect(breaker.record("fred", "provider", silence, NOW)).toBeNull();
    expect(breaker.blocked("fred", NOW)).toBeNull();
    const row = breaker.record("fred", "provider", silence, NOW);
    expect(row).toEqual({ cursor: Math.floor(NOW / 1000) + 1800, paused_reason: `transient: ${silence} [n=1]` });
    expect(parseReason(row!.paused_reason)).toEqual({ cls: "transient", message: silence, failures: 1 });
    expect(breaker.blocked("fred", NOW)).toBe(`fred is paused until 2026-11-25T19:30:00.000Z: ${silence}`);
    // the other families go on
    expect(breaker.blocked("eia_mer", NOW)).toBeNull();
    expect(familyCircuitJob("fred")).toBe("source-refresh-family:fred");
  });

  it("an answer between two silences is not two in a row", () => {
    const breaker = new FamilyBreaker();
    breaker.record("eia_mer", "provider", "timeout", NOW);
    expect(breaker.record("eia_mer", "answered", "", NOW)).toBeNull();
    expect(breaker.record("eia_mer", "provider", "timeout", NOW)).toBeNull();
    expect(breaker.blocked("eia_mer", NOW)).toBeNull();
  });

  it("stays open across runs until its retry time, then lets one dataset try", () => {
    const stored: CircuitRow = { cursor: Math.floor(NOW / 1000) + 1800, paused_reason: `transient: ${silence} [n=1]` };
    const during = new FamilyBreaker([["fred", stored]]);
    expect(during.blocked("fred", NOW + 29 * 60_000)).toMatch(/^fred is paused until/);
    const after = new FamilyBreaker([["fred", stored]]);
    const later = NOW + 31 * 60_000;
    expect(familyCircuit(stored, later)).toEqual({ state: "probe", trips: 1, message: silence });
    expect(after.blocked("fred", later)).toBeNull();
    // the one try fails: open again at once, for longer
    const again = after.record("fred", "provider", silence, later);
    expect(again).toEqual({ cursor: Math.floor(later / 1000) + 3600, paused_reason: `transient: ${silence} [n=2]` });
    expect(after.blocked("fred", later)).toMatch(/^fred is paused until/);
  });

  it("closes as soon as the publisher answers", () => {
    const stored: CircuitRow = { cursor: Math.floor(NOW / 1000) - 5, paused_reason: `transient: ${silence} [n=3]` };
    const breaker = new FamilyBreaker([["fred", stored]]);
    expect(breaker.record("fred", "answered", "", NOW)).toEqual({ cursor: 0, paused_reason: null });
    expect(breaker.state("fred", NOW)).toEqual({ state: "closed" });
    expect(breaker.summary(NOW)).toEqual({});
  });

  it("waits 30, 60, 120, 240 minutes, then six hours", () => {
    const minutes = [1, 2, 3, 4, 5, 6, 40].map((n) => (familyRetryAt(n, NOW) - Math.floor(NOW / 1000)) / 60);
    expect(minutes).toEqual([30, 60, 120, 240, 360, 360, 360]);
  });

  it("an operator's run of one named dataset is never held back and cannot open the circuit", () => {
    const stored: CircuitRow = { cursor: Math.floor(NOW / 1000) + 1800, paused_reason: `transient: ${silence} [n=1]` };
    const breaker = new FamilyBreaker([["fred", stored]], true);
    expect(breaker.blocked("fred", NOW)).toBeNull();
    expect(breaker.record("fred", "provider", silence, NOW)).toBeNull();
    expect(breaker.record("fred", "answered", "", NOW)).toEqual({ cursor: 0, paused_reason: null });
  });

  it("reports the circuits that are not closed", () => {
    const breaker = new FamilyBreaker([["fred", { cursor: Math.floor(NOW / 1000) + 600, paused_reason: `transient: ${silence} [n=2]` }]]);
    expect(breaker.summary(NOW)).toEqual({ fred: { state: "open", retry_at: "2026-11-25T19:10:00.000Z", trips: 2, reason: silence } });
  });
});

describe("the queue: FRED cannot take the refresh lane down", () => {
  function scene(startMs = NOW, runSeconds = 480) {
    let clock = startMs;
    const saved: [string, CircuitRow][] = [];
    const started: string[] = [];
    const unit = (id: string, family: QueueUnit["family"], seconds: number, result: "ok" | "silent" | "bad" | "leased"): QueueUnit => ({
      id, family, ...(family === "fdic" || family === "taiwan" ? {} : { circuit: family }),
      attempt: async (): Promise<RefreshOutcome> => {
        started.push(id);
        clock += seconds * 1000;
        if (result === "ok") return { id, family, outcome: "unchanged" };
        if (result === "leased") return { id, family, outcome: "skipped", reason: "another collector holds this dataset" };
        return { id, family, outcome: "failed", error: result === "silent" ? "FRED download deadline exceeded" : "Official source returned HTTP 404", fault: result === "silent" ? "provider" : "dataset" };
      },
    });
    const options = (breaker = new FamilyBreaker(), more: Partial<Parameters<typeof runQueue>[1]> = {}) => ({
      maxDatasets: 8, deadline: startMs + runSeconds * 1000, now: () => clock, stopCause: (): StopCause => null, breaker,
      saveCircuit: async (family: string, row: CircuitRow) => { saved.push([family, row]); }, ...more,
    });
    return { unit, options, saved, started, elapsed: () => (clock - startMs) / 1000 };
  }

  it("two silent FRED transfers cost forty seconds, then the other families are collected", async () => {
    // Before: four FRED inputs of 120 seconds each filled the 480 second run and EIA table T01.10 waited.
    const s = scene();
    const units = [1, 2, 3, 4, 5].map((n) => s.unit(`fred_${n}`, "fred", 20, "silent")).concat([s.unit(EIA_ID, "eia_mer", 5, "ok"), s.unit("fhfa_master", "fhfa", 9, "ok")]);
    const result = await runQueue(units, s.options());
    expect(s.started).toEqual(["fred_1", "fred_2", EIA_ID, "fhfa_master"]);
    expect(s.elapsed()).toBe(54);
    expect(result.attempted).toBe(4);
    expect(result.notStarted).toEqual([{ reason: "fred is paused until 2026-11-25T19:30:40.000Z: FRED download deadline exceeded", count: 3, sample: ["fred_3", "fred_4", "fred_5"] }]);
    expect(s.saved).toEqual([["fred", { cursor: Math.floor(NOW / 1000) + 40 + 1800, paused_reason: "transient: FRED download deadline exceeded [n=1]" }]]);
  });

  it("does not try a family whose circuit a previous run opened", async () => {
    const s = scene();
    const breaker = new FamilyBreaker([["fred", { cursor: Math.floor(NOW / 1000) + 900, paused_reason: "transient: FRED download deadline exceeded [n=1]" }]]);
    const result = await runQueue([s.unit("fred_1", "fred", 20, "silent"), s.unit(EIA_ID, "eia_mer", 5, "ok")], s.options(breaker));
    expect(s.started).toEqual([EIA_ID]);
    expect(result.notStarted[0]).toMatchObject({ count: 1, sample: ["fred_1"] });
    expect(s.saved).toEqual([]);
  });

  it("past the retry time one dataset tries; its silence opens the circuit again at once", async () => {
    const s = scene();
    const breaker = new FamilyBreaker([["fred", { cursor: Math.floor(NOW / 1000) - 1, paused_reason: "transient: FRED download deadline exceeded [n=1]" }]]);
    await runQueue([s.unit("fred_1", "fred", 20, "silent"), s.unit("fred_2", "fred", 20, "silent")], s.options(breaker));
    expect(s.started).toEqual(["fred_1"]);
    expect(s.saved).toEqual([["fred", { cursor: Math.floor(NOW / 1000) + 20 + 3600, paused_reason: "transient: FRED download deadline exceeded [n=2]" }]]);
  });

  it("a bad file is the dataset's failure: the family keeps going", async () => {
    const s = scene();
    await runQueue([1, 2, 3].map((n) => s.unit(`fred_${n}`, "fred", 1, "bad")), s.options());
    expect(s.started).toHaveLength(3);
    expect(s.saved).toEqual([]);
  });

  it("starts nothing the rest of the run cannot cover, and still uses the time for what fits", async () => {
    const s = scene(NOW, 100);
    const result = await runQueue([s.unit(EIA_ID, "eia_mer", 5, "ok"), s.unit("fdic_current", "fdic", 16, "ok"), s.unit("fred_1", "fred", 1, "ok")], s.options());
    expect(s.started).toEqual(["fred_1"]);
    expect(result.notStarted).toEqual([
      { reason: "too little of the run left for a eia_mer transfer (120 s)", count: 1, sample: [EIA_ID] },
      { reason: "too little of the run left for a fdic transfer (300 s)", count: 1, sample: ["fdic_current"] },
    ]);
  });

  it("stops at the run's dataset limit and after a stop, and says how many were left", async () => {
    const s = scene();
    const limited = await runQueue([1, 2, 3, 4].map((n) => s.unit(`eia_${n}`, "eia_mer", 1, "ok")), s.options(new FamilyBreaker(), { maxDatasets: 2 }));
    expect(limited.attempted).toBe(2);
    expect(limited.notStarted).toEqual([{ reason: "the run's limit of 2 datasets was reached", count: 2, sample: ["eia_3", "eia_4"] }]);
    const t = scene();
    let cause: StopCause = null;
    const cut = await runQueue([1, 2, 3].map((n) => t.unit(`eia_${n}`, "eia_mer", 1, "ok")), t.options(new FamilyBreaker(), {
      stopCause: () => cause, onOutcome: () => { cause = "budget"; } }));
    expect(t.started).toEqual(["eia_1"]);
    expect(cut.notStarted).toEqual([{ reason: "the run budget was reached", count: 2, sample: ["eia_2", "eia_3"] }]);
  });

  it("a dataset someone else holds is neither an attempt nor evidence about the publisher", async () => {
    const s = scene();
    const result = await runQueue([s.unit("fred_1", "fred", 0, "leased"), s.unit("fred_2", "fred", 20, "silent"), s.unit("fred_3", "fred", 0, "leased"), s.unit("fred_4", "fred", 20, "silent")],
      s.options(new FamilyBreaker(), { maxDatasets: 2 }));
    expect(result.attempted).toBe(2);
    expect(s.saved).toHaveLength(1);
  });
});

describe("receipt and exit code", () => {
  const outcomes: RefreshOutcome[] = [
    { id: "official_04_energy_raw_mer_tc1_80537cb39f", family: "eia_mer", outcome: "staged", snapshot_id: "cf8d3ac4".padEnd(64, "0"), rows: 630 },
    { id: EIA_ID, family: "eia_mer", outcome: "unchanged" },
    { id: "fhfa_tract", family: "fhfa", outcome: "held", reason: "Native header labels or order changed; schema review is required before publication.", snapshot_id: "d".repeat(64) },
    { id: FRED_ID, family: "fred", outcome: "failed", fault: "provider", error: "FRED download deadline exceeded" },
    { id: "fred_pces", family: "fred", outcome: "failed", fault: "provider", error: "FRED request failed (network_error) https://fred.stlouisfed.org/graph/fredgraph.csv?id=PCES&cosd=1959-01-01" },
    { id: "fdic_current", family: "fdic", outcome: "skipped", reason: "another collector holds this dataset" },
  ];
  const receipt = refreshReceipt({
    mode: "all", startedMs: NOW, finishedMs: NOW + 54_300, due: 9, outcomes,
    notStarted: [{ reason: "fred is paused until 2026-11-25T19:30:40.000Z: FRED download deadline exceeded", count: 3, sample: ["a", "b", "c"] }],
    switchedOff: [], circuits: { fred: { state: "open", retry_at: "2026-11-25T19:30:40.000Z", trips: 1, reason: "FRED download deadline exceeded" } },
    stop: null,
  });

  it("lists the ids checked, unchanged, staged and failed, with the first error", () => {
    expect(receipt).toMatchObject({
      script: "source-refresh", mode: "all", seconds: 54.3, items: 3, due: 9, due_remaining: 3,
      checked: [EIA_ID, "official_04_energy_raw_mer_tc1_80537cb39f", "fhfa_tract"],
      unchanged: [EIA_ID],
      staged: [{ id: "official_04_energy_raw_mer_tc1_80537cb39f", snapshot_id: "cf8d3ac4".padEnd(64, "0"), rows: 630 }],
      held: [{ id: "fhfa_tract", reason: "Native header labels or order changed; schema review is required before publication." }],
      first_error: `${FRED_ID}: FRED download deadline exceeded`,
      waiting: [{ id: "fdic_current", reason: "another collector holds this dataset" }],
      paused_families: { fred: { state: "open", trips: 1 } },
    });
    expect(receipt.failed).toEqual([
      { id: FRED_ID, family: "fred", fault: "provider", error: "FRED download deadline exceeded" },
      { id: "fred_pces", family: "fred", fault: "provider", error: "FRED request failed (network_error) https://fred.stlouisfed.org/graph/fredgraph.csv" },
    ]);
    // nothing is said about a stop or a run error when there was none
    expect(Object.keys(receipt)).not.toEqual(expect.arrayContaining(["error", "budget_reached", "stopped_by_signal", "switched_off", "fred_probe"]));
  });

  it("says which families are switched off, that the budget was reached, and what failed the run itself", () => {
    const r = refreshReceipt({ mode: "all", startedMs: NOW, finishedMs: NOW + 1000, due: 0, outcomes: [], notStarted: [],
      switchedOff: [{ family: "fred", variable: "OFFICIAL_FRED_ENABLED", datasets: 120 }], circuits: {}, stop: "budget",
      runError: "List refresh datasets: no reply https://x.supabase.co/rest/v1/source_datasets?select=*&apikey=sb_secret_abc" });
    expect(r).toMatchObject({ items: 0, checked: [], failed: [], due_remaining: 0, budget_reached: true,
      switched_off: [{ family: "fred", variable: "OFFICIAL_FRED_ENABLED", datasets: 120 }] });
    expect(r.error).toBe("List refresh datasets: no reply https://x.supabase.co/rest/v1/source_datasets");
  });

  it("says a run failed when it attempted datasets and checked none, and still ends with 0 (review int-code S2)", () => {
    const base = { mode: "all" as const, startedMs: NOW, finishedMs: NOW + 41_000, due: 5, notStarted: [], switchedOff: [], circuits: {}, stop: null };
    const failedOnly = outcomes.filter((o) => o.outcome === "failed" || o.outcome === "skipped");
    expect(refreshReceipt({ ...base, outcomes: failedOnly })).toMatchObject({
      ok: false, items: 0, checked: [], error: "all 2 datasets attempted failed; none was checked", first_error: `${FRED_ID}: FRED download deadline exceeded`,
    });
    expect(refreshReceipt({ ...base, outcomes: failedOnly.slice(0, 1) }).error).toBe("the one dataset attempted failed; none was checked");
    // the run itself still worked: the lane keeps its pace
    expect(refreshExitCode({ stop: null, runError: false })).toBe(0);
    // one dataset checked, or nothing attempted, claims no failure
    expect("ok" in receipt).toBe(false);
    expect(refreshReceipt({ ...base, outcomes: outcomes.filter((o) => o.outcome === "skipped") })).not.toHaveProperty("ok");
    // a run error keeps its own text
    expect(refreshReceipt({ ...base, outcomes: failedOnly, runError: "Read refresh states: no reply" })).toMatchObject({ ok: false, error: "Read refresh states: no reply" });
  });

  it("ends with 0 when the run worked, whatever the datasets did", () => {
    // exit 1 on any dataset failure and 124 on the budget is what backed the whole lane off to hourly
    expect(refreshExitCode({ stop: null, runError: false })).toBe(0);
    expect(refreshExitCode({ stop: "budget", runError: false })).toBe(0);
    expect(refreshExitCode({ stop: null, runError: true })).toBe(1);
    expect(refreshExitCode({ stop: "budget", runError: true })).toBe(1);
    expect(refreshExitCode({ stop: "signal", runError: false })).toBe(124);
    expect(refreshExitCode({ stop: "signal", runError: true })).toBe(124);
  });
});

describe("FRED reachability probe", () => {
  const servers: { close: () => void }[] = [];
  afterEach(() => {
    for (const s of servers.splice(0)) s.close();
  });
  const result = (name: string, status: number | null): FredProbeResult => ({ name, protocol: name.endsWith("http2") ? "h2" : "http/1.1", what: "", status, seconds: status ? 0.4 : 15, bytes: status ? 600 : null });
  const three = (app: number | null, old: number | null, h2: number | null) => [result("app_user_agent", app), result("old_refresh_user_agent_identity", old), result("app_user_agent_http2", h2)];

  it("asks for one small series on the reviewed endpoint", () => {
    const url = fredProbeUrl(new Date(NOW));
    expect(url).toBe("https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS10&cosd=2026-10-26");
    expect(authoritativeCsvUrl(url)?.family).toBe("fred");
  });

  it("is due at most once in six hours", () => {
    const last = Math.floor(NOW / 1000);
    expect(fredProbeDue(null, NOW)).toBe(true);
    expect(fredProbeDue(0, NOW)).toBe(true);
    expect(fredProbeDue(last, NOW + FRED_PROBE_EVERY_MS - 1000)).toBe(false);
    expect(fredProbeDue(last, NOW + FRED_PROBE_EVERY_MS)).toBe(true);
  });

  it("makes the three requests of the review: the app's, the old refresh request, and HTTP/2", () => {
    expect(fredProbeRequests().map((r) => [r.name, r.protocol, r.headers])).toEqual([
      ["app_user_agent", "http/1.1", { "User-Agent": OFFICIAL_USER_AGENT }],
      ["old_refresh_user_agent_identity", "http/1.1", { "User-Agent": FRED_PROBE_OLD_REFRESH_UA, "Accept-Encoding": "identity", Accept: "text/csv,text/plain,application/octet-stream;q=0.8" }],
      ["app_user_agent_http2", "h2", { "User-Agent": OFFICIAL_USER_AGENT }],
    ]);
  });

  it("makes each request once, one after another, and records status and seconds", async () => {
    const calls: string[] = [];
    let clock = NOW;
    let active = 0;
    const transport = (label: string, seconds: number, status: number): ProbeTransport => async (url, headers) => {
      expect(++active).toBe(1);
      calls.push(`${label} ${headers["User-Agent"]} ${url}`);
      clock += seconds * 1000;
      active--;
      return { status, bytes: 612 };
    };
    const report = await runFredProbe({ now: () => clock, transports: { "http/1.1": transport("h1", 0.4, 200), h2: transport("h2", 0.3, 403) } });
    expect(calls).toHaveLength(3);
    expect(calls.map((c) => c.split(" ")[0])).toEqual(["h1", "h1", "h2"]);
    expect(report.requests.map((r) => [r.name, r.status, r.seconds, r.bytes])).toEqual([
      ["app_user_agent", 200, 0.4, 612], ["old_refresh_user_agent_identity", 200, 0.4, 612], ["app_user_agent_http2", 403, 0.3, 612]]);
    expect(report).toMatchObject({ at: "2026-11-25T19:00:00.000Z", series: "DGS10", timeout_seconds: 15 });
  });

  it("gives a request that gets no answer its time limit and no more, with no second try", async () => {
    let asked = 0;
    const silent: ProbeTransport = () => {
      asked++;
      return new Promise(() => undefined);
    };
    const started = Date.now();
    const report = await runFredProbe({ now: Date.now, transports: { "http/1.1": silent, h2: silent }, timeoutMs: 40 });
    expect(asked).toBe(3);
    expect(Date.now() - started).toBeLessThan(1500);
    expect(report.requests.map((r) => [r.status, r.bytes, r.error])).toEqual([[null, null, "no answer in 0.04 s"], [null, null, "no answer in 0.04 s"], [null, null, "no answer in 0.04 s"]]);
    expect(report.reading).toMatch(/^none answered/);
  });

  it("stops when the run is told to stop and says the probe was cut short", async () => {
    const stop = new AbortController();
    const transport: ProbeTransport = async () => {
      stop.abort(new Error("Refresh stopped by SIGTERM"));
      return { status: 200, bytes: 1 };
    };
    const report = await runFredProbe({ now: Date.now, transports: { "http/1.1": transport, h2: transport }, signal: stop.signal });
    expect(report.requests).toHaveLength(1);
    expect(report.reading).toMatch(/cut short/);
  });

  it("reads the three results as address, user agent or protocol", () => {
    expect(readFredProbe(three(200, 200, 200))).toMatch(/^all three answered/);
    expect(readFredProbe(three(null, null, null))).toMatch(/^none answered: FRED does not serve this address/);
    expect(readFredProbe(three(403, 403, 403))).toBe("none returned 200: read the statuses");
    expect(readFredProbe(three(200, null, 200))).toBe("the app's request is answered; the old refresh request, its user agent with identity encoding, is not");
    expect(readFredProbe(three(200, null, null))).toMatch(/\(not over HTTP\/2\)/);
    expect(readFredProbe(three(null, null, 200))).toMatch(/^answered over HTTP\/2 only/);
    expect(readFredProbe(three(null, 200, 200))).toMatch(/^answered over HTTP\/2 only/);
    expect(readFredProbe(three(null, 200, null))).toMatch(/^only the old refresh request/);
    expect(readFredProbe(three(200, 200, null))).toMatch(/HTTP\/2 is not$/);
  });

  it("HTTP/1.1 transport: sends the given headers, reads the body, does not follow a redirect", async () => {
    const seen: (string | undefined)[] = [];
    const server = createServer((req, res) => {
      seen.push(req.headers["user-agent"], req.headers["accept-encoding"]);
      if (req.url === "/moved") res.writeHead(302, { Location: "/elsewhere" }).end();
      else res.writeHead(200, { "Content-Type": "text/csv" }).end("observation_date,DGS10\n2026-11-24,4.01\n");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    servers.push(server);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const probe = http1Probe();
    expect(await probe(`${base}/csv`, { "User-Agent": FRED_PROBE_OLD_REFRESH_UA, "Accept-Encoding": "identity" }, new AbortController().signal)).toEqual({ status: 200, bytes: 39 });
    expect(await probe(`${base}/moved`, { "User-Agent": OFFICIAL_USER_AGENT }, new AbortController().signal)).toEqual({ status: 302, bytes: 0 });
    expect(seen.slice(0, 2)).toEqual([FRED_PROBE_OLD_REFRESH_UA, "identity"]);
    expect(seen[2]).toBe(OFFICIAL_USER_AGENT);
  });

  it("HTTP/2 transport: speaks h2, returns status and bytes, and ends when told to", async () => {
    const seen: unknown[] = [];
    const server = createHttp2Server();
    server.on("stream", (stream, headers) => {
      seen.push(headers[":path"], headers["user-agent"]);
      if (headers[":path"] === "/silent") return;
      stream.respond({ ":status": 200, "content-type": "text/csv" });
      stream.end("observation_date,DGS10\n2026-11-24,4.01\n");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    servers.push(server);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    expect(await http2Probe(`${base}/graph/fredgraph.csv?id=DGS10`, { "User-Agent": OFFICIAL_USER_AGENT }, new AbortController().signal)).toEqual({ status: 200, bytes: 39 });
    expect(seen).toEqual(["/graph/fredgraph.csv?id=DGS10", OFFICIAL_USER_AGENT]);
    const stop = new AbortController();
    const pending = http2Probe(`${base}/silent`, { "User-Agent": OFFICIAL_USER_AGENT }, stop.signal);
    setTimeout(() => stop.abort(new Error("probe timeout")), 30);
    await expect(pending).rejects.toThrow("probe timeout");
  });
});
