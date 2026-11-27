import { describe, expect, it } from "vitest";
import { classifyOpenAIError, openaiStructured, parseOpenRouterStream } from "@/lib/openai.server";
import { vi } from "vitest";

describe("Ling OpenRouter reader", () => {
  it("sends inclusionai/ling-3.0-flash-vl only through the OpenRouter connector", async () => {
    vi.stubEnv("UDC_OPENROUTER_API_KEY", "test-connection");
    vi.stubEnv("LOVABLE_API_KEY", "test-gateway");
    // A fresh reply per call: where a database is configured, the provider circuit is read through the same fetch
    // first, and one shared Response can be read only once ("Body has already been read").
    const request = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ model: "inclusionai/ling-3.0-flash-vl", choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }] }))));
    vi.stubGlobal("fetch", request);
    try {
      const r = await openaiStructured<{ ok: boolean }>({ model: "inclusionai/ling-3.0-flash-vl", name: "check", instructions: "Read", input: "test", schema: {} });
      expect(r.data.ok).toBe(true);
      const CONNECTOR = "https://connector-gateway.lovable.dev/udc_openrouter/v1/chat/completions";
      // every request to a model provider went to the connector (the circuit's own database reads are not model calls)
      const model = request.mock.calls.filter((c) => !/supabase/.test(String(c[0])));
      expect(model.map((c) => c[0])).toEqual([CONNECTOR]);
      expect(JSON.parse(model[0]?.[1].body).model).toBe("inclusionai/ling-3.0-flash-vl");
      expect(JSON.parse(model[0]?.[1].body).stream).toBe(true);
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });
  it("assembles split streaming JSON and ignores keep-alives", async () => {
    const events = ': OPENROUTER PROCESSING\n\ndata: {"choices":[{"delta":{"content":"{\\\"ok\\\":"}}]}\n\ndata: {"choices":[{"delta":{"content":"true}"},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":23}}\n\ndata: [DONE]\n';
    const stream = new ReadableStream({ start(c) { for (let i = 0; i < events.length; i += 7) c.enqueue(new TextEncoder().encode(events.slice(i, i + 7))); c.close(); } });
    const r = await parseOpenRouterStream(new Response(stream));
    expect(r.choices?.[0]?.message?.content).toBe('{"ok":true}');
    expect(r.usage?.prompt_tokens).toBe(23);
  });
  it("rejects valid-looking JSON when the stream ends before completion", async () => {
    await expect(parseOpenRouterStream(new Response('data: {"choices":[{"delta":{"content":"{}"}}]}\n'))).rejects.toMatchObject({ kind: "transient" });
  });
  it("classifies a response-body connection reset as retryable", async () => {
    const stream = new ReadableStream({ start(c) { c.error(new Error("ECONNRESET")); } });
    await expect(parseOpenRouterStream(new Response(stream))).rejects.toMatchObject({ kind: "transient", message: "OpenRouter response stream interrupted" });
  });
});

describe("classifyOpenAIError", () => {
  it("treats an exhausted credit balance (sent as 429) as quota, not a rate limit", () => {
    expect(classifyOpenAIError(429, "credit_balance_exhausted", "insufficient_quota", "You have no credits remaining.")).toBe("quota");
    expect(classifyOpenAIError(429, "insufficient_quota", "", "You exceeded your current quota")).toBe("quota");
  });
  it("keeps ordinary 429s as rate limits and 5xx as transient", () => {
    expect(classifyOpenAIError(429, "rate_limit_exceeded", "requests", "Rate limit reached")).toBe("rate");
    expect(classifyOpenAIError(503, "", "server_error", "overloaded")).toBe("transient");
  });
  it("stops on bad keys and unknown models", () => {
    expect(classifyOpenAIError(401, "invalid_api_key", "", "Incorrect API key")).toBe("auth");
    expect(classifyOpenAIError(404, "model_not_found", "", "")).toBe("auth");
    // review F5: request-specific errors are not configuration
    expect(classifyOpenAIError(400, "invalid_value", "", "image too large for this model")).toBe("rejected");
    expect(classifyOpenAIError(403, "", "", "content policy violation")).toBe("rejected");
    expect(classifyOpenAIError(403, "unsupported_country_region_territory", "", "Country not supported")).toBe("auth");
  });
});

describe("direct OpenAI model ids", () => {
  it("refuses a gateway id before any request, as a configuration error", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    try {
      const { openaiDirectStructured } = await import("@/lib/openai.server");
      const { classify } = await import("@/lib/jobs/failure");
      for (const model of ["google/gemini-3.1-flash-lite", "openai/gpt-6-luna"]) {
        const e = (await openaiDirectStructured({ model, name: "check", instructions: "Read", input: "test", schema: {} }).then(() => new Error("no error"), (x: unknown) => x)) as Error & { kind: string };
        expect(e).toMatchObject({ kind: "auth" });
        expect(classify({ message: e.message })).toBe("config");
      }
      expect(request).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });
});
