import { describe, expect, it } from "vitest";
import { classifyOpenAIError } from "@/lib/openai.server";

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
