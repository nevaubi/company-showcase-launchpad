import { describe, expect, it } from "vitest";
import { SHORTCUTS, isTypingTarget, sequenceTarget } from "./shortcuts";

describe("shortcuts", () => {
  it("has no duplicate key combinations", () => {
    const seen = SHORTCUTS.map((s) => s.keys.join("+"));
    expect(new Set(seen).size).toBe(seen.length);
  });
  it("G then O opens Office Studio", () => expect(sequenceTarget("g", "o")).toBe("/app/office"));
  it("ignores keys while typing", () => {
    expect(isTypingTarget({ tagName: "INPUT", isContentEditable: false, closest: () => null } as never)).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: false, closest: () => null } as never)).toBe(false);
  });
});
