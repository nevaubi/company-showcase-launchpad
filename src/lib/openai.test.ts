import { describe, expect, it } from "vitest";
import { classifyOpenAIError, openaiStructured } from "@/lib/openai.server";
import { vi } from "vitest";

describe("Ling OpenRouter reader", () => {
  it("sends inclusionai/ling-3.0-flash-vl only through the OpenRouter connector", async () => {
    vi.stubEnv("UDC_OPENROUTER_API_KEY", "test-connection");
    vi.stubEnv("LOVABLE_API_KEY", "test-gateway");
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ model: "inclusionai/ling-3.0-flash-vl", choices: [{ finish_reason: "stop", message: { content: '{"ok":true}' } }] })));
    vi.stubGlobal("fetch", request);
    try {
      const r = await openaiStructured<{ ok: boolean }>({ model: "inclusionai/ling-3.0-flash-vl", name: "check", instructions: "Read", input: "test", schema: {} });
      expect(r.data.ok).toBe(true);
      expect(request.mock.calls[0]?.[0]).toBe("https://connector-gateway.lovable.dev/udc_openrouter/v1/chat/completions");
      expect(JSON.parse(request.mock.calls[0]?.[1].body).model).toBe("inclusionai/ling-3.0-flash-vl");
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
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
  });
});
