import { describe, expect, it } from "vitest";
import { fixPrintedSigns, needsSignFix, type SignFixFact } from "./sign-fix";

// Stored production facts (ir_kpi_facts, 26 Nov 2026; ids shortened), each checked against its SEC
// document: the next cell prints ")" or "%)".
const STORED: (SignFixFact & { id: string })[] = [
  // NOW 3Q26 release, table 4 row 17: "(32.5 | %)" and "(20 | %)"
  { id: "now-c4", method: "table", value: 32.5, locator: { t: 4, r: 17, c: 4, text: "(32.5" } },
  { id: "ec86d648", method: "table", value: 20, locator: { t: 4, r: 17, c: 9, text: "(20" } },
  // ALLY d564794dex993.htm t66 r31 c11 "(32 | )" in millions
  { id: "4cf92ced", method: "table", value: 32_000_000, locator: { t: 66, r: 31, c: 11, text: "(32" } },
  // WFC wfc3qer10-13x2017exx991.htm t162 r15 c20 "(57.4 | )" in billions
  { id: "9dbacca7", method: "table", value: 57_400_000_000, locator: { t: 162, r: 15, c: 20, text: "(57.4" } },
  // BA d286838dex991.htm t26 r62 c7 "(735 | )" in millions
  { id: "b2b0c978", method: "table", value: 735_000_000, locator: { t: 26, r: 62, c: 7, text: "(735" } },
  // A "$" inside the cell, as BA and WFC releases print it
  { id: "dollar", method: "table", value: 2_844_000_000, locator: { t: 16, r: 12, c: 10, text: "($2,844" } },
];

describe("fixPrintedSigns", () => {
  it("makes stored positives of an unclosed parenthesis negative and lists their ids", () => {
    const { facts, fixed } = fixPrintedSigns(STORED);
    expect(facts.map((f) => f.value)).toEqual([-32.5, -20, -32_000_000, -57_400_000_000, -735_000_000, -2_844_000_000]);
    expect(fixed).toEqual(STORED.map((f) => f.id));
    expect(STORED[0].value).toBe(32.5);
  });
  it("leaves closed parentheses, already negative values, plain figures and zero alone", () => {
    const same: SignFixFact[] = [
      { id: "a", method: "table", value: -39, locator: { t: 4, r: 17, c: 2, text: "(39)" } },
      { id: "b", method: "table", value: -32.5, locator: { t: 4, r: 17, c: 4, text: "(32.5" } },
      { id: "c", method: "table", value: 73.5, locator: { t: 4, r: 16, c: 4, text: "73.5" } },
      { id: "d", method: "table", value: 0, locator: { t: 1, r: 1, c: 1, text: "(0" } },
    ];
    const { facts, fixed } = fixPrintedSigns(same);
    expect(fixed).toEqual([]);
    facts.forEach((f, i) => expect(f).toBe(same[i]));
  });
  it("never touches derived, text or page facts, or a text with letters", () => {
    expect(needsSignFix({ id: "d", method: "table", derived: true, value: 5, locator: { t: 1, r: 1, c: 1, text: "(5" } })).toBe(false);
    expect(needsSignFix({ id: "p", method: "text", value: 5, locator: { q: "a loss of (5", text: "(5" } })).toBe(false);
    expect(needsSignFix({ id: "v", method: "vision", value: 23, locator: { page: 3, box: [1, 2, 3, 4], text: "(23" } })).toBe(false);
    expect(needsSignFix({ id: "l", method: "table", value: 5, locator: { t: 1, r: 1, c: 1, text: "(in millions 5" } })).toBe(false);
    expect(needsSignFix({ id: "f", method: "table", value: 1, locator: { t: 1, r: 1, c: 1, text: "(1)" } })).toBe(false);
    expect(needsSignFix({ id: "e", method: "table", value: 5, locator: {} })).toBe(false);
  });
});
