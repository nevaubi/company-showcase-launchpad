/**
 * Provider health circuit backed by `job_state` rows `provider:<id>` (decisions are pure in
 * provider-health.ts). One row per provider is the single place that knows "provider X is out of
 * money / misconfigured"; every runner, lane and worker step reads it instead of finding out with
 * live calls.
 *
 *  - providerState / providerStates: cached 30 s per process to keep round trips low
 *  - providerTrip / providerTripError: write the open row (backoff grows with the failure streak)
 *  - providerHeal: close the row; when an AI provider's row was tripped, also clear the reader pauses
 *    it caused and the reports-due pause (P0-3), so quota-paused work resumes by itself. A data host
 *    (cboe, sec, …) healing touches only its own row.
 *  - withProvider: while open, fail fast without a call; when a probe is due, exactly one caller
 *    claims it (compare-and-swap on updated_at) and its result heals or re-trips the row
 *
 * Fails open: when the database cannot be read the call goes through, as before circuits existed.
 * PROVIDER_CIRCUIT=0 makes every helper a pass-through.
 */
import { classifyError, stopsProvider, type FailureClass } from "./failure";
import { AI_PROVIDERS, decide, healRow, pausedToClear, providerKey, tripClassOf, tripRow, type CircuitDecision, type CircuitRow, type ProviderId, type TripClass } from "./provider-health";

export interface CircuitStore {
  read(jobs: string[]): Promise<CircuitRow[]>;
  write(row: CircuitRow): Promise<void>;
  /** set updated_at = next where updated_at = expected; true when this caller won */
  claim(job: string, expected: string | null, next: string): Promise<boolean>;
  /** clear quota/auth reader pauses and the reports-due pause; returns rows cleared */
  clearReaderPauses(): Promise<number>;
}

export const circuitEnabled = (env: Record<string, string | undefined> = process.env) => env["PROVIDER_CIRCUIT"] !== "0";

export const CACHE_MS = 30_000;

/** Error thrown while a provider is open (callers may supply their own, e.g. OpenAIError). */
export class ProviderClosedError extends Error {
  readonly status = 0;
  constructor(
    message: string,
    readonly kind: "quota" | "auth" | "rate",
    readonly provider: ProviderId,
    readonly retryAt?: number,
  ) {
    super(message);
    this.name = "ProviderClosedError";
  }
}

export function closedMessage(id: ProviderId, d: CircuitDecision) {
  const until = d.retryAt ? new Date(d.retryAt * 1000).toISOString().slice(0, 16).replace("T", " ") : "the next probe";
  return `provider ${id} closed until ${until} UTC (${d.cls ?? "quota"}: ${(d.message ?? "").slice(0, 160)})`;
}

const closedKind = (cls: TripClass | undefined): "quota" | "auth" | "rate" => (cls === "config" ? "auth" : cls === "rate" || cls === "transient" ? "rate" : "quota");

export interface WithProviderOpts {
  /** build the error thrown while the provider is open */
  closedError?: (id: ProviderId, d: CircuitDecision) => Error;
  /** which failure classes trip the provider (default: quota and config) */
  tripOn?: (cls: FailureClass) => boolean;
  now?: () => number;
}

export function createProviderHealth(store: CircuitStore, opts: { env?: Record<string, string | undefined>; log?: (m: string) => void } = {}) {
  const env = opts.env ?? process.env;
  const log = opts.log ?? ((m: string) => console.warn(`[provider] ${m}`));
  const cache = new Map<string, { row: CircuitRow | null; at: number }>();

  async function providerStates(ids: readonly ProviderId[], now = Date.now()): Promise<Map<string, CircuitRow>> {
    const out = new Map<string, CircuitRow>();
    const missing = ids.map(providerKey).filter((k) => {
      const c = cache.get(k);
      if (c && now - c.at < CACHE_MS) {
        if (c.row) out.set(k, c.row);
        return false;
      }
      return true;
    });
    if (missing.length) {
      const rows = await store.read(missing);
      const by = new Map(rows.map((r) => [r.job, r]));
      for (const k of missing) {
        const row = by.get(k) ?? null;
        cache.set(k, { row, at: now });
        if (row) out.set(k, row);
      }
    }
    return out;
  }

  async function providerState(id: ProviderId, now = Date.now()): Promise<CircuitRow | null> {
    return (await providerStates([id], now)).get(providerKey(id)) ?? null;
  }

  async function providerDecision(id: ProviderId, now = Date.now()): Promise<CircuitDecision> {
    return decide(await providerState(id, now), now);
  }

  async function providerTrip(id: ProviderId, cls: TripClass, message: string, now = Date.now()): Promise<CircuitRow> {
    let prev: CircuitRow | null = null;
    try {
      prev = await providerState(id, now);
    } catch {
      /* trip without a streak */
    }
    // Parallel workers hit the same outage together: an open row of the same class is already right,
    // and re-tripping it would lengthen the backoff once per worker.
    // (A claimed probe also reads "open", but its retry time has passed, so a failed probe still re-trips.)
    const was = decide(prev, now);
    if (prev && was.state === "open" && was.cls === cls && Number(prev.cursor ?? 0) * 1000 > now) return prev;
    const row = tripRow(id, cls, message, prev, now);
    cache.set(row.job, { row, at: now });
    await store.write(row);
    log(`${id} tripped: ${row.paused_reason} (probe at ${new Date(Number(row.cursor) * 1000).toISOString()})`);
    return row;
  }

  /** Trip from a thrown error when its class trips providers; null otherwise. */
  async function providerTripError(id: ProviderId, e: unknown, now = Date.now(), tripOn: (cls: FailureClass) => boolean = stopsProvider): Promise<CircuitRow | null> {
    const cls = classifyError(e);
    if (!tripOn(cls)) return null;
    const message = e instanceof Error ? e.message : String(e);
    const t = tripClassOf(cls, message);
    return t ? providerTrip(id, t, message, now) : null;
  }

  /** Close the circuit. When it was tripped, resume what the outage paused (P0-3). */
  async function providerHeal(id: ProviderId, now = Date.now()): Promise<{ healed: boolean; cleared: number }> {
    let prev: CircuitRow | null = null;
    try {
      prev = await providerState(id, now);
    } catch {
      /* heal anyway */
    }
    const row = healRow(id, now);
    cache.set(row.job, { row, at: now });
    await store.write(row);
    if (!prev?.paused_reason) return { healed: false, cleared: 0 };
    // Reader and report pauses belong to the AI providers: Cboe coming back says nothing about credits.
    if (!AI_PROVIDERS.includes(id)) {
      log(`${id} healed after ${prev.paused_reason}`);
      return { healed: true, cleared: 0 };
    }
    let cleared = 0;
    try {
      cleared = await store.clearReaderPauses();
    } catch (e) {
      log(`${id} healed but clearing reader pauses failed: ${(e as Error).message}`);
    }
    log(`${id} healed after ${prev.paused_reason}; cleared ${cleared} reader pauses`);
    return { healed: true, cleared };
  }

  async function withProvider<T>(id: ProviderId, fn: () => Promise<T>, o: WithProviderOpts = {}): Promise<T> {
    if (!circuitEnabled(env)) return fn();
    const now = o.now ?? Date.now;
    const tripOn = o.tripOn ?? stopsProvider;
    let row: CircuitRow | null;
    try {
      row = await providerState(id, now());
    } catch (e) {
      log(`${id} state unreadable (${(e as Error).message.slice(0, 120)}) — calling anyway`);
      return fn();
    }
    let d = decide(row, now());
    if (d.state === "probe" && row) {
      // A cached row may be stale: re-read before claiming so a probe another process already won is respected.
      cache.delete(providerKey(id));
      try {
        row = await providerState(id, now());
        d = decide(row, now());
        if (d.state === "probe" && row) {
          const at = new Date(now()).toISOString();
          const won = await store.claim(row.job, row.updated_at, at);
          if (won) {
            row = { ...row, updated_at: at };
            cache.set(row.job, { row, at: now() });
          } else {
            cache.delete(row.job);
            d = { ...d, state: "open" };
          }
        }
      } catch (e) {
        log(`${id} probe claim failed (${(e as Error).message.slice(0, 120)}) — treating as open`);
        d = { ...d, state: "open" };
      }
    }
    if (d.state === "open") throw o.closedError ? o.closedError(id, d) : new ProviderClosedError(closedMessage(id, d), closedKind(d.cls), id, d.retryAt);
    const probing = d.state === "probe";
    try {
      const r = await fn();
      if (probing) await providerHeal(id, now()).catch((e) => log(`${id} heal write failed: ${(e as Error).message}`));
      return r;
    } catch (e) {
      if (e && typeof e === "object" && !(e as { provider?: string }).provider) (e as { provider?: string }).provider = id;
      const cls = classifyError(e);
      if (tripOn(cls)) await providerTripError(id, e, now(), tripOn).catch((err) => log(`${id} trip write failed: ${(err as Error).message}`));
      // The provider answered (it only rejected this request): it is healthy again.
      else if (probing && cls === "permanent") await providerHeal(id, now()).catch(() => undefined);
      // transient/rate during a probe: the claim expires after 10 minutes and the probe is offered again.
      throw e;
    }
  }

  const resetCache = () => cache.clear();

  /** Clear reader pauses written before the circuits existed (the loop calls it once while the route is healthy). */
  const clearStaleReaderPauses = () => store.clearReaderPauses();

  return { providerStates, providerState, providerDecision, providerTrip, providerTripError, providerHeal, withProvider, resetCache, clearStaleReaderPauses };
}

type SbLike = {
  from: (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

/** job_state-backed store (service role). */
export function supabaseCircuitStore(getClient: () => Promise<SbLike>): CircuitStore {
  return {
    async read(jobs) {
      const sb = await getClient();
      const { data, error } = await sb.from("job_state").select("job, cursor, paused_reason, updated_at").in("job", jobs);
      if (error) throw new Error(error.message);
      return (data ?? []) as CircuitRow[];
    },
    async write(row) {
      const sb = await getClient();
      const { error } = await sb.from("job_state").upsert({ job: row.job, cursor: Number(row.cursor ?? 0), paused_reason: row.paused_reason, lease_until: null, updated_at: row.updated_at ?? new Date().toISOString() });
      if (error) throw new Error(error.message);
    },
    async claim(job, expected, next) {
      const sb = await getClient();
      let q = sb.from("job_state").update({ updated_at: next }).eq("job", job);
      q = expected == null ? q.is("updated_at", null) : q.eq("updated_at", expected);
      const { data, error } = await q.select("job");
      if (error) throw new Error(error.message);
      return Array.isArray(data) && data.length === 1;
    },
    async clearReaderPauses() {
      const sb = await getClient();
      const { data, error } = await sb.from("job_state").select("job, paused_reason").not("paused_reason", "is", null).like("job", "ir-%").limit(5000);
      if (error) throw new Error(error.message);
      const jobs = pausedToClear((data ?? []) as { job: string; paused_reason: string | null }[]);
      for (let i = 0; i < jobs.length; i += 200) {
        const { error: e2 } = await sb.from("job_state").update({ paused_reason: null }).in("job", jobs.slice(i, i + 200)).not("paused_reason", "is", null);
        if (e2) throw new Error(e2.message);
      }
      // reports-due pauses itself only on AI credit outages: its probe is due now.
      await sb.from("job_state").update({ cursor: 0, paused_reason: null }).eq("job", "reports-due").not("paused_reason", "is", null);
      return jobs.length;
    },
  };
}

const defaultHealth = createProviderHealth(
  supabaseCircuitStore(async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin as unknown as SbLike),
);

export const { providerStates, providerState, providerDecision, providerTrip, providerTripError, providerHeal, withProvider, clearStaleReaderPauses } = defaultHealth;
export const resetProviderCache = defaultHealth.resetCache;
