import { describe, expect, it } from "vitest";
import { classify, classifyError, maxAttempts, retryDelayMs, stopsProvider } from "./failure";

describe("failure classes", () => {
  it("maps the production messages to their class", () => {
    expect(classify({ status: 429, kind: "quota", message: "OpenAI 429 credit_balance_exhausted: You have no credits remaining." })).toBe("quota");
    expect(classify({ message: "OpenAI 429 credit_balance_exhausted: You have no credits remaining." })).toBe("quota");
    expect(classify({ status: 402, message: "AI 402 payment_required: Not enough credits" })).toBe("quota");
    expect(classify({ message: "free-only mode: OpenAI free allowance spent or unavailable" })).toBe("quota");
    expect(classify({ message: "OpenAI credit balance exhausted and the free lane is spent for today" })).toBe("quota");
    expect(classify({ status: 400, code: "invalid_value", kind: "rejected", message: "OpenAI 400 invalid_value: Invalid model ID." })).toBe("config");
    expect(classify({ message: "error: Escalation failed on page 3: OpenAI 400 invalid_value: Invalid model ID." })).toBe("config");
    expect(classify({ message: "SEC EDGAR responded 429" })).toBe("rate");
    expect(classify({ message: "HTTP 429" })).toBe("rate");
    expect(classify({ message: "canceling statement due to statement timeout" })).toBe("transient");
  });
  it("never treats a configuration error as a bad document", () => {
    for (const m of ["OPENAI_API_KEY is not configured", "OpenRouter connection is not configured", "The model `gpt-9` does not exist or you do not have access to it.", "free-only mode: hosted tools are unavailable"])
      expect(classify({ message: m })).toBe("config");
    expect(classify({ status: 401, message: "OpenAI 401: Incorrect API key provided" })).toBe("config");
    expect(classify({ status: 403, kind: "auth", message: "Anthropic 403 permission_error: no access" })).toBe("config");
    expect(classify({ code: "model_not_found", message: "x" })).toBe("config");
    expect(stopsProvider("config")).toBe(true);
    expect(maxAttempts("config")).toBe(0);
  });
  it("reads a data host's 403 as a block (rate), not as a bad key", () => {
    expect(classify({ status: 403, message: "Cboe responded 403" })).toBe("rate");
  });
  it("keeps 5xx, cut-off replies and network errors transient, other rejects permanent", () => {
    expect(classify({ status: 503, message: "Service Unavailable" })).toBe("transient");
    expect(classify({ kind: "transient", message: "OpenRouter response stream incomplete" })).toBe("transient");
    expect(classify({ message: "fetch failed" })).toBe("transient");
    expect(classify({ status: 400, kind: "rejected", message: "OpenAI 400 invalid_request_error: context too long" })).toBe("permanent");
    expect(classify({ message: "pdftoppm exited with code 1" })).toBe("permanent");
  });
  it("charges a reply cut off by its output limit once instead of re-reading it at full price (F3)", () => {
    expect(classify({ status: 200, kind: "rejected", message: "Response incomplete (max_output_tokens)" })).toBe("permanent");
    expect(classify({ status: 200, kind: "rejected", message: "Response incomplete (max_tokens)" })).toBe("permanent");
    expect(classify({ status: 200, kind: "rejected", message: "OpenRouter response incomplete" })).toBe("permanent");
    expect(classify({ status: 200, kind: "transient", message: "OpenRouter response stream incomplete" })).toBe("transient");
    expect(classify({ message: "Response incomplete (unknown)" })).toBe("transient");
  });
  it("does not read one request's rejection as a configuration error that closes every lane (F5)", () => {
    expect(classify({ status: 400, code: "invalid_value", kind: "rejected", message: "OpenAI 400 invalid_value: image too large for this model" })).toBe("permanent");
    expect(classify({ status: 403, kind: "rejected", message: "AI 403: request blocked by content policy" })).toBe("permanent");
    expect(classify({ status: 403, message: "AI gateway 403: your account does not have permission to use this model" })).toBe("config");
    expect(classify({ status: 403, message: "Cboe responded 403" })).toBe("rate");
  });
  it("classifies thrown objects by their fields", () => {
    const e = Object.assign(new Error("OpenAI 400 invalid_value: Invalid model ID."), { kind: "rejected", status: 400 });
    expect(classifyError(e)).toBe("config");
    expect(classifyError("socket hang up")).toBe("transient");
  });
});

describe("retry policy", () => {
  it("uses full jitter inside base*2^attempt and the cap", () => {
    for (let a = 0; a < 12; a++) {
      for (const r of [0, 0.37, 0.999]) {
        const t = retryDelayMs("transient", a, () => r)!;
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThanOrEqual(Math.min(300_000, 5_000 * 2 ** a));
        const q = retryDelayMs("rate", a, () => r)!;
        expect(q).toBeLessThanOrEqual(Math.min(900_000, 15_000 * 2 ** a));
      }
    }
    expect(retryDelayMs("transient", 0, () => 1)).toBe(5_000);
    expect(retryDelayMs("rate", 20, () => 1)).toBe(900_000);
  });
  it("honours Retry-After but never beyond the cap", () => {
    expect(retryDelayMs("rate", 0, () => 0, 60_000)).toBe(60_000);
    expect(retryDelayMs("rate", 0, () => 0, 3_600_000)).toBe(900_000);
  });
  it("never retries quota, config or permanent, and bounds attempts", () => {
    expect(retryDelayMs("quota", 0)).toBeNull();
    expect(retryDelayMs("config", 0)).toBeNull();
    expect(retryDelayMs("permanent", 0)).toBeNull();
    expect([maxAttempts("transient"), maxAttempts("rate"), maxAttempts("permanent"), maxAttempts("quota")]).toEqual([4, 6, 1, 0]);
  });
});
