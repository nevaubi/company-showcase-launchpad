import { describe, expect, it } from "vitest";
import {
  advanceCursor,
  enabled,
  retryDelay,
  safeError,
} from "../../scripts/lib/official-worker-plan";

describe("official source worker scheduling", () => {
  it("does not lose a unit when a process fails or is killed", () => {
    expect(advanceCursor(12, 39, 1)).toBe(12);
    expect(advanceCursor(12, 39, null)).toBe(12);
    expect(advanceCursor(12, 39, 124)).toBe(12);
    expect(advanceCursor(38, 39, 0)).toBe(0);
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
