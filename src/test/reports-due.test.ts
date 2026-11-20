import { describe, expect, it } from "vitest";
import { dueSlots, isAiCreditError, isFreeAllowanceSpent, nextUtcDay } from "../../scripts/lib/reports-due";
const covered = new Set(["A", "B", "C", "D"]);
describe("scheduled standard reports", () => {
  it("writes a recap for an earnings 8-K in the last 3 days unless the recap already uses that accession", () => {
    const due = dueSlots(
      [{ ticker: "A", accn: "a1", filed: "2026-11-18" }, { ticker: "B", accn: "b1", filed: "2026-11-17" }],
      [], [{ ticker: "B", kind: "recap", status: "ready", data_version: "q|b1|2026-W47|5", updated_at: "2026-11-18T00:00:00Z" }], covered, "2026-11-19");
    expect(due).toEqual([{ ticker: "A", kind: "recap", reason: "8-K 2.02 a1 filed 2026-11-18" }]);
  });
  it("writes previews for expected reports within 7 days, soonest first, skipping fresh ones and uncovered tickers", () => {
    const due = dueSlots([], [{ ticker: "D", date: "2026-11-24" }, { ticker: "C", date: "2026-11-20" }, { ticker: "Z", date: "2026-11-20" }, { ticker: "A", date: "2026-11-21" }],
      [{ ticker: "A", kind: "preview", status: "ready", data_version: "", updated_at: "2026-11-17T00:00:00Z" }], covered, "2026-11-19");
    expect(due.map((d) => d.ticker)).toEqual(["C", "D"]);
  });
  it("recognises an AI 402 so the job pauses instead of looping", () => {
    expect(isAiCreditError("AI credits are exhausted for this workspace. Add credits to continue.")).toBe(true);
    expect(isAiCreditError("The AI service is busy")).toBe(false);
  });
  it("on the worker's free-only lane a spent allowance pauses until just after the next UTC midnight", () => {
    expect(isFreeAllowanceSpent("free-only mode: OpenAI free allowance spent or unavailable")).toBe(true);
    expect(isFreeAllowanceSpent("AI credits are exhausted for this workspace.")).toBe(false);
    expect(new Date(nextUtcDay(Date.parse("2026-11-19T09:45:00Z")) * 1000).toISOString()).toBe("2026-11-20T00:05:00.000Z");
    expect(new Date(nextUtcDay(Date.parse("2026-11-30T23:59:00Z")) * 1000).toISOString()).toBe("2026-12-01T00:05:00.000Z");
  });
});

import { failedSlots, failReceipt, reportOutcome, slotKey } from "../../scripts/lib/reports-due";
describe("reports-due failure classes and head-of-line skip", () => {
  it("maps OpenAI credit exhaustion and config errors to a pause, not a slot failure", () => {
    expect(isAiCreditError("OpenAI 429 credit_balance_exhausted: You have no credits remaining.")).toBe(true);
    expect(reportOutcome("OpenAI 429 credit_balance_exhausted: You have no credits remaining.")).toBe("credit");
    expect(reportOutcome("AI 402 payment_required: out of credits")).toBe("credit");
    expect(reportOutcome("free-only mode: OpenAI free allowance spent or unavailable")).toBe("allowance");
    expect(reportOutcome("OpenAI 400 invalid_value: Invalid model ID.")).toBe("config");
    expect(reportOutcome("vet failed: 3 sentences not supported")).toBe("fail");
    expect(reportOutcome(null)).toBe("ok");
  });
  it("skips a slot after 3 failures so the next due slot gets its turn", () => {
    const a = { ticker: "A", kind: "recap" as const, reason: "8-K 2.02 a1 filed 2026-11-18" };
    let r = failReceipt(a, null, "bad inputs");
    r = failReceipt(a, r, "bad inputs");
    expect(failedSlots([r]).size).toBe(0);
    r = failReceipt(a, r, "bad inputs");
    expect(r.cursor).toBe(3);
    const skip = failedSlots([r]);
    expect(skip.has(slotKey(a))).toBe(true);
    const due = dueSlots([{ ticker: "A", accn: "a1", filed: "2026-11-18" }, { ticker: "B", accn: "b1", filed: "2026-11-17" }], [], [], covered, "2026-11-19", skip);
    expect(due.map((d) => d.ticker)).toEqual(["B"]);
  });
  it("a new accession for the same company is a new slot", () => {
    const old = failReceipt({ ticker: "A", kind: "recap", reason: "8-K 2.02 a0 filed 2026-08-01" }, { cursor: 5, paused_reason: "8-K 2.02 a0 filed 2026-08-01|x" }, "x");
    const next = failReceipt({ ticker: "A", kind: "recap", reason: "8-K 2.02 a1 filed 2026-11-18" }, old, "y");
    expect(next.cursor).toBe(1);
  });
});
