import { describe, expect, it } from "vitest";
import { dueSlots, isAiCreditError } from "../../scripts/lib/reports-due";
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
});
