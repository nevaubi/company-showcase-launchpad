import { describe, expect, it } from "vitest";
import { dueSlots, isAiCreditError, isFreeAllowanceSpent, nextReportSlot, nextUtcDay, type DueSlot, type ReportLane } from "../../scripts/lib/reports-due";
const covered = new Set(["A", "B", "C", "D"]);
describe("scheduled standard reports", () => {
  it("writes a recap for an earnings 8-K in the last 3 days unless the recap already uses that accession", () => {
    const due = dueSlots(
      [{ ticker: "A", accn: "a1", filed: "2026-11-18" }, { ticker: "B", accn: "b1", filed: "2026-11-17" }],
      [], [{ ticker: "B", kind: "recap", status: "ready", data_version: "q|b1|2026-W47|5", updated_at: "2026-11-18T00:00:00Z" }], covered, "2026-11-19");
    expect(due).toEqual([{ ticker: "A", kind: "recap", eventDate: "2026-11-18", reason: "8-K 2.02 a1 filed 2026-11-18" }]);
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

describe("failure receipts are cleaned up (review F10)", () => {
  it("lists receipts whose slot is no longer due, bounded", async () => {
    const { staleReceipts } = await import("../../scripts/lib/reports-due");
    const due = [{ ticker: "AAPL", kind: "recap" as const, reason: "8-K 2.02 0000320193-26-000100 filed 2026-11-19" }];
    const receipts = [
      { job: "reports-due-fail:AAPL:recap", paused_reason: "8-K 2.02 0000320193-26-000100 filed 2026-11-19|boom" },
      { job: "reports-due-fail:MSFT:recap", paused_reason: "8-K 2.02 0000789019-26-000050 filed 2026-10-28|boom" },
      { job: "reports-due-fail:AAPL:preview", paused_reason: "expected report 2026-10-30|x" },
      { job: "reports-due", paused_reason: null },
    ];
    expect(staleReceipts(receipts, due)).toEqual(["reports-due-fail:MSFT:recap", "reports-due-fail:AAPL:preview"]);
    expect(staleReceipts(receipts, due, 1)).toEqual(["reports-due-fail:MSFT:recap"]);
  });
});

describe("shared report recovery", () => {
  const today = "2026-11-27";
  const event: DueSlot = { ticker: "A", kind: "preview", eventDate: "2026-11-30", reason: "upcoming earnings" };
  const repairs: DueSlot[] = ["B", "C"].map((ticker) => ({ ticker, kind: "primer", retryAt: 1, reason: "Recover shared report r7" }));

  it("repairs one in four mixed turns while new earnings keep arriving", () => {
    const history: ReportLane[] = [];
    const turns: string[] = [];
    for (let n = 0; n < 8; n++) {
      const chosen = nextReportSlot([event, ...repairs], history, today)!;
      const lane = chosen.retryAt != null ? "repair" : "event";
      turns.push(lane);
      history.unshift(lane);
    }
    expect(turns).toEqual(["event", "event", "event", "repair", "event", "event", "event", "repair"]);
  });

  it("yields even an operator repair to same-day recaps and previews", () => {
    const oldest = { ...event, kind: "recap" as const, eventDate: "2026-11-25" };
    for (const kind of ["recap", "preview"] as const) {
      const urgent = { ...event, kind, eventDate: today };
      const candidates = [oldest, urgent, ...repairs];
      expect(nextReportSlot(candidates, ["event", "event", "event"], today)).toBe(urgent);
      expect(nextReportSlot(candidates, ["event", "event", "event"], today, true)).toBeUndefined();
    }
  });

  it("gives events a turn after a repair attempt, and works oldest eligible repairs immediately when quiet", () => {
    expect(nextReportSlot([event, ...repairs], ["repair", "event", "event"], today)).toBe(event);
    expect(nextReportSlot(repairs, ["repair"], today)).toBe(repairs[0]);
    expect(nextReportSlot([event, ...repairs], [], today, true)).toBe(repairs[0]);
    expect(nextReportSlot([event], ["event", "event", "event"], today, true)).toBeUndefined();
    expect(nextReportSlot([event], ["event", "event", "event"], today)).toBe(event);
  });

  it("preserves scheduled earnings priority and does not retry the same slot under a second receipt", async () => {
    const { recoverySlots } = await import("../../scripts/lib/reports-due");
    const event = { ticker: "B", kind: "recap" as const, reason: "new filing" };
    const candidates = recoverySlots([
      { ticker: "A", kind: "primer", updated_at: "2026-11-12T02:15Z" },
      { ticker: "C", kind: "memo", updated_at: "2026-11-11T00:00Z" },
      { ticker: "B", kind: "recap", updated_at: "2026-11-10T00:00Z" },
      { ticker: "UNCOVERED", kind: "primer", updated_at: "2026-11-10T00:00Z" },
    ], [event], covered);
    expect(candidates.map((c) => c.ticker)).toEqual(["C", "A"]);
    expect(candidates[1].retryAt).toBe(Date.parse("2026-11-12T03:15Z"));
  });
  it("keeps a receipt through cooldown and stops a failing primer after its third attempt", async () => {
    const { recoverySlots, failReceipt, staleReceipts, failedSlots, slotKey } = await import("../../scripts/lib/reports-due");
    const candidates = recoverySlots([{ ticker: "A", kind: "primer", updated_at: "2026-11-27T12:00Z" }], [], covered);
    const slot = candidates[0];
    let receipt = failReceipt(slot, null, "bad inputs");
    receipt = failReceipt(slot, receipt, "bad inputs");
    receipt = failReceipt(slot, receipt, "bad inputs");
    expect(failedSlots([receipt]).has(slotKey(slot))).toBe(true);
    expect(staleReceipts([receipt], candidates)).toEqual([]);
    expect(staleReceipts([receipt], [])).toEqual([receipt.job]);
  });
});
