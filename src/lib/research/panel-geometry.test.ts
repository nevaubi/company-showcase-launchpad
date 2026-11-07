import { describe, expect, it } from "vitest";
import { avoidance, coverage, freeRegion, horizontallyCovered, panelSideAwayFrom, placeLabel, rect, scrollOffset } from "./panel-geometry";

const vp = { w: 1440, h: 900 };
const docked = rect(1020, 0, 1440, 900); // 420px docked panel
const wide = rect(200, 0, 1440, 900); // expanded canvas
const floating = rect(980, 72, 1420, 712);

describe("free region", () => {
  it("is the strip left of a docked panel", () => {
    expect(freeRegion(vp, docked)).toEqual(rect(0, 0, 1008, 900));
  });
  it("is the whole viewport without a panel", () => {
    expect(freeRegion(vp, null)).toEqual(rect(0, 0, 1440, 900));
  });
  it("picks the wider side of a floating panel", () => {
    expect(freeRegion(vp, rect(300, 72, 740, 712))).toEqual(rect(752, 0, 1440, 900));
  });
  it("uses the area below a full-width panel that is short", () => {
    expect(freeRegion(vp, rect(0, 0, 1440, 300))).toEqual(rect(0, 312, 1440, 900));
  });
});

describe("scroll offset", () => {
  it("centres the target vertically in the free region", () => {
    expect(scrollOffset(rect(100, 1200, 500, 1300), rect(0, 0, 1008, 900))).toBe(1200 - (24 + (852 - 100) / 2));
  });
  it("aligns tall targets to the top", () => {
    expect(scrollOffset(rect(0, 500, 400, 2000), rect(0, 0, 1008, 900))).toBe(476);
  });
  it("respects a free region that starts lower", () => {
    expect(scrollOffset(rect(0, 400, 400, 450), rect(0, 312, 1440, 900))).toBe(Math.round(400 - (312 + 24 + (588 - 48 - 50) / 2)));
  });
});

describe("overlap handling", () => {
  it("detects a target under the docked panel", () => {
    const t = rect(1100, 300, 1400, 360);
    expect(coverage(t, docked)).toBe(1);
    expect(horizontallyCovered(t, freeRegion(vp, docked))).toBe(true);
    expect(horizontallyCovered(rect(100, 300, 600, 360), freeRegion(vp, docked))).toBe(false);
  });
  it("collapses an expanded canvas, moves a floating panel, else keeps the label clear", () => {
    const t = rect(900, 300, 1300, 360);
    expect(avoidance(t, freeRegion(vp, wide), { wide: true, docked: true })).toBe("collapse-canvas");
    expect(avoidance(t, freeRegion(vp, floating), { wide: false, docked: false })).toBe("move-panel");
    expect(avoidance(t, freeRegion(vp, docked), { wide: false, docked: true })).toBe("label-only");
    expect(avoidance(rect(100, 300, 400, 360), freeRegion(vp, docked), { wide: false, docked: true })).toBe("none");
  });
  it("moves a floating panel away from the target", () => {
    expect(panelSideAwayFrom(rect(1000, 0, 1300, 10), vp)).toBe("left");
    expect(panelSideAwayFrom(rect(100, 0, 300, 10), vp)).toBe("right");
  });
});

describe("label placement", () => {
  const free = freeRegion(vp, docked);
  it("goes above the target when there is room", () => {
    expect(placeLabel(rect(100, 300, 400, 340), free, { w: 200, h: 22 }, vp)).toEqual({ left: 100, top: 272, side: "top" });
  });
  it("goes below when the target is at the top of the screen", () => {
    expect(placeLabel(rect(100, 2, 400, 40), free, { w: 200, h: 22 }, vp).side).toBe("bottom");
  });
  it("never sits under the panel: clamped to the free region's right edge", () => {
    const p = placeLabel(rect(950, 300, 1300, 340), free, { w: 220, h: 22 }, vp);
    expect(p.left + 220).toBeLessThanOrEqual(free.right - 4);
  });
  it("stays inside the viewport", () => {
    const p = placeLabel(rect(-50, 880, 100, 1200), freeRegion(vp, null), { w: 200, h: 22 }, vp);
    expect(p.left).toBeGreaterThanOrEqual(4);
    expect(p.top + 22).toBeLessThanOrEqual(vp.h);
  });
});
