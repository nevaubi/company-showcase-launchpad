import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAIError } from "@/lib/openai.server";
import { paidOrLane, resetPaidRest } from "./credit-fallback";
const exhausted = () => Promise.reject(new OpenAIError("OpenAI 429 credit_balance_exhausted: You have no credits remaining.", "quota", 429));
describe("reader credit fallback", () => {
  beforeEach(resetPaidRest);
  it("falls back to the free lane when OpenAI reports credit_balance_exhausted", async () => {
    expect(await paidOrLane(exhausted, async () => "lane")).toBe("lane");
  });
  it("skips the paid path for 30 minutes after an exhaustion, then retries it", async () => {
    let t = 1_000;
    const paid = vi.fn(exhausted);
    await paidOrLane(paid, async () => "lane", () => t);
    t += 10 * 60_000;
    await paidOrLane(paid, async () => "lane", () => t);
    expect(paid).toHaveBeenCalledTimes(1);
    t += 25 * 60_000;
    await paidOrLane(paid, async () => "lane", () => t);
    expect(paid).toHaveBeenCalledTimes(2);
  });
  it("still stops (quota) when the free lane is spent too, and passes other errors through", async () => {
    await expect(paidOrLane(exhausted, async () => null)).rejects.toMatchObject({ kind: "quota" });
    resetPaidRest();
    await expect(paidOrLane(() => Promise.reject(new OpenAIError("bad", "rejected", 400)), async () => "lane")).rejects.toThrow("bad");
  });
});
