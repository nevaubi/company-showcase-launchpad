import { describe, expect, it } from "vitest";
import type { Change, Redline, SectionStats } from "@/lib/redline/core";
import { gradeShare, LEVEL_LABEL, notComparedSentence, redlineVerdict, verdictSentence } from "./redline-verdict";

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

  it("grades the comparison against stored comparisons of the same form", () => {
    // 5.4% of paragraphs changed is far below any stored 10-K (the lowest is 20%)
    expect(v.level).toBe("low");
    expect(v.basis).toBe("Less change than 99 in 100 annual reports");
    expect(gradeShare("10-K", 0, 0).level).toBe("none");
    expect(gradeShare("20-F", 0.5, 10)).toMatchObject({ level: "unrated", rank: null, basis: null });
  });

  it("names core sections that were not compared", () => {
    // Business, Risk factors and MD&A were compared; Financial statements is absent from both filings
    expect(v.notCompared.map((c) => c.key)).toEqual(["8"]);
    expect(notComparedSentence(v)).toBe("Financial statements & notes was not compared: not found in both filings. The share above leaves it out.");
  });
});

describe("verdict on real stored comparisons", () => {
  // COST 10-K (review): 121 of 408 paragraphs, no Item 7 in the stored stats
  const cost = redline(
    [
      sec("1", "Business", { added: 1, removed: 2, changed: 16, unchanged: 27, figuresOnly: 4 }),
      sec("1A", "Risk factors", { removed: 8, changed: 28, unchanged: 45, high: 1 }),
      sec("1C", "Cybersecurity", { changed: 4, unchanged: 5 }),
      sec("3", "Legal proceedings", { unchanged: 1 }),
      sec("7A", "Market risk", { removed: 1, changed: 3, unchanged: 5, figuresOnly: 2 }),
      sec("8", "Financial statements & notes", { added: 12, removed: 9, changed: 36, unchanged: 158, figuresOnly: 31, high: 1 }),
      sec("9A", "Controls & procedures", { changed: 1, unchanged: 4, figuresOnly: 4 }),
      sec("9B", "Other information", { figuresOnly: 1 }),
    ],
    [ch("1A", "changed", 70), ch("8", "changed", 65)],
  );
  const vc = redlineVerdict(cost);

  it("does not call a below-median 10-K major, and says MD&A was not compared", () => {
    expect(vc.changed).toBe(121);
    expect(vc.paragraphs).toBe(408);
    expect(vc.level).toBe("low");
    expect(LEVEL_LABEL[vc.level]).toBe("Less change than usual");
    expect(vc.basis).toBe("Less change than 8 in 10 annual reports");
    expect(vc.notCompared.map((c) => c.title)).toEqual(["MD&A"]);
  });

  it("AAPL 10-K, 236 of 597 paragraphs, is typical", () => {
    const g = gradeShare("10-K", 236 / 597, 236);
    expect(g.level).toBe("typical");
    expect(g.basis).toBe("Less change than 6 in 10 annual reports");
  });
});
