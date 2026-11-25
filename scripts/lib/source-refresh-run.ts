/**
 * How one refresh run spends its time and what it reports. No database and no publisher is called
 * from here except through what the script passes in (a state store, the collectors, the probe
 * transports), so the rules are tested without either:
 *
 *   - a dataset starts only when the rest of the run covers its whole transfer;
 *   - a dataset that fails, or that the run budget cuts off, always keeps a failure state and never
 *     keeps its lock, because both are written through a store that the run's stop signal cannot cancel;
 *   - a family whose publisher does not answer twice in a row is left alone for the rest of the run
 *     and, with a growing pause, in the runs after it;
 *   - one dataset's failure is that dataset's: the run still ends with exit code 0 and lists every
 *     outcome in its receipt.
 */
import { formatReason, parseReason } from "../../src/lib/jobs/provider-health";
import {
  OFFICIAL_USER_AGENT,
  authoritativeCsvUrl,
  refreshFailure,
  type RefreshFamily,
  type RefreshState,
  type RefreshSwitchFamily,
} from "../../src/lib/sources/refresh-plan";
import { FRED_TRANSFER_TIMEOUT_MS } from "./fred-transport";
import { receiptText } from "./run-receipt";

// ---------------------------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------------------------

/** One direct CSV transfer (EIA, FHFA), every redirect included. */
export const DIRECT_TRANSFER_TIMEOUT_MS = 120_000;
/** Time kept back after a transfer for hashing, staging and the state write. */
export const START_MARGIN_MS = 10_000;

/**
 * The longest the collection of one dataset of a family may take. FRED series are small; the FDIC
 * adapter makes about twenty paced requests (16 seconds when the API answers) and may wait on
 * Retry-After; each Taiwan feed is two requests.
 */
export const TRANSFER_ALLOWANCE_MS: Record<RefreshSwitchFamily, number> = {
  fred: FRED_TRANSFER_TIMEOUT_MS,
  eia_mer: DIRECT_TRANSFER_TIMEOUT_MS,
  fhfa: DIRECT_TRANSFER_TIMEOUT_MS,
  fdic: 300_000,
  taiwan: 120_000,
};

/** A dataset is not started unless what is left of the run covers its whole transfer. */
export const canStart = (remainingMs: number, allowanceMs: number) =>
  remainingMs >= allowanceMs + START_MARGIN_MS;

// ---------------------------------------------------------------------------------------------
// Whose failure it is
// ---------------------------------------------------------------------------------------------

/**
 * `provider`: the publisher did not answer or turned this client away (no reply, a network error,
 * 403, 429, 500 and above). `dataset`: the publisher answered and the answer, or what was done with
 * it afterwards, is what failed.
 */
export type TransferFault = "provider" | "dataset";

/** A failed transfer that says whose failure it is. */
export class RefreshTransferError extends Error {
  constructor(
    message: string,
    readonly fault: TransferFault,
  ) {
    super(message);
    this.name = "RefreshTransferError";
  }
}

/** An HTTP status that means "not now" or "not you" rather than "not this file". */
export const providerStatus = (status: number) => status === 403 || status === 429 || status >= 500;

/** The child's codes that mean FRED gave no usable answer at all. */
const FRED_PROVIDER_CODES = new Set(["deadline", "network_error"]);

export function transferFault(error: unknown): TransferFault {
  const e = error as { fault?: unknown; code?: unknown; name?: unknown; status?: unknown } | null;
  if (e?.fault === "provider" || e?.fault === "dataset") return e.fault;
  if (e?.name === "FredTransportError") {
    if (FRED_PROVIDER_CODES.has(String(e.code))) return "provider";
    return e.code === "http_status" && typeof e.status === "number" && providerStatus(e.status) ? "provider" : "dataset";
  }
  return "dataset";
}

// ---------------------------------------------------------------------------------------------
// Family circuit, in the form of the provider circuit (src/lib/jobs/provider-health.ts)
// ---------------------------------------------------------------------------------------------

/** Transfers in a row that get no answer before the family is left alone. */
export const FAMILY_TRIP_AFTER = 2;
export const familyCircuitJob = (family: RefreshFamily) => `source-refresh-family:${family}`;

/** `job_state` row: cursor = retry time in epoch seconds (0 closed), paused_reason = "transient: <why> [n=<trips>]". */
export type CircuitRow = { cursor: number | null; paused_reason: string | null };
export type FamilyCircuit =
  | { state: "closed" }
  | { state: "open"; retryAt: number; trips: number; message: string }
  | { state: "probe"; trips: number; message: string };

/** Minutes until the next try after the n-th trip in a row: 30, 60, 120, 240, then every 6 hours. */
const RETRY_MINUTES = [30, 60, 120, 240, 360];
export const familyRetryAt = (trips: number, nowMs: number) =>
  Math.floor(nowMs / 1000) + 60 * (RETRY_MINUTES[Math.max(1, trips) - 1] ?? 360);

export function familyCircuit(row: CircuitRow | null | undefined, nowMs: number): FamilyCircuit {
  const parsed = parseReason(row?.paused_reason ?? null);
  if (!row || !parsed) return { state: "closed" };
  const retryAt = Number(row.cursor ?? 0);
  return retryAt > Math.floor(nowMs / 1000)
    ? { state: "open", retryAt, trips: parsed.failures, message: parsed.message }
    : { state: "probe", trips: parsed.failures, message: parsed.message };
}

/** What one attempt told about the publisher: it answered, it did not, or nothing either way. */
export type FamilyEvidence = "answered" | "provider";

/**
 * One run's view of the family circuits. Closed: two transfers in a row without an answer open it.
 * Open: nothing of the family is tried. Past the retry time one dataset is tried: an answer closes
 * the circuit, another silence opens it again for longer.
 */
export class FamilyBreaker {
  private readonly rows = new Map<string, CircuitRow>();
  private readonly streak = new Map<string, number>();

  constructor(
    rows: Iterable<readonly [string, CircuitRow | null | undefined]> = [],
    /** an operator's run of one named dataset is never held back and never moves the circuit on a failure */
    private readonly bypass = false,
  ) {
    for (const [family, row] of rows) if (row) this.rows.set(family, row);
  }

  state(family: string, nowMs: number): FamilyCircuit {
    return familyCircuit(this.rows.get(family), nowMs);
  }

  /** Why the family is not tried now; null when it may be. */
  blocked(family: string, nowMs: number): string | null {
    if (this.bypass) return null;
    const c = this.state(family, nowMs);
    if (c.state !== "open") return null;
    return `${family} is paused until ${new Date(c.retryAt * 1000).toISOString()}: ${c.message}`;
  }

  /** Takes one attempt's evidence. Returns the row to store when the circuit changed. */
  record(family: string, evidence: FamilyEvidence, message: string, nowMs: number): CircuitRow | null {
    const c = this.state(family, nowMs);
    if (evidence === "answered") {
      this.streak.set(family, 0);
      if (c.state === "closed") return null;
      this.rows.delete(family);
      return { cursor: 0, paused_reason: null };
    }
    if (this.bypass) return null;
    const streak = (this.streak.get(family) ?? 0) + 1;
    this.streak.set(family, streak);
    if (c.state === "closed" && streak < FAMILY_TRIP_AFTER) return null;
    const trips = c.state === "closed" ? 1 : c.trips + 1;
    const row: CircuitRow = {
      cursor: familyRetryAt(trips, nowMs),
      paused_reason: formatReason("transient", receiptText(message, 200) || "no answer", trips),
    };
    this.rows.set(family, row);
    return row;
  }

  /** The circuits that are not closed, for the receipt. */
  summary(nowMs: number): Record<string, { state: "open" | "probe"; retry_at: string | null; trips: number; reason: string }> {
    const out: Record<string, { state: "open" | "probe"; retry_at: string | null; trips: number; reason: string }> = {};
    for (const family of this.rows.keys()) {
      const c = this.state(family, nowMs);
      if (c.state === "closed") continue;
      out[family] = {
        state: c.state,
        retry_at: c.state === "open" ? new Date(c.retryAt * 1000).toISOString() : null,
        trips: c.trips,
        reason: c.message,
      };
    }
    return out;
  }
}

// ---------------------------------------------------------------------------------------------
// One dataset
// ---------------------------------------------------------------------------------------------

/** Why the run is stopping: its own time budget, or a signal from outside. */
export type StopCause = "budget" | "signal" | null;

/**
 * Per-dataset state and locks. The implementation must not share the run's stop signal: these
 * calls are what still has to happen after the run was told to stop.
 */
export interface RefreshStore {
  readState(id: string): Promise<RefreshState>;
  writeState(id: string, state: RefreshState): Promise<void>;
  /** false when another collector holds the dataset */
  claim(id: string): Promise<boolean>;
  release(id: string): Promise<void>;
}

/** A store call that failed: the run's failure (the database), never the dataset's. */
export class RefreshStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefreshStoreError";
  }
}

export type Worked =
  | { outcome: "unchanged" }
  | { outcome: "staged"; snapshot_id: string; rows: number }
  | { outcome: "held"; reason: string; snapshot_id?: string | null }
  | { outcome: "skipped"; reason: string };

export type RefreshOutcome = { id: string; family: string } & (
  | Worked
  | { outcome: "failed"; error: string; fault: TransferFault | "budget" }
);

export type AttemptInput = {
  id: string;
  family: string;
  store: RefreshStore;
  stopCause: () => StopCause;
  /** The collection. `state` is what was stored before this attempt; it writes its own success state. */
  work: (state: RefreshState) => Promise<Worked>;
  /** Runs whatever happened, before the lock is released (the work folder). */
  cleanup?: (outcome: RefreshOutcome) => Promise<void>;
  now?: () => Date;
};

/**
 * Collects one dataset under its lock. Whatever happens the lock is released, and a failure is
 * written to the dataset's state so that it backs off instead of being first in line again:
 *   - an error: the state records it, the next try is later (30 minutes, doubling to a day);
 *   - the run budget running out underway: the same, with that reason;
 *   - a stop signal from outside: nothing is counted against the dataset.
 * Throws only `RefreshStoreError`, when the state store itself fails.
 */
export async function attemptDataset(o: AttemptInput): Promise<RefreshOutcome> {
  const now = o.now ?? (() => new Date());
  const tag = { id: o.id, family: o.family };
  if (!(await o.store.claim(o.id)))
    return { ...tag, outcome: "skipped", reason: "another collector holds this dataset" };
  let state: RefreshState = {};
  let outcome: RefreshOutcome | null = null;
  let storeFailure: RefreshStoreError | null = null;
  try {
    state = await o.store.readState(o.id);
    outcome = { ...tag, ...(await o.work(state)) };
  } catch (error) {
    if (error instanceof RefreshStoreError) storeFailure = error;
    else {
      const cause = o.stopCause();
      if (cause === "signal")
        outcome = { ...tag, outcome: "skipped", reason: "stopped by a signal before it finished; nothing counted" };
      else {
        const text = receiptText(error, 600) || "unknown error";
        const message = cause === "budget" ? `Run budget reached before this dataset finished: ${text}` : text;
        outcome = { ...tag, outcome: "failed", error: receiptText(message), fault: cause === "budget" ? "budget" : transferFault(error) };
        try {
          await o.store.writeState(o.id, refreshFailure(state, now(), message));
        } catch (e) {
          storeFailure = e instanceof RefreshStoreError ? e : new RefreshStoreError(receiptText(e));
        }
      }
    }
  } finally {
    const final: RefreshOutcome = outcome ?? { ...tag, outcome: "failed", error: "state store failed", fault: "dataset" };
    await o.cleanup?.(final).catch(() => undefined);
    try {
      await o.store.release(o.id);
    } catch (e) {
      storeFailure ??= e instanceof RefreshStoreError ? e : new RefreshStoreError(receiptText(e));
    }
  }
  if (storeFailure) throw storeFailure;
  return outcome!;
}

// ---------------------------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------------------------

export type QueueUnit = {
  id: string;
  family: RefreshSwitchFamily;
  /** the family circuit this dataset belongs to; the native adapters have none */
  circuit?: RefreshFamily;
  attempt: () => Promise<RefreshOutcome>;
};

export type NotStarted = { reason: string; count: number; sample: string[] };

export type QueueResult = {
  outcomes: RefreshOutcome[];
  notStarted: NotStarted[];
  /** datasets whose transfer was started */
  attempted: number;
};

export type QueueOptions = {
  maxDatasets: number;
  /** epoch ms the run must be done by */
  deadline: number;
  now: () => number;
  stopCause: () => StopCause;
  breaker: FamilyBreaker;
  /** stores a changed circuit row; a failure here is the run's */
  saveCircuit: (family: RefreshFamily, row: CircuitRow) => Promise<void>;
  onOutcome?: (outcome: RefreshOutcome) => void;
};

/**
 * Works through the due datasets in the order given. A dataset is left for a later run when the
 * limit of the run is reached, when its family is paused, or when too little of the run is left for
 * its transfer; the reasons are counted, not listed id by id.
 */
export async function runQueue(units: QueueUnit[], o: QueueOptions): Promise<QueueResult> {
  const outcomes: RefreshOutcome[] = [];
  const reasons = new Map<string, NotStarted>();
  const leave = (unit: QueueUnit, reason: string) => {
    const entry = reasons.get(reason) ?? { reason, count: 0, sample: [] };
    entry.count++;
    if (entry.sample.length < 3) entry.sample.push(unit.id);
    reasons.set(reason, entry);
  };
  let attempted = 0;
  for (const unit of units) {
    const stop = o.stopCause();
    if (stop) {
      leave(unit, stop === "budget" ? "the run budget was reached" : "the run was stopped by a signal");
      continue;
    }
    if (attempted >= o.maxDatasets) {
      leave(unit, `the run's limit of ${o.maxDatasets} datasets was reached`);
      continue;
    }
    const paused = unit.circuit ? o.breaker.blocked(unit.circuit, o.now()) : null;
    if (paused) {
      leave(unit, paused);
      continue;
    }
    if (!canStart(o.deadline - o.now(), TRANSFER_ALLOWANCE_MS[unit.family])) {
      leave(unit, `too little of the run left for a ${unit.family} transfer (${TRANSFER_ALLOWANCE_MS[unit.family] / 1000} s)`);
      continue;
    }
    const outcome = await unit.attempt();
    outcomes.push(outcome);
    o.onOutcome?.(outcome);
    if (outcome.outcome !== "skipped") attempted++;
    if (!unit.circuit || outcome.outcome === "skipped") continue;
    if (outcome.outcome === "failed" && outcome.fault === "budget") continue;
    const evidence: FamilyEvidence = outcome.outcome === "failed" && outcome.fault === "provider" ? "provider" : "answered";
    const changed = o.breaker.record(unit.circuit, evidence, outcome.outcome === "failed" ? outcome.error : "", o.now());
    if (changed) await o.saveCircuit(unit.circuit, changed);
  }
  return { outcomes, notStarted: [...reasons.values()], attempted };
}

// ---------------------------------------------------------------------------------------------
// Receipt and exit code
// ---------------------------------------------------------------------------------------------

export type ReceiptInput = {
  mode: "all" | "dataset";
  startedMs: number;
  finishedMs: number;
  /** datasets due when the run was planned, after the family switches */
  due: number;
  outcomes: RefreshOutcome[];
  notStarted: NotStarted[];
  /** families switched off, with the variable that says so */
  switchedOff: { family: string; variable: string; datasets?: number }[];
  circuits: ReturnType<FamilyBreaker["summary"]>;
  probe?: FredProbeReport | null;
  stop: StopCause;
  /** the run itself failed (planning, the state store): the text, already safe to store */
  runError?: string | null;
};

/**
 * What the run did, for `job_runs.detail`: the ids the publisher answered for (`checked`), which of
 * them were unchanged, staged or held for review, the ids that failed with their error, and why
 * anything due was not started. `items` counts the checked ids.
 */
export function refreshReceipt(i: ReceiptInput): Record<string, unknown> {
  const of = <K extends RefreshOutcome["outcome"]>(kind: K) =>
    i.outcomes.filter((x): x is Extract<RefreshOutcome, { outcome: K }> => x.outcome === kind);
  const unchanged = of("unchanged").map((x) => x.id);
  const staged = of("staged").map((x) => ({ id: x.id, snapshot_id: x.snapshot_id, rows: x.rows }));
  const held = of("held").map((x) => ({ id: x.id, reason: receiptText(x.reason, 200) }));
  const failed = of("failed").map((x) => ({ id: x.id, family: x.family, fault: x.fault, error: receiptText(x.error, 200) }));
  const waiting = of("skipped").map((x) => ({ id: x.id, reason: receiptText(x.reason, 120) }));
  const checked = [...unchanged, ...staged.map((x) => x.id), ...held.map((x) => x.id)];
  const left = i.notStarted.reduce((n, x) => n + x.count, 0);
  return {
    script: "source-refresh",
    mode: i.mode,
    seconds: Math.round((i.finishedMs - i.startedMs) / 100) / 10,
    items: checked.length,
    due: i.due,
    checked,
    unchanged,
    staged,
    ...(held.length ? { held } : {}),
    failed,
    ...(failed.length ? { first_error: `${failed[0].id}: ${failed[0].error}` } : {}),
    ...(waiting.length ? { waiting } : {}),
    ...(left ? { not_started: i.notStarted, due_remaining: left } : { due_remaining: 0 }),
    ...(i.switchedOff.length ? { switched_off: i.switchedOff } : {}),
    ...(Object.keys(i.circuits).length ? { paused_families: i.circuits } : {}),
    ...(i.probe ? { fred_probe: i.probe } : {}),
    ...(i.stop === "budget" ? { budget_reached: true } : {}),
    ...(i.stop === "signal" ? { stopped_by_signal: true } : {}),
    ...(i.runError ? { error: receiptText(i.runError, 300) } : {}),
  };
}

/**
 * 0: the run did its work, whatever each dataset's outcome (a failed dataset has its own state and
 * its own next try). 124: a signal stopped it. 1: the run itself failed (planning or the state store).
 * A run that reached its own budget and still recorded everything is a run that worked.
 */
export function refreshExitCode(i: { stop: StopCause; runError: boolean }): number {
  if (i.stop === "signal") return 124;
  return i.runError ? 1 : 0;
}

// ---------------------------------------------------------------------------------------------
// FRED reachability probe
// ---------------------------------------------------------------------------------------------

export const FRED_PROBE_JOB = "source-refresh-probe:fred";
export const FRED_PROBE_EVERY_MS = 6 * 3600_000;
export const FRED_PROBE_TIMEOUT_MS = 15_000;
export const FRED_PROBE_SERIES = "DGS10";
const FRED_PROBE_MAX_BYTES = 64 * 1024;
/** The user agent the refresh sent until 25 Nov 2026. Kept only so the probe can repeat that request. */
export const FRED_PROBE_OLD_REFRESH_UA = "FiledUnder official-data refresh";

/** One small series, the last thirty days: under a kilobyte. Refused unless it is the reviewed endpoint. */
export function fredProbeUrl(now: Date): string {
  const since = new Date(now.getTime() - 30 * 24 * 3600_000).toISOString().slice(0, 10);
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${FRED_PROBE_SERIES}&cosd=${since}`;
  if (authoritativeCsvUrl(url)?.family !== "fred") throw new Error("FRED probe address is outside the reviewed endpoint");
  return url;
}

/** Due when no probe is on record or the last one is six hours old. `last` is epoch seconds. */
export const fredProbeDue = (last: number | null | undefined, nowMs: number) =>
  !last || !Number.isFinite(last) || nowMs - last * 1000 >= FRED_PROBE_EVERY_MS;

export type ProbeProtocol = "http/1.1" | "h2";
export type FredProbeRequest = { name: string; protocol: ProbeProtocol; headers: Record<string, string>; what: string };

/**
 * The three requests that separate the possible causes (review rev-workers, "Needed from lead"):
 * the app's own request, which the app host gets answered in under a second; the request the
 * refresh sent while every transfer failed; and the app's request over HTTP/2, the protocol a
 * command-line client would have chosen. Both runtimes on the worker speak HTTP/1.1 otherwise.
 */
export function fredProbeRequests(): FredProbeRequest[] {
  return [
    { name: "app_user_agent", protocol: "http/1.1", headers: { "User-Agent": OFFICIAL_USER_AGENT },
      what: "contact user agent, the runtime's default headers, HTTP/1.1 (what the app's macro job sends)" },
    { name: "old_refresh_user_agent_identity", protocol: "http/1.1",
      headers: { "User-Agent": FRED_PROBE_OLD_REFRESH_UA, "Accept-Encoding": "identity", Accept: "text/csv,text/plain,application/octet-stream;q=0.8" },
      what: "the refresh user agent used until 25 Nov 2026 with Accept-Encoding: identity, HTTP/1.1" },
    { name: "app_user_agent_http2", protocol: "h2", headers: { "User-Agent": OFFICIAL_USER_AGENT },
      what: "contact user agent over HTTP/2" },
  ];
}

export type FredProbeResult = {
  name: string;
  protocol: ProbeProtocol;
  what: string;
  /** HTTP status; null when no response arrived */
  status: number | null;
  seconds: number;
  /** body bytes read (at most 64 KiB); null without a response */
  bytes: number | null;
  error?: string;
};
export type FredProbeReport = {
  at: string;
  series: string;
  timeout_seconds: number;
  requests: FredProbeResult[];
  reading: string;
};

export type ProbeTransport = (url: string, headers: Record<string, string>, signal: AbortSignal) => Promise<{ status: number; bytes: number }>;
export type ProbeTransports = Record<ProbeProtocol, ProbeTransport>;

/** What the three results say, in one sentence. Only a 200 counts as answered. */
export function readFredProbe(results: readonly FredProbeResult[]): string {
  const by = (name: string) => results.find((r) => r.name === name);
  const ok = (name: string) => by(name)?.status === 200;
  const app = ok("app_user_agent");
  const old = ok("old_refresh_user_agent_identity");
  const h2 = ok("app_user_agent_http2");
  if (results.length < 3) return "the probe was cut short; read the requests that ran";
  if (app && old && h2) return "all three answered: this address is served with either user agent and either protocol";
  if (!app && !old && !h2)
    return results.every((r) => r.status === null)
      ? "none answered: FRED does not serve this address or this client; collect FRED on the app host or through the keyed API"
      : "none returned 200: read the statuses";
  if (app && !old) return `the app's request is answered${h2 ? "" : " (not over HTTP/2)"}; the old refresh request, its user agent with identity encoding, is not`;
  if (!app && h2) return "answered over HTTP/2 only: HTTP/1.1 requests from this address are not served";
  if (!app && old) return "only the old refresh request is answered; the contact user agent is not";
  return "the app's request and the old refresh request are answered over HTTP/1.1; HTTP/2 is not";
}

/**
 * Makes the three requests one after another, each once, each given `timeoutMs` and no more. A
 * request that gets no response is recorded with status null and the seconds it waited.
 */
export async function runFredProbe(o: {
  now: () => number;
  transports: ProbeTransports;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<FredProbeReport> {
  const timeoutMs = o.timeoutMs ?? FRED_PROBE_TIMEOUT_MS;
  const at = new Date(o.now());
  const url = fredProbeUrl(at);
  const requests: FredProbeResult[] = [];
  for (const request of fredProbeRequests()) {
    if (o.signal?.aborted) break;
    const started = o.now();
    const limit = new AbortController();
    const timer = setTimeout(() => limit.abort(new Error("probe timeout")), timeoutMs);
    const signal = o.signal ? AbortSignal.any([o.signal, limit.signal]) : limit.signal;
    const base = { name: request.name, protocol: request.protocol, what: request.what };
    let entry: Omit<FredProbeResult, "seconds">;
    let onAbort: (() => void) | undefined;
    try {
      // The race also bounds a transport that ignores its signal.
      const answer = await Promise.race([
        o.transports[request.protocol](url, request.headers, signal),
        new Promise<never>((_, reject) => {
          onAbort = () => reject(signal.reason);
          signal.addEventListener("abort", onAbort, { once: true });
        }),
      ]);
      entry = { ...base, status: answer.status, bytes: answer.bytes };
    } catch (error) {
      entry = { ...base, status: null, bytes: null,
        error: limit.signal.aborted ? `no answer in ${timeoutMs / 1000} s` : receiptText(error, 160) || "request failed" };
    } finally {
      clearTimeout(timer);
      if (onAbort) signal.removeEventListener("abort", onAbort);
    }
    requests.push({ ...entry, seconds: Math.round((o.now() - started) / 100) / 10 });
  }
  return { at: at.toISOString(), series: FRED_PROBE_SERIES, timeout_seconds: timeoutMs / 1000, requests, reading: readFredProbe(requests) };
}

async function drain(body: ReadableStream<Uint8Array> | null, max: number): Promise<number> {
  if (!body) return 0;
  const reader = body.getReader();
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes >= max) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return bytes;
}

/** HTTP/1.1 through the runtime's own fetch. A redirect is recorded as its status, not followed. */
export const http1Probe = (fetchImpl: typeof fetch = fetch): ProbeTransport => async (url, headers, signal) => {
  const response = await fetchImpl(url, { headers, redirect: "manual", signal });
  return { status: response.status, bytes: await drain(response.body, FRED_PROBE_MAX_BYTES) };
};

/**
 * HTTP/2 through node:http2 (ALPN on TLS). The session is closed as soon as the answer is read. The
 * module is loaded only here: a runtime without an HTTP/2 client fails this one request (recorded as
 * its error), never the refresh run that imports these rules.
 */
export const http2Probe: ProbeTransport = async (url, headers, signal) => {
  const { connect: connectHttp2 } = await import("node:http2");
  return await new Promise((resolve, reject) => {
    const target = new URL(url);
    const session = connectHttp2(target.origin);
    let settled = false;
    let status = 0;
    let bytes = 0;
    const finish = (error: unknown) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", aborted);
      session.destroy();
      if (error) reject(error instanceof Error ? error : new Error(String(error)));
      else if (!status) reject(new Error("HTTP/2 stream ended without a response"));
      else resolve({ status, bytes });
    };
    const aborted = () => finish(signal.reason ?? new Error("HTTP/2 probe stopped"));
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) {
      aborted();
      return;
    }
    // `on`, not `once`: a second error after the first (a stream torn down by destroy) must not go unheard.
    session.on("error", finish);
    const stream = session.request({
      ":method": "GET",
      ":path": target.pathname + target.search,
      ...Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])),
    });
    stream.once("response", (head) => {
      status = Number(head[":status"] ?? 0);
    });
    stream.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes >= FRED_PROBE_MAX_BYTES) finish(null);
    });
    stream.once("end", () => finish(null));
    stream.on("error", finish);
    stream.end();
  });
};
