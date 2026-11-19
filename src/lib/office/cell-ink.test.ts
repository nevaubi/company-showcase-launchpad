import { describe, expect, it } from "vitest";
import { DARK_INK, LIGHT_INK, inkOnFill, luminance, parseColor } from "./cell-ink";

describe("cell ink", () => {
  it("parses hex and rgb colours", () => {
    expect(parseColor("#fff")).toEqual([255, 255, 255]);
    expect(parseColor("#1F4E79")).toEqual([31, 78, 121]);
    expect(parseColor("#1f4e79cc")).toEqual([31, 78, 121]);
    expect(parseColor("rgb(10, 20, 30)")).toEqual([10, 20, 30]);
    expect(parseColor("rgba(10,20,30,0.5)")).toEqual([10, 20, 30]);
    expect(parseColor("navy")).toBeNull();
  });

  it("measures luminance from black to white", () => {
    expect(luminance([0, 0, 0])).toBe(0);
    expect(luminance([255, 255, 255])).toBeCloseTo(1);
  });

  it("puts dark ink on light fills and light ink on dark fills", () => {
    expect(inkOnFill("#FFFFFF")).toBe(DARK_INK);
    expect(inkOnFill("#FFF2CC")).toBe(DARK_INK);
    expect(inkOnFill("#D9E1F2")).toBe(DARK_INK);
    expect(inkOnFill("#fade4e")).toBe(DARK_INK);
    expect(inkOnFill("#1F4E79")).toBe(LIGHT_INK);
    expect(inkOnFill("#000000")).toBe(LIGHT_INK);
    expect(inkOnFill("#c13c36")).toBe(LIGHT_INK);
  });

  it("falls back to dark ink for colours it cannot read", () => {
    expect(inkOnFill("lightblue")).toBe(DARK_INK);
  });
});
