import { describe, expect, it } from "vitest";
import {
  advanceCursor,
  canStartOfficialChild,
  childReceipt,
  enabled,
  retryDelay,
  safeError,
} from "../../scripts/lib/official-worker-plan";

describe("official source worker scheduling", () => {
  it("does not lose a unit when a process fails or is killed", () => {
    expect(advanceCursor(12, 39, 1)).toBe(12);
    expect(advanceCursor(12, 39, null)).toBe(12);
    expect(advanceCursor(12, 39, 124)).toBe(12);
    expect(advanceCursor(12, 39, 75)).toBe(12);
    expect(advanceCursor(38, 39, 0)).toBe(0);
  });
  it("defers new source children when IR readers consume container headroom", () => {
    const gb = 1024 ** 3;
    expect(canStartOfficialChild(8 * gb, 4 * gb, 2)).toBe(true);
    expect(canStartOfficialChild(8 * gb, 6 * gb, 0)).toBe(false);
    expect(canStartOfficialChild(gb, 0.6 * gb, 1)).toBe(false);
    expect(canStartOfficialChild(null, null, 0)).toBe(true);
    expect(canStartOfficialChild(null, null, 1)).toBe(false);
  });
  it("backs off failures without an unbounded delay", () => {
    expect(retryDelay(1)).toBe(30_000);
    expect(retryDelay(3)).toBe(120_000);
    expect(retryDelay(100)).toBe(3_600_000);
  });
  it("allows an operator to disable either supervised lane", () => {
    expect(enabled(undefined)).toBe(true);
    expect(enabled("false")).toBe(false);
    expect(enabled("0")).toBe(false);
  });
  it("stores what the child says it did beside how the process ended", () => {
    const told = {
      script: "source-refresh", items: 6, checked: ["a", "b"], unchanged: ["a"], staged: [{ id: "b", snapshot_id: "c".repeat(64), rows: 12 }],
      failed: [{ id: "fred_x", family: "fred", fault: "provider", error: "FRED download deadline exceeded" }],
      first_error: "fred_x: FRED download deadline exceeded",
    };
    const row = childReceipt({ child: "scripts/source-refresh.ts", exitCode: 0, killed: false, seconds: 54, told });
    expect(row.ok).toBe(true);
    expect(row.items).toBe(6);
    expect(row.detail).toMatchObject({ child: "scripts/source-refresh.ts", exit_code: 0, checked: ["a", "b"], failed: told.failed });
    // a dataset's failure is in the list; `error` is kept for a run that failed
    expect("error" in row.detail).toBe(false);
    expect("note" in row.detail).toBe(false);
    expect("items" in row.detail).toBe(false);
  });
  it("always gives a failed run an error to read, with or without a receipt", () => {
    // the watchdog tells the owner to read detail.error; before, these rows held only an exit code
    const silent = childReceipt({ child: "scripts/source-refresh.ts", exitCode: 124, killed: true, seconds: 570.4, told: null });
    expect(silent).toEqual({ ok: false, items: 0, detail: {
      child: "scripts/source-refresh.ts", exit_code: 124,
      note: "The child left no receipt: only how the process ended is known.",
      error: "stopped by the worker after 570 s (time limit or lost lease)" } });
    const failed = childReceipt({ child: "scripts/abs-ee.ts", exitCode: 1, killed: false, seconds: 12,
      told: { items: 0, error: "SEC is throttling or down (status 504): stopped before filing 0001104659-26-083795" } });
    expect(failed.detail.error).toBe("child exited with code 1: SEC is throttling or down (status 504): stopped before filing 0001104659-26-083795");
    const first = childReceipt({ child: "x", exitCode: 1, killed: false, seconds: 1, told: { first_error: "a: boom" } });
    expect(first.detail.error).toBe("child exited with code 1: a: boom");
    expect(childReceipt({ child: "x", exitCode: null, killed: false, seconds: 1, told: null }).detail.error).toBe("child exited with code none");
  });
  it("does not let a receipt overwrite the process facts or carry a bad item count", () => {
    const row = childReceipt({ child: "scripts/abs-ee.ts", exitCode: 0, killed: false, seconds: 3,
      told: { child: "something else", exit_code: 99, items: -4 } });
    expect(row).toEqual({ ok: true, items: 0, detail: { child: "scripts/abs-ee.ts", exit_code: 0 } });
    expect(childReceipt({ child: "x", exitCode: 0, killed: false, seconds: 1, told: { items: 2.5 } }).items).toBe(0);
  });
  it("keeps signed URLs and credentials out of persisted errors", () => {
    expect(
      safeError(new Error("failed https://example.com/file?token=private sb_secret_abc")),
    ).toBe("failed [remote request] [credential]");
  });
});
