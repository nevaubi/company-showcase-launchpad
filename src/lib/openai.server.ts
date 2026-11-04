import { GatewayError, generateResponse } from "@lovable.dev/ai-gateway";

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
  /** Slide/chart reading (image input). */
  vision: process.env["IR_VISION_MODEL"] || "gpt-6.1-sol",
  /** Reconciliation repair and cross-period label mapping: strongest reasoning. */
  reason: process.env["IR_REASON_MODEL"] || "gpt-6.1-sol",
} as const;

export type OpenAIErrorKind = "auth" | "quota" | "rate" | "rejected" | "transient";

export class OpenAIError extends Error {
  constructor(
    message: string,
    readonly kind: OpenAIErrorKind,
    readonly status: number,
    readonly retryAfterMs?: number,
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

async function gatewayStructured<T>(opts: Parameters<typeof openaiStructured>[0]): Promise<{ data: T; usage: Usage; model: string }> {
  const content: InputPart[] = typeof opts.input === "string" ? [{ type: "input_text", text: opts.input }] : opts.input;
  const model = opts.model.includes("/") ? opts.model : `openai/${opts.model}`;
  let j: unknown;
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

export type InputPart = { type: "input_text"; text: string } | { type: "input_image"; image_url: string; detail?: "low" | "high" | "auto" };

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
}

export async function openaiStructured<T>(opts: {
  model: string;
  name: string;
  instructions: string;
  input: string | InputPart[];
  schema: Record<string, unknown>;
  effort?: "none" | "minimal" | "low" | "medium" | "high";
  maxOutputTokens?: number;
  signal?: AbortSignal;
}): Promise<{ data: T; usage: Usage; model: string }> {
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
