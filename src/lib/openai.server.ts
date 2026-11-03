// Server-only client for the project owner's own OpenAI key (OPENAI_API_KEY), used for the
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
  extract: process.env["IR_EXTRACT_MODEL"] || "gpt-6-astra",
  /** Slide/chart reading (image input). */
  vision: process.env["IR_VISION_MODEL"] || "gpt-6-astra",
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

export const hasOpenAIKey = () => !!process.env["OPENAI_API_KEY"];

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
  const key = process.env["OPENAI_API_KEY"];
  if (!key) throw new OpenAIError("OPENAI_API_KEY is not configured", "auth", 0);
  const content: InputPart[] = typeof opts.input === "string" ? [{ type: "input_text", text: opts.input }] : opts.input;
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      signal: opts.signal,
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
    let msg = body.slice(0, 400);
    try {
      const j = JSON.parse(body) as { error?: { code?: string; type?: string; message?: string } };
      code = j.error?.code ?? j.error?.type ?? "";
      msg = j.error?.message ?? msg;
    } catch {
      /* not JSON */
    }
    const kind: OpenAIErrorKind =
      res.status === 401 || res.status === 403 || code === "model_not_found"
        ? "auth"
        : code === "insufficient_quota" || /billing|quota/i.test(code)
          ? "quota"
          : res.status === 429
            ? "rate"
            : res.status >= 500
              ? "transient"
              : "rejected";
    const ra = Number(res.headers.get("retry-after"));
    throw new OpenAIError(`OpenAI ${res.status}${code ? ` ${code}` : ""}: ${msg}`, kind, res.status, Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined);
  }
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
