/**
 * Failure classes shared by every job, runner and provider circuit (pure).
 *
 *   transient  network, 5xx, statement timeouts, cut-off model replies: retry the item, a few times
 *   rate       429 and throttling blocks without a money marker: retry slower, a few more times
 *   quota      no money or no allowance left (402, credit_balance_exhausted, free allowance spent):
 *              never charge the item; trip the provider and stop
 *   config     the call can never work until a person fixes something (bad key, invalid model id,
 *              missing configuration): never charge the item; trip the provider and stop
 *   permanent  everything else: the item itself is bad, charge it once
 *
 * An "Invalid model ID" or any other configuration error must never mark a document failed.
 */

export type FailureClass = "transient" | "rate" | "quota" | "config" | "permanent";

export interface FailureInput {
  /** HTTP status when known (0 or undefined when there was no response) */
  status?: number;
  /** provider error code, e.g. `insufficient_quota`, `model_not_found`, `invalid_value` */
  code?: string;
  /** an existing error kind, e.g. OpenAIError.kind (`auth`, `quota`, `rate`, `rejected`, `transient`) */
  kind?: string;
  message: string;
}

const QUOTA_RE =
  /insufficient_quota|credit_balance_exhausted|credit balance|no credits|payment_required|payment required|\bbilling\b|free allowance spent|free-only mode|credits are exhausted|insufficient credits|exceeded your current quota|spend limit|usage limit|free lane is spent/i;

const CONFIG_RE =
  /invalid model id|model_not_found|unknown model|does not exist or you do not have access|not configured|hosted tools are unavailable|invalid api key|incorrect api key|invalid x-api-key|no api key|missing api key|api key (is )?missing|is not in the free OpenAI allowance/i;

/** Database and network hiccups (shared with scripts/lib/runner.ts). */
export const TRANSIENT_INFRA_RE =
  /statement timeout|fetch failed|ECONNRESET|ETIMEDOUT|EPIPE|socket hang up|network|connection (reset|terminated|closed)|\b50[234]\b|Bad Gateway|Service Unavailable|Gateway Time-?out|<!DOCTYPE html>|upstream/i;

/**
 * A reply cut off by the output limit or a content filter: the same request gets the same cut, so
 * re-reading it at full price cannot help (review F3). Stream interruptions stay transient.
 */
const DETERMINISTIC_RE = /incomplete \((max_output_tokens|max_tokens|content_filter)\)|^OpenRouter response incomplete$/i;

const TRANSIENT_RE = /Response incomplete|response stream (incomplete|interrupted)|timed? ?out|aborted|AbortError|overloaded|temporarily unavailable/i;

const RATE_RE = /\b429\b|rate.?limit|too many requests|throttl/i;

/**
 * A 403 from an AI provider is a key or access problem only when it says so; a content-policy or
 * other request-specific 403 must not close every lane (review F5).
 */
const AUTH_403_RE = /permission|not allowed|unauthori[sz]ed|api.?key|access denied|no access|forbidden: key|unsupported_country|region|organization|account/i;

/** Messages and codes that name an AI provider, so a 401/403 is a key or access problem, not a block. */
const AI_SOURCE_RE = /openai|anthropic|openrouter|\bAI\b|gateway|claude|gpt-|gemini/i;

export const isTransientInfra = (msg: string) => TRANSIENT_INFRA_RE.test(msg);

export function classify(e: FailureInput): FailureClass {
  const status = e.status ?? 0;
  const code = e.code ?? "";
  const kind = e.kind ?? "";
  const text = `${code} ${e.message}`;
  // "free-only mode: hosted tools are unavailable" is a wiring problem, not an empty allowance.
  if (/hosted tools are unavailable/i.test(text)) return "config";
  if (status === 402 || kind === "quota" || QUOTA_RE.test(text)) return "quota";
  const aiSource = kind !== "" || AI_SOURCE_RE.test(text);
  if (
    kind === "auth" ||
    code === "model_not_found" ||
    // Only a wrong model id: "invalid_value … image too large for this model" is one request's fault.
    (code === "invalid_value" && /invalid model id/i.test(e.message)) ||
    CONFIG_RE.test(text) ||
    status === 401 ||
    (status === 403 && aiSource && AUTH_403_RE.test(text))
  )
    return "config";
  // An AI 403 without an access marker (content policy, …): this request is bad, not the provider.
  if (status === 403 && aiSource) return "permanent";
  if (DETERMINISTIC_RE.test(e.message)) return "permanent";
  // A 403 from a data host (SEC, Cboe) is a throttling block, not a bad key.
  if (status === 429 || status === 403 || kind === "rate" || RATE_RE.test(e.message)) return "rate";
  if (status >= 500 || kind === "transient" || TRANSIENT_INFRA_RE.test(e.message) || TRANSIENT_RE.test(e.message)) return "transient";
  return "permanent";
}

/** Classify anything thrown: reads `status`, `code`, `kind` and `message` when present. */
export function classifyError(e: unknown): FailureClass {
  if (e && typeof e === "object") {
    const o = e as { status?: unknown; code?: unknown; kind?: unknown; message?: unknown };
    return classify({
      status: typeof o.status === "number" ? o.status : undefined,
      code: typeof o.code === "string" ? o.code : undefined,
      kind: typeof o.kind === "string" ? o.kind : undefined,
      message: typeof o.message === "string" ? o.message : String(e),
    });
  }
  return classify({ message: String(e) });
}

export interface RetryPolicy {
  /** first backoff ceiling in ms (doubles per attempt) */
  baseMs: number;
  /** largest backoff in ms */
  capMs: number;
  /** tries an item gets in one run before it is released with an error; 0 = never charged */
  maxAttempts: number;
}

export const RETRY: Record<FailureClass, RetryPolicy> = {
  transient: { baseMs: 5_000, capMs: 5 * 60_000, maxAttempts: 4 },
  rate: { baseMs: 15_000, capMs: 15 * 60_000, maxAttempts: 6 },
  permanent: { baseMs: 0, capMs: 0, maxAttempts: 1 },
  quota: { baseMs: 0, capMs: 0, maxAttempts: 0 },
  config: { baseMs: 0, capMs: 0, maxAttempts: 0 },
};

/**
 * Wait before retry number `attempt` (0-based): full jitter `rand() * min(cap, base * 2^attempt)`.
 * A provider's Retry-After hint is honoured but never beyond the cap. Quota, config and permanent
 * return null: do not retry the item (quota/config trip the provider instead).
 */
export function retryDelayMs(cls: FailureClass, attempt: number, rand: () => number = Math.random, retryAfterMs?: number): number | null {
  const p = RETRY[cls];
  if (cls === "quota" || cls === "config" || cls === "permanent") return null;
  const ceiling = Math.min(p.capMs, p.baseMs * 2 ** Math.max(0, attempt));
  const jitter = Math.floor(Math.max(0, Math.min(1, rand())) * ceiling);
  if (retryAfterMs != null && Number.isFinite(retryAfterMs) && retryAfterMs > 0) return Math.max(jitter, Math.min(retryAfterMs, p.capMs));
  return jitter;
}

export const maxAttempts = (cls: FailureClass) => RETRY[cls].maxAttempts;

/** Classes that stop the whole run and trip the provider instead of touching the item. */
export const stopsProvider = (cls: FailureClass) => cls === "quota" || cls === "config";

/** The day's free allowance is spent: it comes back at the next UTC day, not on a backoff. */
export const isFreeAllowanceSpent = (message: string) => /free allowance spent|free-only mode|free lane is spent/i.test(message);
