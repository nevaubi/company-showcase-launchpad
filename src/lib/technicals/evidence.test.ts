import { describe, expect, it } from "vitest";
import { conditions, indicators, RECENT_SESSIONS, type Bars } from "./conditions";
import { evidence, EVIDENCE, pooledSupports, reliableToday, type PooledSignals } from "./evidence";
import { simulateBars } from "./simulate";

const cut = (B: Bars, n: number): Bars => ({
  d: B.d.slice(0, n),
  o: B.o.slice(0, n),
  h: B.h.slice(0, n),
  l: B.l.slice(0, n),
  c: B.c.slice(0, n),
  v: B.v.slice(0, n),
  tr: B.tr.slice(0, n),
});

describe("conditions", () => {
  const B = simulateBars(12, { n: 1400 });
  const C = conditions(B);

  it("covers states and the ta.js events, with fixed definitions", () => {
    const keys = C.map((c) => c.key);
    for (const k of ["trend_up", "trend_down", "above_200", "below_200", "mom_pos", "mom_neg", "near_high", "near_low", "z20_low", "z20_high", "rsi_low", "rsi_high", "vol_high", "vol_low", "squeeze_on", "vol_surge_up", "vol_surge_down", "golden_cross", "gap_up", "rsi_oversold", "st_down"])
      expect(keys).toContain(k);
    expect(new Set(keys).size).toBe(keys.length);
    expect(C.filter((c) => c.kind === "event")).toHaveLength(16);
  });

  it("never flags a bar before the statistics start or before its indicator exists", () => {
    for (const c of C) {
      expect(c.from).toBeGreaterThanOrEqual(EVIDENCE.start);
      for (let i = 0; i < c.from; i++) expect(c.flag[i]).toBe(0);
    }
  });

  it("uses nothing from the future: a shorter history gives the same flags on the bars it has", () => {
    const short = conditions(cut(B, 1100));
    for (const c of C) {
      const s = short.find((x) => x.key === c.key)!;
      expect(s.from).toBe(c.from);
      for (let i = 0; i < 1100; i++)
        if (s.flag[i] !== c.flag[i]) throw new Error(`${c.key} differs at bar ${i}`);
    }
  });

  it("marks what is in force on the last bar", () => {
    const n = B.c.length;
    for (const c of C) {
      if (c.kind === "state") {
        expect(c.active).toBe(c.flag[n - 1] === 1);
        if (c.active) {
          // `at` is the first bar of the current run
          expect(c.flag[c.at!]).toBe(1);
          if (c.at! > c.from) expect(c.flag[c.at! - 1]).toBe(0);
          for (let i = c.at!; i < n; i++) expect(c.flag[i]).toBe(1);
        }
      } else if (c.at != null) {
        expect(c.flag[c.at]).toBe(1);
        expect(c.active).toBe(c.at >= n - RECENT_SESSIONS);
      }
    }
    // complements never hold together
    const by = (k: string) => C.find((c) => c.key === k)!;
    for (let i = EVIDENCE.start; i < n; i++) {
      expect(by("above_200").flag[i] + by("below_200").flag[i]).toBeLessThanOrEqual(1);
      expect(by("trend_up").flag[i] + by("trend_down").flag[i]).toBeLessThanOrEqual(1);
      expect(by("mom_pos").flag[i] + by("mom_neg").flag[i]).toBeLessThanOrEqual(1);
    }
  });

  it("matches the definitions on a bar checked by hand", () => {
    const I = indicators(B);
    const i = 1000;
    const sma = (n: number) => B.c.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n;
    const by = (k: string) => C.find((c) => c.key === k)!;
    expect(by("above_200").flag[i]).toBe(B.c[i] > sma(200) ? 1 : 0);
    expect(by("trend_up").flag[i]).toBe(B.c[i] > sma(50) && sma(50) > sma(200) ? 1 : 0);
    expect(by("mom_pos").flag[i]).toBe(B.tr[i - 21] > B.tr[i - 252] ? 1 : 0);
    const hi = Math.max(...B.h.slice(i - 251, i + 1));
    expect(by("near_high").flag[i]).toBe(B.c[i] >= 0.95 * hi ? 1 : 0);
    const w = B.c.slice(i - 19, i + 1);
    const m = w.reduce((a, b) => a + b, 0) / 20;
    const s = Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / 20);
    expect(I.z20[i]).toBeCloseTo((B.c[i] - m) / s, 10);
    const prior = B.v.slice(i - 20, i).reduce((a, b) => a + b, 0) / 20;
    expect(by("vol_surge_up").flag[i]).toBe(B.v[i] >= 2 * prior && B.c[i] > B.c[i - 1] ? 1 : 0);
  });

  it("drops the volume conditions when there is no volume", () => {
    const noVol = conditions({ ...B, v: B.v.map(() => 0) });
    expect(noVol.find((c) => c.key === "vol_surge_up")).toBeUndefined();
  });
});

describe("evidence on histories with nothing to find", () => {
  // The whole layer on simulated random walks with clustered volatility and fat tails: any signal is a false positive.
  const N = 120;
  let memo: { tests: number; nominal: number; withSignal: number; withDiscovery: number } | null = null;
  const run = () => {
    if (memo) return memo;
    const m = { tests: 0, nominal: 0, withSignal: 0, withDiscovery: 0 };
    for (let s = 0; s < N; s++) {
      const E = evidence(simulateBars(20261123 + s), { seed: `noise${s}`, intervals: "candidates" });
      let any = false;
      for (const r of E.rows)
        for (const h of EVIDENCE.horizons) {
          const c = r.cells[h];
          if (!c || c.q == null) continue;
          m.tests++;
          if (c.test.p < 0.05) m.nominal++;
          if (c.q <= EVIDENCE.fdr) any = true;
        }
      if (any) m.withDiscovery++;
      if (E.reliable.length) m.withSignal++;
    }
    return (memo = m);
  };

  it("keeps the share of histories with any signal at or under the stated level", { timeout: 120_000 }, () => {
    const { tests, nominal, withSignal, withDiscovery } = run();
    console.info(
      `noise test: ${N} random-walk histories, ${tests} tests; ${((100 * nominal) / tests).toFixed(2)}% of single tests below p 0.05; ` +
        `${withDiscovery} histories (${((100 * withDiscovery) / N).toFixed(1)}%) with a discovery after multiple-testing control; ` +
        `${withSignal} (${((100 * withSignal) / N).toFixed(1)}%) with a reliable signal`,
    );
    expect(withSignal / N).toBeLessThanOrEqual(EVIDENCE.fdr);
    expect(withDiscovery / N).toBeLessThanOrEqual(EVIDENCE.fdr);
  });

  it("has single tests that reject about as often as their level says", { timeout: 120_000 }, () => {
    const { tests, nominal } = run();
    expect(tests).toBeGreaterThan(N * 40);
    expect(nominal / tests).toBeLessThan(0.065);
    expect(nominal / tests).toBeGreaterThan(0.03);
  });
});

describe("evidence when something is really there", () => {
  // Long runs of rising and falling drift: trend-following conditions do carry information about what follows.
  const B = simulateBars(77, { trend: 0.003, run: 250, vol: 0.012 });
  const E = evidence(B, { seed: "planted" });

  it("finds the planted pattern and reports its direction", () => {
    const keys = new Set(E.reliable.map((r) => r.key));
    expect(keys.has("above_200")).toBe(true);
    expect(keys.has("below_200")).toBe(true);
    const up = E.rows.find((r) => r.key === "above_200")!.cells[20]!;
    const down = E.rows.find((r) => r.key === "below_200")!.cells[20]!;
    expect(up.verdict).toBe("reliable");
    expect(up.test.excess).toBeGreaterThan(0);
    expect(down.test.excess).toBeLessThan(0);
    expect(up.q!).toBeLessThanOrEqual(EVIDENCE.fdr);
    expect(up.test.ci![0]).toBeGreaterThan(0);
    expect(Math.sign(up.test.halves[0]!)).toBe(1);
    expect(Math.sign(up.test.halves[1]!)).toBe(1);
  });

  it("lists what is in force today among the reliable ones", () => {
    const today = reliableToday(E);
    for (const x of today) {
      expect(x.row.active).toBe(true);
      expect(x.cell.verdict).toBe("reliable");
    }
    const act = E.rows.find((r) => r.key === "above_200")!.active;
    expect(today.some((x) => x.row.key === "above_200")).toBe(act);
    for (let k = 1; k < today.length; k++) expect(today[k].cell.q!).toBeGreaterThanOrEqual(today[k - 1].cell.q!);
  });

  it("is reproducible: the same history gives the same figures", () => {
    const again = evidence(B, { seed: "planted" });
    expect(again.reliable).toEqual(E.reliable);
    expect(again.rows.find((r) => r.key === "above_200")!.cells[20]).toEqual(E.rows.find((r) => r.key === "above_200")!.cells[20]);
  });
});

describe("the checks behind a verdict", () => {
  const B = simulateBars(5);
  const E = evidence(B, { seed: "x" });

  it("keeps small samples out of the tested family and never calls them reliable", () => {
    let small = 0;
    for (const r of E.rows)
      for (const h of EVIDENCE.horizons) {
        const c = r.cells[h];
        if (!c) continue;
        expect(c.test.nEff).toBeGreaterThanOrEqual(EVIDENCE.minReport);
        if (c.test.nEff < EVIDENCE.minIndependent) {
          small++;
          expect(c.q).toBeNull();
          expect(c.reason).toBe("small");
          expect(c.verdict).toBe("context");
        } else expect(c.q).not.toBeNull();
      }
    expect(small).toBeGreaterThan(0);
    expect(E.tested).toBe(E.rows.flatMap((r) => EVIDENCE.horizons.map((h) => r.cells[h])).filter((c) => c && c.q != null).length);
  });

  it("gives every row an interval when asked for all, and only candidates otherwise", () => {
    for (const r of E.rows) for (const h of EVIDENCE.horizons) if (r.cells[h]) expect(r.cells[h]!.test.ci).not.toBeNull();
    const lazy = evidence(B, { seed: "x", intervals: "candidates" });
    for (const r of lazy.rows)
      for (const h of EVIDENCE.horizons) {
        const c = r.cells[h];
        if (c && !(c.q != null && c.q <= EVIDENCE.fdr)) expect(c.test.ci).toBeNull();
      }
    // the verdicts do not depend on which intervals were computed
    expect(lazy.reliable).toEqual(E.reliable);
  });

  it("lists the non-overlapping cases behind each count", () => {
    for (const r of E.rows)
      for (const h of EVIDENCE.horizons) {
        const c = r.cells[h];
        const list = r.cases[h]!;
        // listed for every condition; where there is a test, the list is exactly what the test counted
        if (c) expect(list).toHaveLength(c.test.nEff);
        else expect(list.length).toBeLessThan(EVIDENCE.minReport);
        for (let k = 1; k < list.length; k++) expect(list[k] - list[k - 1]).toBeGreaterThanOrEqual(h);
        if (list.length) expect(list[list.length - 1] + h).toBeLessThan(B.c.length);
      }
  });

  it("states the sample it used", () => {
    expect(E.sample.from).toBe(B.d[EVIDENCE.start]);
    expect(E.sample.to).toBe(B.d[B.d.length - 1]);
    expect(E.sample.bars).toBe(B.d.length - EVIDENCE.start);
  });

  it("lets the cross-company statistics veto an event, and leaves states to the stock's own history", () => {
    expect(pooledSupports(null, 0.02)).toBe(true);
    expect(pooledSupports({ n: 50, excess: -0.01, ci: [-0.02, -0.001] }, 0.02)).toBe(true); // too few pooled events to judge
    expect(pooledSupports({ n: 5000, excess: 0.01, ci: [0.002, 0.018] }, 0.02)).toBe(true);
    expect(pooledSupports({ n: 5000, excess: 0.01, ci: [-0.002, 0.022] }, 0.02)).toBe(false); // pooled interval includes zero
    expect(pooledSupports({ n: 5000, excess: -0.01, ci: [-0.018, -0.002] }, 0.02)).toBe(false); // opposite sign
  });

  it("demotes an event the cross-section contradicts", () => {
    // Plant a strong effect after an event type, then feed pooled statistics that say the opposite.
    const P = simulateBars(31, { trend: 0.004, run: 120, vol: 0.01 });
    const own = evidence(P, { seed: "p" });
    const hit = own.reliable.find((r) => own.rows.find((x) => x.key === r.key)!.kind === "event");
    expect(hit).toBeDefined();
    if (!hit) return;
    const sign = Math.sign(own.rows.find((x) => x.key === hit.key)!.cells[hit.h]!.test.excess);
    const pooled: PooledSignals = { [hit.key]: { [String(hit.h)]: { n: 9000, excess: -sign * 0.01, excess_ci: sign > 0 ? [-0.015, -0.005] : [0.005, 0.015] } } };
    const vetoed = evidence(P, { seed: "p", pooled });
    const cell = vetoed.rows.find((x) => x.key === hit.key)!.cells[hit.h]!;
    expect(cell.verdict).toBe("context");
    expect(cell.reason).toBe("pooled");
    expect(cell.pooled).toEqual({ n: 9000, excess: -sign * 0.01, ci: sign > 0 ? [-0.015, -0.005] : [0.005, 0.015] });
  });
});
