import { describe, expect, it } from "vitest";
import { HUB_GROUPS } from "./nav";
import { SHORTCUTS, isTypingTarget, sequenceTarget } from "./shortcuts";

describe("shortcuts", () => {
  it("has no duplicate key combinations", () => {
    const seen = SHORTCUTS.map((s) => s.keys.join("+"));
    expect(new Set(seen).size).toBe(seen.length);
  });
  it("G then O opens Office Studio", () => expect(sequenceTarget("g", "o")).toBe("/app/office"));
  it("every G shortcut opens a page in the navigation", () => {
    const paths = new Set(
      HUB_GROUPS.flatMap((g) => g.hubs.flatMap((h) => h.pages.map((p) => p.to as string))),
    );
    const goTo = SHORTCUTS.filter((s) => s.keys[0] === "G");
    expect(goTo.length).toBeGreaterThan(0);
    for (const s of goTo) {
      expect(s.to && paths.has(s.to)).toBe(true);
      expect(sequenceTarget("g", s.keys[1].toLowerCase())).toBe(s.to);
    }
  });
  it("ignores keys while typing", () => {
    expect(isTypingTarget({ tagName: "INPUT", isContentEditable: false, closest: () => null } as never)).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: false, closest: () => null } as never)).toBe(false);
  });
});
