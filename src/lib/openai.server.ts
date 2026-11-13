import { GatewayError, generateChatCompletion, generateResponse } from "@lovable.dev/ai-gateway";

// Server-only client for high-volume IR analysis (Lovable AI Gateway by default, or the owner's OPENAI_API_KEY), used for the
// high-volume investor-relations analysis (table extraction, slide vision, reconciliation repair,
// cross-document label mapping). Everything else keeps using the Lovable AI Gateway.
//
// Errors are classified so batch runners can apply a circuit breaker:
//   - "auth"      401/403, invalid key, no access to the model → stop all work
//   - "quota"     insufficient_quota / billing → stop all work
//   - "rate"      429 rate limit → back off, slow down
//   - "rejected"  400 invalid request (payload problem) → skip this item
//   - "transient" 5xx / network → item may be retried later

export const IR_MODELS = {
  /** Bulk table extraction: fast, strict-JSON capable. */
  extract: process.env["IR_EXTRACT_MODEL"] || "gpt-6.1-sol",
  /** Slide/chart reading (image input): Claude Sonnet when the owner's Anthropic key is set. */
  vision: process.env["IR_VISION_MODEL"] || (process.env["ANTHROPIC_API_KEY"] ? "claude-sonnet-5-5" : "gpt-6.1-sol"),
  /** Reconciliation repair and cross-period label mapping: strongest reasoning. */
  reason: process.env["IR_REASON_MODEL"] || "gpt-6.1-sol",
} as const;

export type Effort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type OpenAIErrorKind = "auth" | "quota" | "rate" | "rejected" | "transient";

export class OpenAIError extends Error {
  constructor(
    message: string,
    readonly kind: OpenAIErrorKind,
    readonly status: number,
    readonly retryAfterMs?: number,
    /** tokens billed for a call that still failed (cut off, refused, bad JSON) */
    readonly usage?: Usage,
  ) {
    super(message);
    this.name = "OpenAIError";
  }
}

/** IR reading runs on the Lovable AI Gateway by default; set IR_AI_PROVIDER=openai to use the owner's key. */
const useGateway = () => (process.env["IR_AI_PROVIDER"] || "gateway") !== "openai";

export const hasOpenAIKey = () => (useGateway() ? !!process.env["LOVABLE_API_KEY"] : !!process.env["OPENAI_API_KEY"]);

function gatewayKind(e: GatewayError): OpenAIErrorKind {
  switch (e.code) {
    case "payment_required":
      return "quota";
    case "authentication_error":
    case "configuration_error":
    case "permission_denied":
      return "auth";
    case "rate_limited":
      return "rate";
    case "request_rejected":
      return "rejected";
    default:
      return "transient";
  }
}

export interface ClaudeMessage {
  role: "user" | "assistant";
  content: unknown[];
}

/** Shared parts → Claude content blocks. Images go first: Claude reads an image best before the text about it. */
export function claudeContent(parts: InputPart[]): unknown[] {
  const blocks = parts.map((p) => {
    if (p.type === "input_text") return { type: "text", text: p.text };
    const m = /^data:([^;]+);base64,(.*)$/s.exec(p.image_url);
    return m ? { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } } : { type: "image", source: { type: "url", url: p.image_url } };
  });
  return [...blocks.filter((b) => b.type === "image"), ...blocks.filter((b) => b.type !== "image")];
}

/** USD per million tokens: input, output, cache read, 5-minute cache write. Only prices verified on the provider's page. */
const PRICES: [prefix: string, p: [number, number, number, number]][] = [
  ["claude-sonnet-5-5", [2, 10, 0.1, 2.5]],
  ["claude-haiku-5-5", [0.1, 0.5, 0.01, 0.125]],
];

/** Estimated spend of one call, or undefined when the model's prices aren't known here. */
export function estimateUsd(model: string, u: Usage): number | undefined {
  const p = PRICES.find(([k]) => model.startsWith(k))?.[1];
  if (!p) return undefined;
  const write = u.cache_write_tokens ?? 0;
  const fresh = Math.max(0, u.input_tokens - u.cached_tokens - write);
  return (fresh * p[0] + u.output_tokens * p[1] + u.cached_tokens * p[2] + write * p[3]) / 1e6;
}

/**
 * Owner's Anthropic key (claude-* models), multi-turn. Structured outputs give schema-exact JSON;
 * adaptive thinking stays on (the model's default) and `effort` steers its depth; instructions are
 * prompt-cached. `content` is the assistant turn as returned, to send back unchanged in a follow-up.
 */
export async function claudeStructured<T>(opts: {
  model: string;
  instructions: string;
  messages: ClaudeMessage[];
  schema: Record<string, unknown>;
  effort?: Effort;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}): Promise<{ data: T; usage: Usage; model: string; content: unknown[] }> {
  const key = process.env["ANTHROPIC_API_KEY"];
  if (!key) throw new OpenAIError("ANTHROPIC_API_KEY is not configured", "auth", 0);
  const effort = opts.effort === "minimal" || opts.effort === "none" ? "low" : opts.effort;
  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      signal: opts.signal,
      ...({ timeout: false } as Record<string, unknown>),
      body: JSON.stringify({
        model: opts.model,
        // Thinking counts toward max_tokens: leave room for it on top of the JSON.
        max_tokens: Math.min(opts.maxOutputTokens ?? 64_000, 128_000),
        system: [{ type: "text", text: opts.instructions, cache_control: { type: "ephemeral" } }],
        output_config: { format: { type: "json_schema", schema: opts.schema }, ...(effort ? { effort } : {}) },
        messages: opts.messages,
      }),
    });
  } catch (e) {
    throw new OpenAIError(`Anthropic network error: ${(e as Error).message}`, "transient", 0);
  }
  if (!res.ok) {
    const body = await res.text();
    let type = "";
    let msg = body.slice(0, 400);
    try {
      const j = JSON.parse(body) as { error?: { type?: string; message?: string } };
      type = j.error?.type ?? "";
      msg = j.error?.message ?? msg;
    } catch {
      /* not JSON */
    }
    const kind: OpenAIErrorKind =
      res.status === 401 || res.status === 403 || type === "not_found_error" ? "auth"
      : /credit balance|billing|spend limit|usage limit/i.test(msg) ? "quota"
      : res.status === 429 ? "rate"
      : res.status >= 500 || res.status === 529 ? "transient"
      : "rejected";
    const ra = Number(res.headers.get("retry-after"));
    throw new OpenAIError(`Anthropic ${res.status} ${type}: ${msg}`, kind, res.status, Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined);
  }
  const j = (await res.json()) as {
    model: string;
    stop_reason?: string;
    content?: { type: string; text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  };
  const cached = j.usage?.cache_read_input_tokens ?? 0;
  const written = j.usage?.cache_creation_input_tokens ?? 0;
  const usage: Usage = { input_tokens: (j.usage?.input_tokens ?? 0) + cached + written, output_tokens: j.usage?.output_tokens ?? 0, cached_tokens: cached, cache_write_tokens: written };
  // A cut-off answer can still hold valid-looking JSON; never trust it.
  if (j.stop_reason === "max_tokens") throw new OpenAIError("Response incomplete (max_tokens)", "rejected", 200, undefined, usage);
  if (j.stop_reason === "refusal") throw new OpenAIError("Model refused", "rejected", 200, undefined, usage);
  const text = (j.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
  let data: T;
  try {
    data = JSON.parse(text) as T;
  } catch {
    throw new OpenAIError("Model returned invalid JSON", "rejected", 200, undefined, usage);
  }
  return { data, usage, model: j.model, content: j.content ?? [] };
}

async function anthropicStructured<T>(opts: Parameters<typeof openaiStructured>[0]): Promise<{ data: T; usage: Usage; model: string }> {
  const parts: InputPart[] = typeof opts.input === "string" ? [{ type: "input_text", text: opts.input }] : opts.input;
  const r = await claudeStructured<T>({ ...opts, messages: [{ role: "user", content: claudeContent(parts) }] });
  return { data: r.data, usage: r.usage, model: r.model };
}

async function gatewayStructured<T>(opts: Parameters<typeof openaiStructured>[0]): Promise<{ data: T; usage: Usage; model: string }> {
  const content: InputPart[] = typeof opts.input === "string" ? [{ type: "input_text", text: opts.input }] : opts.input;
  const model = opts.model.includes("/") ? opts.model : `openai/${opts.model}`;
  let j: unknown;
  // Gemini models are served on the chat-completions surface only.
  if (model.startsWith("google/")) return gatewayChat<T>(opts, model, content);
  try {
    j = await generateResponse(
      {
        model: model as "openai/gpt-6.1-sol",
        instructions: opts.instructions,
        input: [{ role: "user", content }],
        ...(opts.effort ? { reasoning: { effort: opts.effort } } : {}),
        max_output_tokens: opts.maxOutputTokens ?? 64_000,
        store: false,
        text: { format: { type: "json_schema", name: opts.name, schema: opts.schema, strict: true } },
      } as unknown as Parameters<typeof generateResponse<"openai/gpt-6.1-sol">>[0], // shared InputPart shape; verified live
      opts.signal ? { signal: opts.signal } : undefined,
    );
  } catch (e) {
    if (e instanceof GatewayError) {
      const ra = e.retryAfter ? e.retryAfter * 1000 : undefined;
      throw new OpenAIError(`AI ${e.httpStatus ?? ""} ${e.code}: ${e.message}`, gatewayKind(e), e.httpStatus ?? 0, ra);
    }
    throw new OpenAIError(`AI error: ${(e as Error).message}`, "transient", 0);
  }
  return parseResponse<T>(new Response(JSON.stringify(j)));
}

async function gatewayChat<T>(opts: Parameters<typeof openaiStructured>[0], model: string, content: InputPart[]): Promise<{ data: T; usage: Usage; model: string }> {
  let j: { choices?: { message?: { content?: string | null }; finish_reason?: string }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } }; model?: string };
  try {
    j = (await generateChatCompletion(
      {
        model,
        messages: [
          { role: "system", content: opts.instructions },
          { role: "user", content: content.map((c) => (c.type === "input_text" ? { type: "text", text: c.text } : { type: "image_url", image_url: { url: c.image_url } })) },
        ],
        ...(opts.effort ? { reasoning_effort: opts.effort } : {}),
        max_tokens: opts.maxOutputTokens ?? 32_000,
        response_format: { type: "json_schema", json_schema: { name: opts.name, schema: opts.schema, strict: true } },
      } as unknown as Parameters<typeof generateChatCompletion<"openai/gpt-6.1-terra">>[0], // shared shape across chat models; verified live
      opts.signal ? { signal: opts.signal } : undefined,
    )) as typeof j;
  } catch (e) {
    if (e instanceof GatewayError) {
      const ra = e.retryAfter ? e.retryAfter * 1000 : undefined;
      throw new OpenAIError(`AI ${e.httpStatus ?? ""} ${e.code}: ${e.message}`, gatewayKind(e), e.httpStatus ?? 0, ra);
    }
    throw new OpenAIError(`AI error: ${(e as Error).message}`, "transient", 0);
  }
  const usage: Usage = { input_tokens: j.usage?.prompt_tokens ?? 0, output_tokens: j.usage?.completion_tokens ?? 0, cached_tokens: j.usage?.prompt_tokens_details?.cached_tokens ?? 0 };
  const text = j.choices?.[0]?.message?.content ?? "";
  try {
    return { data: JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")) as T, usage, model: j.model ?? model };
  } catch {
    throw new OpenAIError(`AI returned unreadable JSON (${j.choices?.[0]?.finish_reason ?? "?"})`, "rejected", 200, undefined, usage);
  }
}

export type InputPart = { type: "input_text"; text: string } | { type: "input_image"; image_url: string; detail?: "low" | "high" | "auto" };

export interface Usage {
  /** all input tokens, including cache reads and cache writes */
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  cache_write_tokens?: number;
}

export async function openaiStructured<T>(opts: {
  model: string;
  name: string;
  instructions: string;
  input: string | InputPart[];
  schema: Record<string, unknown>;
  effort?: Effort;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}): Promise<{ data: T; usage: Usage; model: string }> {
  if (opts.model.startsWith("claude-")) return anthropicStructured<T>(opts);
  if (useGateway()) return gatewayStructured<T>(opts);
  const key = process.env["OPENAI_API_KEY"];
  if (!key) throw new OpenAIError("OPENAI_API_KEY is not configured", "auth", 0);
  const content: InputPart[] = typeof opts.input === "string" ? [{ type: "input_text", text: opts.input }] : opts.input;
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      signal: opts.signal,
      // Bun's fetch aborts after 5 minutes by default; long reasoning calls need longer.
      ...({ timeout: false } as Record<string, unknown>),
      body: JSON.stringify({
        model: opts.model,
        instructions: opts.instructions,
        input: [{ role: "user", content }],
        ...(opts.effort ? { reasoning: { effort: opts.effort } } : {}),
        max_output_tokens: opts.maxOutputTokens ?? 64_000,
        store: false,
        // Same instructions on every call: a stable cache key keeps them on warm cache shards.
        prompt_cache_key: `ir-${opts.name}`,
        text: { format: { type: "json_schema", name: opts.name, schema: opts.schema, strict: true } },
      }),
    });
  } catch (e) {
    throw new OpenAIError(`OpenAI network error: ${(e as Error).message}`, "transient", 0);
  }
  if (!res.ok) {
    const body = await res.text();
    let code = "";
    let type = "";
    let msg = body.slice(0, 400);
    try {
      const j = JSON.parse(body) as { error?: { code?: string; type?: string; message?: string } };
      code = j.error?.code ?? "";
      type = j.error?.type ?? "";
      msg = j.error?.message ?? msg;
    } catch {
      /* not JSON */
    }
    const kind: OpenAIErrorKind = classifyOpenAIError(res.status, code, type, msg);
    const ra = Number(res.headers.get("retry-after"));
    throw new OpenAIError(`OpenAI ${res.status}${code || type ? ` ${code || type}` : ""}: ${msg}`, kind, res.status, Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined);
  }
  return parseResponse<T>(res);
}

/**
 * OpenAI reports an empty balance as HTTP 429 (insufficient_quota / credit_balance_exhausted), so
 * quota must be checked before the generic 429 → rate-limit rule or runners would retry forever.
 */
export function classifyOpenAIError(status: number, code: string, type: string, message: string): OpenAIErrorKind {
  const all = `${code} ${type}`;
  if (status === 401 || status === 403 || code === "model_not_found") return "auth";
  if (/insufficient_quota|credit|billing|quota/i.test(all) || /no credits|exceeded your current quota|billing/i.test(message)) return "quota";
  if (status === 429) return "rate";
  if (status >= 500) return "transient";
  return "rejected";
}

async function parseResponse<T>(res: Response): Promise<{ data: T; usage: Usage; model: string }> {
  const j = (await res.json()) as {
    model: string;
    status?: string;
    incomplete_details?: { reason?: string };
    output?: { type?: string; content?: { type?: string; text?: string; refusal?: string }[] }[];
    usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
  };
  const parts: string[] = [];
  for (const item of j.output ?? []) {
    if (item.type !== "message") continue;
    for (const c of item.content ?? []) {
      if (c.type === "refusal") throw new OpenAIError(`Model refused: ${c.refusal}`, "rejected", 200);
      if (c.type === "output_text" && c.text) parts.push(c.text);
    }
  }
  if (j.status === "incomplete") throw new OpenAIError(`Response incomplete (${j.incomplete_details?.reason ?? "unknown"})`, "rejected", 200);
  const usage: Usage = {
    input_tokens: j.usage?.input_tokens ?? 0,
    output_tokens: j.usage?.output_tokens ?? 0,
    cached_tokens: j.usage?.input_tokens_details?.cached_tokens ?? 0,
  };
  try {
    return { data: JSON.parse(parts.join("")) as T, usage, model: j.model };
  } catch {
    throw new OpenAIError("Model returned invalid JSON", "rejected", 200);
  }
}
