import { describe, expect, it } from "vitest";
import { performance, readTechnicals } from "./technicals";

type Bar = [string, number, number, number, number, number, number];
const series = (n: number, f: (i: number) => number, start = "2024-01-01"): Bar[] =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.parse(start) + i * 86_400_000).toISOString().slice(0, 10);
    const c = f(i);
    return [d, c, c * 1.01, c * 0.99, c, c, 1000];
  });

describe("chart read", () => {
  it("calls a steady rise an uptrend near its high", () => {
    const bars = series(400, (i) => 100 + i);
    const r = readTechnicals(bars, bars);
    expect(r.insights.find((x) => x.title === "Uptrend")).toBeTruthy();
    expect(r.insights.find((x) => x.title === "Near 52-week high")).toBeTruthy();
  });

  it("measures 1-year return and excess over the index", () => {
    const bars = series(800, (i) => 100 * Math.pow(1.001, i));
    const flat = series(800, () => 100);
    const y = performance(bars, flat).find((p) => p.label === "1Y")!;
    expect(y.value!).toBeCloseTo(Math.pow(1.001, 365) - 1, 2);
    expect(y.vsIndex!).toBeCloseTo(y.value!, 6);
  });

  it("leaves windows longer than the history empty", () => {
    const bars = series(100, (i) => 100 + i);
    expect(performance(bars, bars).find((p) => p.label === "5Y")!.value).toBeNull();
  });

  it("dates the last golden cross", () => {
    const bars = series(600, (i) => (i < 300 ? 200 - i * 0.3 : 110 + (i - 300) * 0.8));
    expect(readTechnicals(bars, bars).cross?.kind).toBe("golden");
  });

  it("reports an old cross as history once the price has gone the other way", () => {
    // Falls, rallies through a golden cross, then sells off hard in the last 40 sessions.
    const bars = series(700, (i) => (i < 300 ? 200 - i * 0.3 : i < 660 ? 110 + (i - 300) * 0.8 : 398 - (i - 660) * 4));
    const r = readTechnicals(bars, bars);
    const cross = r.insights.find((x) => /cross/i.test(x.title))!;
    expect(r.cross?.kind).toBe("golden");
    expect(cross.tone).toBe("neutral");
    expect(cross.title).toMatch(/^Golden cross, \d+ months ago$/);
    expect(cross.detail).toContain("no longer describes the trend");
  });

  it("keeps a recent cross as a live signal", () => {
    // The cross lands about 36 sessions before the last bar.
    const bars = series(480, (i) => (i < 400 ? 200 - i * 0.2 : 120 + (i - 400) * 0.9));
    const cross = readTechnicals(bars, bars).insights.find((x) => /cross/i.test(x.title))!;
    expect(cross.title).toBe("Golden cross");
    expect(cross.tone).toBe("positive");
  });
});
