import { describe, expect, it } from "vitest";
import {
  advanceCursor,
  canStartOfficialChild,
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
  it("keeps signed URLs and credentials out of persisted errors", () => {
    expect(
      safeError(new Error("failed https://example.com/file?token=private sb_secret_abc")),
    ).toBe("failed [remote request] [credential]");
  });
});
