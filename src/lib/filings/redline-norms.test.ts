import { describe, expect, it } from "vitest";
import real from "./fixtures/redline-shares.json";
import { LEVEL_CUTS, NORMS, normFor, normLevel, percentileOf, rankPhrase } from "./redline-norms";

const quantile = (xs: number[], p: number) => {
  const i = p * (xs.length - 1);
  const lo = Math.floor(i), hi = Math.ceil(i);
  return xs[lo] + (xs[hi] - xs[lo]) * (i - lo);
};
const levels = (form: "10-K" | "10-Q") => {
  const n = NORMS[form];
  const out = { unusual: 0, high: 0, typical: 0, low: 0 };
  for (const s of real[form].shares) out[normLevel(percentileOf(n, s))]++;
  const t = real[form].shares.length;
  return { unusual: out.unusual / t, high: out.high / t, typical: out.typical / t, low: out.low / t };
};

describe("filing comparison norms", () => {
  it("cut points are the quantiles of the stored 10-K comparisons", () => {
    const xs = real["10-K"].shares;
    expect(xs.length).toBe(NORMS["10-K"].sample);
    for (const [p, v] of NORMS["10-K"].cuts) expect(Math.abs(quantile(xs, p) - v)).toBeLessThan(0.0006);
  });

  it("cuts ascend and the rank is monotonic", () => {
    for (const n of Object.values(NORMS)) {
      for (let i = 1; i < n.cuts.length; i++) {
        expect(n.cuts[i][0]).toBeGreaterThan(n.cuts[i - 1][0]);
        expect(n.cuts[i][1]).toBeGreaterThanOrEqual(n.cuts[i - 1][1]);
      }
      let last = -1;
      for (let s = 0; s <= 1; s += 0.01) {
        const r = percentileOf(n, s);
        expect(r).toBeGreaterThanOrEqual(last);
        last = r;
      }
    }
  });

  it("on real stored comparisons, red is rare and every level is used", () => {
    for (const form of ["10-K", "10-Q"] as const) {
      const l = levels(form);
      // The old fixed 25% threshold called 96% of 10-Ks and 99% of 10-Qs major.
      expect(l.unusual).toBeGreaterThan(0.02);
      expect(l.unusual).toBeLessThan(0.08);
      expect(l.high).toBeGreaterThan(0.12);
      expect(l.high).toBeLessThan(0.28);
      expect(l.low).toBeGreaterThan(0.18);
      expect(l.low).toBeLessThan(0.32);
      expect(l.typical).toBeGreaterThan(0.4);
    }
  });

  it("states the basis in plain words", () => {
    expect(rankPhrase(0.83, "annual reports")).toBe("More change than 8 in 10 annual reports");
    expect(rankPhrase(0.962, "quarterly reports")).toBe("More change than 96 in 100 quarterly reports");
    expect(rankPhrase(1, "annual reports")).toBe("More change than 99 in 100 annual reports");
    expect(rankPhrase(0.3, "annual reports")).toBe("Less change than 7 in 10 annual reports");
    expect(normLevel(LEVEL_CUTS.unusual)).toBe("unusual");
    expect(normLevel(0.5)).toBe("typical");
  });

  it("grades amendments with their original form and knows nothing of other forms", () => {
    expect(normFor("10-k/a")?.form).toBe("10-K");
    expect(normFor("20-F")).toBeNull();
  });
});
