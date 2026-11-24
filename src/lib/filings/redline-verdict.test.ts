import { describe, expect, it } from "vitest";
import type { Change, Redline, SectionStats } from "@/lib/redline/core";
import { levelOf, redlineVerdict, verdictSentence } from "./redline-verdict";

const sec = (key: string, title: string, o: Partial<SectionStats> = {}): SectionStats => ({ key, title, added: 0, removed: 0, changed: 0, figuresOnly: 0, unchanged: 0, moved: 0, wordsAdded: 0, wordsRemoved: 0, high: 0, medium: 0, found: "both", ...o });
let n = 0;
const ch = (section: string, type: Change["type"], score: number, o: Partial<Change> = {}): Change => ({
  id: `${section}-${++n}`, section, type, isHeading: false, context: null, figuresOnly: false, wordsAdded: 10, wordsRemoved: 0, score, level: score >= 60 ? "high" : score >= 30 ? "medium" : "low", why: [], terms: [], ...o,
});
const redline = (sections: SectionStats[], changes: Change[]): Redline => ({ version: 2, ticker: "X", form: "10-K", from: { accn: "a", doc: "a", form: "10-K", filed: "2025-01-01" }, to: { accn: "b", doc: "b", form: "10-K", filed: "2026-01-01" }, sections, changes, createdAt: "" });

describe("redline verdict", () => {
  const r = redline(
    [
      sec("1A", "Risk factors", { added: 3, removed: 1, changed: 2, unchanged: 94, high: 2 }),
      sec("7", "MD&A", { added: 1, changed: 3, unchanged: 46, figuresOnly: 5, medium: 1 }),
      sec("1", "Business", { changed: 1, unchanged: 49 }),
      sec("3", "Legal proceedings", { found: "new" }),
    ],
    [
      ch("1A", "added", 80, { isHeading: true }), ch("1A", "added", 70), ch("1A", "added", 20), ch("1A", "removed", 25, { isHeading: true, wordsAdded: 0, wordsRemoved: 30 }),
      ch("1A", "changed", 10), ch("1A", "changed", 5),
      ch("7", "added", 40), ch("7", "changed", 15), ch("7", "changed", 5), ch("7", "changed", 4),
      ch("7", "changed", 99, { figuresOnly: true }),
      ch("1", "changed", 3),
    ],
  );
  const v = redlineVerdict(r);

  it("measures the share of paragraphs changed, leaving figure-only updates out", () => {
    expect(v.changed).toBe(6 + 4 + 1);
    // MD&A's five figure-only updates count as compared paragraphs, not as changes
    expect(v.paragraphs).toBe(100 + 55 + 50);
    expect(v.share).toBeCloseTo(11 / 205);
    expect(v.high).toBe(2);
    expect(v.newRisks).toBe(1);
    expect(v.removedRisks).toBe(1);
    expect(v.wordsRemoved).toBe(30);
  });

  it("ranks sections by the weight of their language changes and names the drivers", () => {
    expect(v.sections.map((s) => s.key)).toEqual(["1A", "7", "1", "3"]);
    expect(v.sections[0].weight).toBe(210);
    expect(v.drivers.map((d) => d.key)).toEqual(["1A"]);
    expect(verdictSentence(v)).toBe("Driven by Risk factors: 2 high-materiality changes, 1 new risk factor, 1 risk factor removed.");
  });

  it("grades the comparison", () => {
    expect(v.level).toBe("moderate");
    expect(levelOf({ high: 12, share: 0.02, newRisks: 0, removedRisks: 0, changed: 40 })).toBe("major");
    expect(levelOf({ high: 0, share: 0.3, newRisks: 0, removedRisks: 0, changed: 40 })).toBe("major");
    expect(levelOf({ high: 0, share: 0.01, newRisks: 0, removedRisks: 0, changed: 3 })).toBe("light");
    expect(levelOf({ high: 0, share: 0, newRisks: 0, removedRisks: 0, changed: 0 })).toBe("none");
  });
});
