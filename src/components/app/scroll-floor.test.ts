import { describe, expect, it } from "vitest";
import { floorHeight } from "./scroll-floor";

describe("floorHeight", () => {
  it("reaches the bottom of the window from where the region starts", () => {
    // a region that starts 72 px down the document, a 900 px window, the reader 1,364 px down the page
    expect(floorHeight(72, 1364, 900)).toBe(2192);
    // at the top of the page the region only has to fill the window
    expect(floorHeight(72, 0, 900)).toBe(828);
  });

  it("is the height that stops the browser pulling the page up when content gets shorter", () => {
    // VSAT's IR tab as measured: the reader at 1,364 px, a 1,000 px window, and a tab whose content left the
    // document 2,264 px tall, 100 px short of the window's bottom edge
    const top = 72;
    const floor = floorHeight(top, 1364, 1000);
    const documentHeight = (regionHeight: number) => top + regionHeight;
    expect(documentHeight(floor)).toBeGreaterThanOrEqual(1364 + 1000);
    expect(documentHeight(floor) - (1364 + 1000)).toBeLessThan(1);
  });

  it("never asks for a negative height and rounds up a fraction", () => {
    expect(floorHeight(5000, 0, 800)).toBe(0);
    expect(floorHeight(72.4, 100.2, 800)).toBe(828);
    expect(floorHeight(Number.NaN, 0, 800)).toBe(0);
  });
});
