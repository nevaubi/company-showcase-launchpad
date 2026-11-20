import { describe, expect, it } from "vitest";
import { claimSlice, commitSlice, decodeTries, encodeTries, outcomeOf, runBudgetMs, unitTimeoutMs } from "./slice";

describe("commit-after-work slices", () => {
  it("records the attempt at claim and moves the cursor only on a stored slice", () => {
    const c = claimSlice(8, 0, 100, 4);
    expect(c).toMatchObject({ start: 8, attempt: 1, cursorNow: null, skipped: null });
    expect(decodeTries(c.triesCursor)).toEqual({ start: 8, tries: 1 });
    expect(commitSlice(c, "done", 100, 4)).toEqual({ cursor: 12, triesCursor: 0, wrapped: false });
    expect(commitSlice(c, "failed", 100, 4).cursor).toBeNull();
  });
  it("a cut-off run (no commit) counts as a try; the fourth claim skips the slice", () => {
    let tries = 0;
    for (let i = 1; i <= 3; i++) {
      const c = claimSlice(8, tries, 100, 4);
      expect(c.attempt).toBe(i);
      tries = c.triesCursor; // cut off: nothing else written
    }
    const c = claimSlice(8, tries, 100, 4);
    expect(c.skipped).toEqual({ start: 8, tries: 3 });
    expect(c.start).toBe(12);
    expect(c.cursorNow).toBe(12);
  });
  it("a blocked slice gives its attempt back, so a block never skips companies", () => {
    let tries = 0;
    for (let i = 0; i < 10; i++) {
      const c = claimSlice(8, tries, 100, 4);
      expect(c.skipped).toBeNull();
      tries = commitSlice(c, "blocked", 100, 4).triesCursor;
    }
    expect(decodeTries(tries)).toEqual({ start: 8, tries: 0 });
  });
  it("advances by the units that finished and wraps at the end", () => {
    const c = claimSlice(96, 0, 100, 4);
    expect(commitSlice(c, "done", 100, 4, 2).cursor).toBe(98);
    expect(commitSlice(c, "done", 100, 4)).toMatchObject({ cursor: 0, wrapped: true });
    expect(commitSlice(c, "done", 100, 4, 0).cursor).toBeNull();
  });
  it("tries for another start do not carry over; the cursor is taken modulo the list", () => {
    expect(claimSlice(8, encodeTries({ start: 4, tries: 3 }), 100, 4).attempt).toBe(1);
    expect(claimSlice(205, 0, 100, 4).start).toBe(5);
  });
  it("outcome, deadlines and budget", () => {
    expect(outcomeOf(4, 4)).toBe("failed");
    expect(outcomeOf(4, 3)).toBe("done");
    expect(outcomeOf(0, 0)).toBe("done");
    expect(unitTimeoutMs(1000, 900)).toBe(500);
    expect(unitTimeoutMs(5000, 1000)).toBe(4000);
    expect(runBudgetMs({})).toBe(3500);
    expect(runBudgetMs({ JOB_RUN_BUDGET_MS: "20000" })).toBe(20000);
    expect(runBudgetMs({ JOB_RUN_BUDGET_MS: "900000" })).toBe(25000);
    expect(runBudgetMs({ JOB_RUN_BUDGET_MS: "x" })).toBe(3500);
  });
});
