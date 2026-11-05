import { describe, expect, it } from "vitest";
import { fixPeriodEnds, actionSummary, beatStats, latestTargets, normalizeEstimates, positionIn, ratingLabel, revisionPct, type AnalystAction } from "./core";

const a = (date: string, firm: string, action: string, target: number | null, prior: number | null): AnalystAction =>
  ({ date, firm, action, fromGrade: "", toGrade: "", targetAction: null, target, priorTarget: prior });

describe("estimates", () => {
  it("reads raw provider values and the earnings trend", () => {
    const e = normalizeEstimates("AAPL", {
      financialData: { currentPrice: { raw: 349.51 }, targetMeanPrice: { raw: 333.28 }, numberOfAnalystOpinions: { raw: 38 } },
      earningsTrend: { trend: [{ period: "0q", endDate: "2026-12-31", earningsEstimate: { avg: { raw: 2.9 }, numberOfAnalysts: { raw: 26 } }, epsTrend: { current: { raw: 2.9 }, "90daysAgo": { raw: 2.8 } }, epsRevisions: { upLast30days: { raw: 1 }, downLast30days: { raw: 2 } } }, { period: "-5y" }] },
    }, "2026-11-05T00:00:00Z");
    expect(e.price).toBe(349.51);
    expect(e.target.analysts).toBe(38);
    expect(e.periods).toHaveLength(1);
    expect(e.periods[0].eps.analysts).toBe(26);
    expect(e.periods[0].revisions).toMatchObject({ up30: 1, down30: 2 });
  });

  it("revision % is sign-safe for loss-making companies", () => {
    expect(revisionPct(-0.5, -1)).toBeCloseTo(0.5);
    expect(revisionPct(2.9, 2.8)).toBeCloseTo(0.0357, 3);
    expect(revisionPct(1, 0)).toBeNull();
  });

  it("counts upgrades, downgrades and target moves only inside the window", () => {
    const s = actionSummary([a("2026-11-01", "UBS", "up", 340, 296), a("2026-10-20", "JPM", "main", 355, 360), a("2026-10-10", "MS", "down", null, null), a("2026-01-01", "Old", "up", 1, 2)], "2026-08-01");
    expect(s).toMatchObject({ count: 3, upgrades: 1, downgrades: 1, targetRaises: 1, targetCuts: 1 });
  });

  it("keeps each firm's latest target only", () => {
    const t = latestTargets([a("2026-11-01", "UBS", "main", 340, 296), a("2026-09-01", "UBS", "main", 296, 280), a("2026-10-01", "JPM", "main", 355, 360)], "2026-01-01");
    expect(t.map((x) => [x.firm, x.target])).toEqual([["JPM", 355], ["UBS", 340]]);
  });

  it("beat rate, position and rating labels", () => {
    expect(beatStats([{ quarter: "q1", actual: 2, estimate: 1.9, surprisePct: 0.05 }, { quarter: "q2", actual: 1, estimate: 1.1, surprisePct: -0.09 }])).toMatchObject({ n: 2, beats: 1 });
    expect(positionIn(349.51, 250, 405)).toBeCloseTo(0.642, 2);
    expect(ratingLabel(2.23)).toBe("Buy");
    expect(ratingLabel(3.6)).toBe("Sell");
  });
});

describe("period labels", () => {
  it("moves a reported quarter forward and separates the two fiscal years", () => {
    const P = (code: any, endDate: string) => ({ code, endDate, eps: { avg: 2.9, yearAgo: 1.85, growth: 0.57 } } as any);
    const ps = [P("0q", "2026-09-30"), P("+1q", "2027-03-31"), P("0y", "2027-09-30"), P("+1y", "2027-09-30")];
    fixPeriodEnds(ps, [{ quarter: "2026-09-30", actual: 2.1, estimate: 1.99, surprisePct: 0.058 }]);
    expect(ps.map((p) => p.endDate)).toEqual(["2026-12-31", "2027-03-31", "2027-09-30", "2028-09-30"]);
  });
  it("takes year-ago quarterly EPS from the reported quarter a year earlier", () => {
    const q0 = { code: "0q", endDate: "2026-12-31", eps: { avg: 2.9, yearAgo: 1.85, growth: 0.57 } } as any;
    fixPeriodEnds([q0], [{ quarter: "2025-12-31", actual: 2.84, estimate: 2.67, surprisePct: 0.063 }, { quarter: "2026-09-30", actual: 2.1, estimate: 1.99, surprisePct: 0.058 }]);
    expect(q0.eps.yearAgo).toBe(2.84);
    expect(q0.eps.growth).toBeCloseTo(0.0211, 3);
  });
});
