import { describe, expect, it } from "vitest";
import { needsExtractEscalation } from "@/lib/ir/extract-quality";

describe("table reader escalation", () => {
  it("re-reads unusable answers", () => {
    expect(needsExtractEscalation({ failed: "Response incomplete", kept: 0, rejected: 0 })).toBe(true);
  });
  it("re-reads when at least a tenth of the pointed cells were rejected", () => {
    expect(needsExtractEscalation({ kept: 27, rejected: 3 })).toBe(true);
    expect(needsExtractEscalation({ kept: 40, rejected: 3 })).toBe(false);
  });
  it("ignores one or two stray pointers", () => {
    expect(needsExtractEscalation({ kept: 5, rejected: 2 })).toBe(false);
    expect(needsExtractEscalation({ kept: 120, rejected: 0 })).toBe(false);
  });
});

import { extractFollowUpPrompt, mergeFactRows, missedRows } from "@/lib/ir/extract-quality";
import { parseNumber } from "@/lib/ir/tables";

describe("table reader follow-up", () => {
  const chunk = ["## T3", "r0: c1=2026 | c2=2025", "r1: c0=Pharmacy | c1=1,200 | c2=1,100", "r2: c0=Health Care Benefits | c1=900 | c2=850", "r3: c0=Note | c1=12", "## T4", "r0: c0=Members | c1=26.1 | c2=25.9"].join("\n");
  const isNum = (s: string) => parseNumber(s) != null;
  it("lists numeric rows the answer left out, not year headers or single numbers", () => {
    expect(missedRows(chunk, [{ t: 3, rows: [{ r: 1 }] }], isNum)).toEqual([
      { t: 3, r: 2, label: "Health Care Benefits" },
      { t: 4, r: 0, label: "Members" },
    ]);
  });
  it("asks only about the listed rows", () => {
    const p = extractFollowUpPrompt([{ t: 4, r: 0, label: "Members" }]);
    expect(p).toContain("T4 r0 (Members)");
  });
  it("keeps the first answer when both point at the same cell", () => {
    const a = [{ locator: { t: 1, r: 2, c: 3 }, label: "first" }];
    const b = [{ locator: { t: 1, r: 2, c: 3 }, label: "second" }, { locator: { t: 1, r: 4, c: 3 }, label: "new" }];
    expect(mergeFactRows(a, b).map((f) => f.label)).toEqual(["first", "new"]);
  });
});
