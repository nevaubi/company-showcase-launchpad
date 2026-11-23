import { describe, expect, it } from "vitest";
import type { SignalsFile, SignalStat } from "./data";
import { pooledFamily } from "./pooled";
import { bhAdjust, rng, zTwoSided } from "./stat";
import TA from "./ta";

const Z = 1.959963984540054;
/** A pooled statistic with a given excess and standard error. */
const stat = (n: number, excess: number, se: number, periods?: [number, number][]): SignalStat => ({
  n,
  months: Math.min(n, 60),
  mean: 0.01 + excess,
  hit: 0.55,
  excess,
  excess_ci: [excess - Z * se, excess + Z * se],
  by_period: periods ? Object.fromEntries(periods.map(([pn, e], i) => [`p${i}`, { n: pn, months: 10, mean: 0.01 + e, excess: e, hit: 0.5 }])) : undefined,
});
const file = (signals: Record<string, Record<string, SignalStat>>): Pick<SignalsFile, "signals" | "base"> => ({
  base: Object.fromEntries(["5", "20", "60"].map((h) => [h, { all: { n: 50000, mean: 0.01, hit: 0.54 } }])),
  signals: Object.fromEntries(
    Object.entries(signals).map(([k, v]) => [k, { symbols: 40, events: 500, first: "2010-01-04", last: "2026-11-20", ...v }]),
  ) as SignalsFile["signals"],
});

describe("pooled cross-company evidence", () => {
  const types = Object.keys(TA.SIGNALS);

  it("recovers the standard error and p-value from the published 95% interval", () => {
    const rows = pooledFamily(file({ [types[0]]: { "20": stat(400, 0.012, 0.004) } }));
    expect(rows).toHaveLength(1);
    expect(rows[0].se).toBeCloseTo(0.004, 12);
    expect(rows[0].z).toBeCloseTo(3, 10);
    // two-sided p of z = 3 is 0.0026998
    expect(rows[0].p).toBeCloseTo(0.0026998, 6);
    expect(rows[0].p).toBeCloseTo(zTwoSided(3), 12);
    expect(rows[0].base).toBe(0.01);
  });

  it("adjusts every event-horizon pair together (Benjamini-Hochberg)", () => {
    // z values 3.5, 2.2, 2.0, 1.0, 0.5, 0.2 across six pairs
    const zs = [3.5, 2.2, 2.0, 1.0, 0.5, 0.2];
    const S: Record<string, Record<string, SignalStat>> = {};
    zs.forEach((z, i) => {
      S[types[i]] = { "20": stat(300, 0.004 * z, 0.004) };
    });
    const rows = pooledFamily(file(S));
    const q = bhAdjust(zs.map((z) => zTwoSided(z)));
    rows.forEach((r, i) => expect(r.q).toBeCloseTo(q[i], 12));
    // Hand value: smallest p 0.000465 × 6 / 1 = 0.00279; the second, 0.0278 × 6 / 2 = 0.0834, fails at 5%.
    expect(rows[0].q).toBeCloseTo(0.000465258 * 6, 6);
    expect(rows[1].q).toBeGreaterThan(0.05);
    expect(rows.map((r) => r.verdict)).toEqual(["reliable", "context", "context", "context", "context", "context"]);
    expect(rows[1].reason).toBe("base");
    // Alone, z = 2.2 would have passed: the adjustment is what holds it back.
    expect(pooledFamily(file({ [types[1]]: { "20": stat(300, 0.0088, 0.004) } }))[0].verdict).toBe("reliable");
  });

  it("keeps small samples out of the family and out of the verdicts", () => {
    const rows = pooledFamily(file({ [types[0]]: { "20": stat(60, 0.05, 0.005) }, [types[1]]: { "20": stat(400, 0.02, 0.004) } }));
    expect(rows[0].q).toBeNull();
    expect(rows[0].reason).toBe("small");
    // the family has one member, so its q equals its p
    expect(rows[1].q).toBeCloseTo(rows[1].p!, 12);
  });

  it("requires the difference to clear costs and to hold in each period", () => {
    const rows = pooledFamily(
      file({
        [types[0]]: { "5": stat(5000, 0.0015, 0.0003) },
        [types[1]]: { "5": stat(5000, 0.01, 0.002, [[2000, 0.02], [3000, -0.004]]) },
        [types[2]]: { "5": stat(5000, 0.01, 0.002, [[2000, 0.012], [3000, 0.009]]) },
        // a period with too few events does not veto
        [types[3]]: { "5": stat(5000, 0.01, 0.002, [[12, -0.03], [4988, 0.01]]) },
      }),
    );
    expect(rows.map((r) => r.reason)).toEqual(["cost", "unstable", "ok", "ok"]);
  });

  it("is silent on noise: no discoveries when every pair is a draw from the null", () => {
    // deterministic standard normals (Box-Muller on the seeded generator)
    const u0 = rng(20261123);
    const u = () => Math.max(u0(), 1e-12);
    const zn = () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
    let discoveries = 0;
    let runs = 0;
    for (let k = 0; k < 400; k++) {
      const S: Record<string, Record<string, SignalStat>> = {};
      for (const t of types) S[t] = Object.fromEntries(["5", "20", "60"].map((h) => [h, stat(500, 0.004 * zn(), 0.004)]));
      const rows = pooledFamily(file(S));
      expect(rows).toHaveLength(types.length * 3);
      runs++;
      if (rows.some((r) => r.q != null && r.q <= 0.05)) discoveries++;
    }
    // Benjamini-Hochberg holds the chance of any discovery under the global null at the 5% level.
    expect(discoveries / runs).toBeLessThan(0.09);
    expect(discoveries / runs).toBeGreaterThan(0.01);
  });
});
