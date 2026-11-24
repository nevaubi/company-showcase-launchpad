import { describe, expect, it } from "vitest";
import { currentSection, markedSection } from "./section-nav";

const tops = (...t: number[]) => t.map((top, i) => ({ id: `s${i}`, top }));
const mid = { end: false, scrolled: true };

describe("currentSection", () => {
  it("counts a section whose top landed on the line with sub-pixel rounding as reached (review company-M1)", () => {
    // a jump to s2 puts its top at 112.4 against a line of 112: the old `top - line <= 0` marked s1
    expect(currentSection(tops(-900, -300, 112.4, 700), 112, mid)).toBe("s2");
    expect(currentSection(tops(-900, -300, 112.99, 700), 112, mid)).toBe("s2");
    expect(currentSection(tops(-900, -300, 111.6, 700), 112, mid)).toBe("s2");
  });
  it("does not reach a section more than a pixel below the line", () => {
    expect(currentSection(tops(-900, -300, 114, 700), 112, mid)).toBe("s1");
  });
  it("marks the first section at the top and the last at the end of the page", () => {
    expect(currentSection(tops(300, 900), 112, { end: false, scrolled: false })).toBe("s0");
    expect(currentSection(tops(-300, 400, 900), 112, { end: true, scrolled: true })).toBe("s2");
    expect(currentSection([], 112, mid)).toBeUndefined();
  });
});

describe("markedSection", () => {
  it("keeps the clicked chip while the jump scrolls and where it ends, until the reader scrolls on", () => {
    const moving = { id: "peers", y: null };
    expect(markedSection(moving, 5000, "ownership")).toEqual({ id: "peers", pin: moving });
    const landed = { id: "peers", y: 7300 };
    // the end-of-page rule would mark News at this position: the click wins while the page stays put
    expect(markedSection(landed, 7300.5, "news")).toEqual({ id: "peers", pin: landed });
    expect(markedSection(landed, 7250, "ownership")).toEqual({ id: "ownership", pin: null });
    expect(markedSection(null, 0, "s0")).toEqual({ id: "s0", pin: null });
  });
});
