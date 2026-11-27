// Server-only helpers around the Lovable AI Gateway.
import { generateResponse, GatewayError } from "@lovable.dev/ai-gateway";

export const MODEL = "openai/gpt-6-astra" as const;

export function outputText(res: { output?: unknown[] }): string {
  const parts: string[] = [];
  for (const item of (res.output ?? []) as { type?: string; content?: { type?: string; text?: string }[] }[]) {
    if (item.type !== "message") continue;
    for (const c of item.content ?? []) if (c.type === "output_text" && c.text) parts.push(c.text);
  }
  return parts.join("");
}

export async function structured<T>(opts: {
  name: string;
  instructions: string;
  input: string;
  schema: Record<string, unknown>;
  effort?: "low" | "medium" | "high";
  /** Hosted tools, e.g. [{ type: "web_search" }] */
  tools?: object[];
  signal?: AbortSignal;
}): Promise<T> {
  // IR worker free-only mode: never call the paid gateway; read on the owner's free OpenAI allowance.
  if (process.env["IR_FREE_ONLY"] === "1") {
    if (opts.tools) throw new Error("free-only mode: hosted tools are unavailable");
    const { openaiStructured } = await import("@/lib/openai.server");
    return (await openaiStructured<T>({ model: "gpt-5.4-mini", name: opts.name, instructions: opts.instructions, input: opts.input, schema: opts.schema, effort: opts.effort, signal: opts.signal })).data;
  }
  try {
    const res = await generateResponse({
      model: MODEL,
      instructions: opts.instructions,
      input: [{ role: "user", content: opts.input }],
      reasoning: { effort: opts.effort ?? "low" },
      text: { format: { type: "json_schema", name: opts.name, schema: opts.schema, strict: true } },
      ...(opts.tools ? { tools: opts.tools as never } : {}),
    }, opts.signal ? { signal: opts.signal } : undefined);
    return JSON.parse(outputText(res)) as T;
  } catch (e) {
    throw friendlyAiError(e);
  }
}

export function friendlyAiError(e: unknown): Error {
  if (e instanceof GatewayError) {
    const code = String((e as { code?: string }).code ?? "");
    if (/payment|credit/i.test(code) || (e as { httpStatus?: number }).httpStatus === 402)
      return new Error("AI credits are exhausted for this workspace. Add credits to continue.");
    if ((e as { httpStatus?: number }).httpStatus === 429) return new Error("The AI service is busy. Try again in a moment.");
    return new Error(`AI request failed: ${e.message}`);
  }
  return e instanceof Error ? e : new Error(String(e));
}

export async function cached<T>(
  key: string,
  maxAgeMs: number,
  compute: () => Promise<T>,
  /** Only store results that pass (e.g. skip caching failures so the next request retries). */
  keep: (value: T) => boolean = () => true,
): Promise<T & { cachedAt: string; stale?: true; staleReason?: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("ai_cache").select("payload, created_at").eq("key", key).maybeSingle();
  if (data && Date.now() - new Date(data.created_at).getTime() < maxAgeMs) {
    return { ...(data.payload as T), cachedAt: data.created_at };
  }
  let fresh: T;
  try {
    fresh = await compute();
  } catch (e) {
    // A failed recompute (e.g. 402 out of credits) serves the last stored value, marked stale with
    // its as-of time, so panels keep the last good text instead of erroring. Nothing stored: rethrow.
    if (!data) throw e;
    return { ...(data.payload as T), cachedAt: data.created_at, stale: true, staleReason: (e as Error).message.slice(0, 200) };
  }
  const now = new Date().toISOString();
  if (keep(fresh)) await supabaseAdmin.from("ai_cache").upsert({ key, payload: fresh as never, created_at: now });
  return { ...fresh, cachedAt: now };
}
