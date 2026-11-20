/**
 * Provider health circuit (pure): one `job_state` row per provider says whether calls may go out.
 *
 * Serialised form (row `job_state.job = 'provider:<id>'`):
 *   cursor        retry-at in epoch seconds; 0 = closed (healthy)
 *   paused_reason `"<class>: <message> [n=<failures>]"` while tripped, null when healthy
 *   updated_at    last trip, heal or probe claim
 *
 * States:
 *   closed  paused_reason null: calls go through
 *   open    tripped and retry-at still in the future, or a probe was claimed less than 10 min ago
 *   probe   tripped, retry-at passed and nobody claimed the probe yet: exactly one caller may try
 *
 * What opens it: a quota or config failure (and repeated rate blocks on data hosts). A successful
 * probe heals the row (closed); a failed probe trips it again with the next backoff step.
 */
import { classify, isFreeAllowanceSpent, type FailureClass } from "./failure";

export type ProviderId =
  | "openai-paid"
  | "openai-free-mini"
  | "openai-free-large"
  | "gateway"
  | "anthropic"
  | "openrouter-free"
  | "cboe"
  | "sec"
  | "fred"
  | "firecrawl"
  | "tavily"
  | "partner";

export const PROVIDER_IDS: readonly ProviderId[] = ["openai-paid", "openai-free-mini", "openai-free-large", "gateway", "anthropic", "openrouter-free", "cboe", "sec", "fred", "firecrawl", "tavily", "partner"];

/** Providers that read IR documents; a heal on one of them resumes the AI lanes. */
export const AI_PROVIDERS: readonly ProviderId[] = ["openai-paid", "openai-free-mini", "openai-free-large", "gateway", "anthropic", "openrouter-free"];

export const PROVIDER_PREFIX = "provider:";
export const providerKey = (id: ProviderId) => `${PROVIDER_PREFIX}${id}`;
export const providerIdOf = (job: string): ProviderId | null => {
  if (!job.startsWith(PROVIDER_PREFIX)) return null;
  const id = job.slice(PROVIDER_PREFIX.length) as ProviderId;
  return PROVIDER_IDS.includes(id) ? id : null;
};

/** Trip classes: a failure class, or `allowance` (the free daily allowance is spent until next UTC day). */
export type TripClass = Exclude<FailureClass, "permanent"> | "allowance";

export type CircuitState = "closed" | "open" | "probe";

export interface CircuitRow {
  job: string;
  cursor: number | null;
  paused_reason: string | null;
  updated_at: string | null;
}

export interface CircuitDecision {
  state: CircuitState;
  /** epoch seconds when the next probe is due (open only) */
  retryAt?: number;
  cls?: TripClass;
  message?: string;
  failures?: number;
}

/** A probe claim older than this is treated as abandoned and the probe is offered again. */
export const PROBE_CLAIM_TTL_MS = 10 * 60_000;

const TRIP_CLASSES: readonly TripClass[] = ["quota", "config", "rate", "transient", "allowance"];

/** `"quota: OpenAI 429 … [n=3]"` → parts. Unknown prefixes read as quota, so an odd row still holds calls back. */
export function parseReason(reason: string | null): { cls: TripClass; message: string; failures: number } | null {
  if (reason == null) return null;
  const m = /^([a-z]+):\s?([\s\S]*?)(?:\s\[n=(\d+)\])?$/.exec(reason);
  const cls = m && (TRIP_CLASSES as string[]).includes(m[1]) ? (m[1] as TripClass) : "quota";
  const message = m ? m[2] : reason;
  const failures = m?.[3] ? Number(m[3]) : 1;
  return { cls, message, failures };
}

export const formatReason = (cls: TripClass, message: string, failures: number) => `${cls}: ${message.replace(/\s+/g, " ").trim().slice(0, 300)} [n=${Math.max(1, failures)}]`;

/** The trip class of a failure, or null when it should not trip a provider (permanent: the item is bad). */
export function tripClassOf(cls: FailureClass, message: string): TripClass | null {
  if (cls === "permanent") return null;
  if (cls === "quota" && isFreeAllowanceSpent(message)) return "allowance";
  return cls;
}

export function decide(row: CircuitRow | null | undefined, nowMs: number): CircuitDecision {
  const parsed = parseReason(row?.paused_reason ?? null);
  if (!row || !parsed) return { state: "closed" };
  const retryAt = Number(row.cursor ?? 0);
  const nowS = Math.floor(nowMs / 1000);
  const base = { cls: parsed.cls, message: parsed.message, failures: parsed.failures };
  if (retryAt > nowS) return { state: "open", retryAt, ...base };
  const touched = row.updated_at ? Date.parse(row.updated_at) : 0;
  // Claimed after the retry time and recently: someone is probing right now.
  if (touched >= retryAt * 1000 && nowMs - touched < PROBE_CLAIM_TTL_MS) return { state: "open", retryAt: Math.ceil((touched + PROBE_CLAIM_TTL_MS) / 1000), ...base };
  return { state: "probe", ...base };
}

/** Seconds since epoch at 00:05 UTC of the next day (the free allowance resets at UTC midnight). */
export function nextUtcDay(nowMs: number): number {
  const d = new Date(nowMs);
  return Math.ceil(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 5) / 1000);
}

/**
 * When the next probe is due (epoch seconds) after the `failures`-th trip in a row (1 = first).
 *  quota: 30 min, 1 h, 2 h, then 4 h · allowance: next UTC 00:05 · config: 1 h (a person must fix it)
 *  rate: 5 min, then 15 min · transient: 2 min
 */
export function nextProbe(cls: TripClass, failures: number, nowMs: number): number {
  const n = Math.max(1, failures);
  const nowS = Math.floor(nowMs / 1000);
  switch (cls) {
    case "quota":
      return nowS + ([1800, 3600, 7200][n - 1] ?? 14_400);
    case "allowance":
      return nextUtcDay(nowMs);
    case "config":
      return nowS + 3600;
    case "rate":
      return nowS + (n === 1 ? 300 : 900);
    case "transient":
      return nowS + 120;
  }
}

/** The row a trip writes. `prev` carries the failure streak, so repeated trips back off further. */
export function tripRow(id: ProviderId, cls: TripClass, message: string, prev: CircuitRow | null | undefined, nowMs: number): CircuitRow {
  const was = parseReason(prev?.paused_reason ?? null);
  const failures = was && was.cls === cls ? was.failures + 1 : 1;
  return { job: providerKey(id), cursor: nextProbe(cls, failures, nowMs), paused_reason: formatReason(cls, message, failures), updated_at: new Date(nowMs).toISOString() };
}

export const healRow = (id: ProviderId, nowMs: number): CircuitRow => ({ job: providerKey(id), cursor: 0, paused_reason: null, updated_at: new Date(nowMs).toISOString() });

/** Trip a provider from a thrown error: null when the error is not the provider's fault. */
export function tripFromError(id: ProviderId, e: { status?: number; code?: string; kind?: string; message: string }, prev: CircuitRow | null | undefined, nowMs: number): CircuitRow | null {
  const cls = tripClassOf(classify(e), e.message);
  return cls ? tripRow(id, cls, e.message, prev, nowMs) : null;
}

const FREE_LARGE = ["gpt-5.4", "gpt-5.2", "gpt-5.1", "gpt-5", "gpt-4.1", "gpt-4o", "o1", "o3"];
const FREE_MINI = ["gpt-5.4-mini", "gpt-5.4-nano", "gpt-5-mini", "gpt-5-nano", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-4o-mini", "o3-mini", "o4-mini"];
const freeTier = (model: string): "mini" | "large" | null => {
  const base = model.replace(/^openai\//, "").replace(/-\d{4}-\d{2}-\d{2}$/, "");
  return FREE_MINI.includes(base) ? "mini" : FREE_LARGE.includes(base) ? "large" : null;
};

/**
 * The providers one `openaiStructured` call tries, in order (mirrors its routing):
 *  OpenRouter ids → openrouter-free · IR_FREE_ONLY=1 → free tier of the model (mini for non-free ids),
 *  then openai-paid when IR_OPENAI_PAID=1 · claude-* → anthropic · gateway (default) · else openai-paid.
 */
export function routeOf(model: string, env: Record<string, string | undefined>): ProviderId[] {
  if (model.startsWith("inclusionai/") || model.endsWith(":free")) return ["openrouter-free"];
  if (env["IR_FREE_ONLY"] === "1") {
    const base = model.replace(/^openai\//, "");
    const tier = freeTier(base) ?? freeTier(env["IR_FREE_MODEL"] || "gpt-5.4-mini") ?? "mini";
    const route: ProviderId[] = [tier === "large" ? "openai-free-large" : "openai-free-mini"];
    if (env["IR_OPENAI_PAID"] === "1") route.push("openai-paid");
    return route;
  }
  if (model.startsWith("claude-")) return ["anthropic"];
  if ((env["IR_AI_PROVIDER"] || "gateway") !== "openai") return ["gateway"];
  return ["openai-paid"];
}

/**
 * One decision for a whole route (a reader falls through the providers in order): closed when any
 * provider on it is closed, probe when none is closed but one is due a probe, otherwise open until
 * the earliest retry time.
 */
export function routeDecision(rows: Map<string, CircuitRow> | Record<string, CircuitRow | undefined>, route: readonly ProviderId[], nowMs: number): CircuitDecision & { provider?: ProviderId } {
  const get = (id: ProviderId) => (rows instanceof Map ? rows.get(providerKey(id)) : rows[providerKey(id)]);
  let probe: (CircuitDecision & { provider: ProviderId }) | null = null;
  let open: (CircuitDecision & { provider: ProviderId }) | null = null;
  for (const id of route) {
    const d = decide(get(id), nowMs);
    if (d.state === "closed") return { state: "closed", provider: id };
    if (d.state === "probe" && !probe) probe = { ...d, provider: id };
    if (d.state === "open" && (!open || (d.retryAt ?? Infinity) < (open.retryAt ?? Infinity))) open = { ...d, provider: id };
  }
  return probe ?? open ?? { state: "closed" };
}

/**
 * How many new AI lanes the worker may start now: all of them while the route is closed, exactly one
 * (the probe) when a probe is due, none while it is open.
 */
export function lanesAllowed(decision: CircuitDecision, wanted: number): number {
  if (decision.state === "closed") return Math.max(0, wanted);
  if (decision.state === "probe") return Math.min(1, Math.max(0, wanted));
  return 0;
}

/** Reader job keys whose pauses a heal clears (P0-3). */
export const READER_PAUSE_JOB_RE = /^(ir-(prose|extract|vision)-runner(:|$)|ir-prose-verify$|ir-canon$)/;
/** Pause reasons a heal may clear: provider money or access stops written by runners and canon. */
export const READER_PAUSE_REASON_RE = /^(quota|auth|config):|credit balance exhausted|free lane is spent|free allowance spent|free-only mode|payment_required|credit_balance_exhausted/i;

/**
 * Reader pauses to clear once the provider heals: quota/auth reader rows only. Never leases
 * (`owner:`), vendor `pacing:`, `gave up` notes, budget caps or per-item receipts.
 */
export function pausedToClear(rows: { job: string; paused_reason: string | null }[]): string[] {
  return rows
    .filter((r) => r.paused_reason != null && READER_PAUSE_JOB_RE.test(r.job) && READER_PAUSE_REASON_RE.test(r.paused_reason) && !/^(owner|pacing|budget):|gave up/i.test(r.paused_reason))
    .map((r) => r.job);
}

/** Resume order after a heal: lane `i` (0-based) may start `i * stepMs` after the heal. */
export function staggerDelays(n: number, stepMs = 5 * 60_000): number[] {
  return Array.from({ length: Math.max(0, n) }, (_, i) => i * stepMs);
}
