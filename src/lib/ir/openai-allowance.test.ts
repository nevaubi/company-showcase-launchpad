import { describe, expect, it } from "vitest";
import { allowanceDay, estimateTokens, FREE_SAFETY, FREE_TIERS, tierOf } from "./openai-allowance";

describe("free OpenAI allowance", () => {
  it("caps large models at 1M and small models at 10M tokens a day", () => {
    expect(FREE_TIERS.large.cap).toBe(1_000_000);
    expect(FREE_TIERS.mini.cap).toBe(10_000_000);
    expect(FREE_SAFETY).toBeLessThan(1);
  });
  it("puts each model in its tier, including dated snapshots, and nothing else", () => {
    expect(tierOf("gpt-5.4-mini")).toBe("mini");
    expect(tierOf("gpt-5.4-mini-2026-03-05")).toBe("mini");
    expect(tierOf("o4-mini")).toBe("mini");
    expect(tierOf("gpt-5.4")).toBe("large");
    expect(tierOf("o3")).toBe("large");
    expect(tierOf("gpt-6.1-sol")).toBeNull();
    expect(tierOf("google/gemini-3.1-flash-lite")).toBeNull();
  });
  it("reserves enough for the reply and resets on the UTC day", () => {
    expect(estimateTokens(32_000, 8_000)).toBe(18_000);
    expect(allowanceDay(new Date("2026-11-17T23:59:00-06:00"))).toBe("2026-11-18");
  });
});
