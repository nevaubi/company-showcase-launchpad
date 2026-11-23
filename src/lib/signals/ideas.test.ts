import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { BacktestStats, Idea, SignalKind } from "./core";
import { coinBand, IDEA_LIMITS, ideasVerdict, rankIdeas, ruleRecord, ruleRecords } from "./ideas";

/** Pooled rule histories as published on 4 Nov 2026 (public/data/signals.json), rounded. */
const POOLED: Partial<Record<SignalKind, BacktestStats>> = {
  pullback: { n: 1246, avg: 0.0427, avgExcess: 0.00415, hitRate: 0.4743 },
  breakdown: { n: 664, avg: -0.0494, avgExcess: -0.00281, hitRate: 0.5256 },
  rich: { n: 480, avg: -0.0361, avgExcess: -0.00178, hitRate: 0.5479 },
  cheap: { n: 465, avg: 0.0539, avgExcess: 0.00509, hitRate: 0.5161 },
  decel: { n: 535, avg: -0.0458, avgExcess: -0.01013, hitRate: 0.5028 },
  accel: { n: 598, avg: 0.0355, avgExcess: 0.00769, hitRate: 0.4799 },
};

const NONE: BacktestStats = { n: 0, avg: null, avgExcess: null, hitRate: null };

function idea(ticker: string, direction: "long" | "short", kinds: SignalKind[], sector = "Industrials"): Idea {
  return {
    ticker, name: ticker, sector, asOf: "2026-11-02", price: 100, direction, score: 1,
    signals: kinds.map((kind) => ({ kind, detail: "", evidence: [], stats: POOLED[kind] ?? NONE, own: NONE })),
    plan: { entry: 100, stop: direction === "long" ? 96 : 104, target: direction === "long" ? 108 : 92, atr: 2 },
    multiple: "pe",
  } as Idea;
}

describe("what a rule's history can say", () => {
  it("gives the range a fair coin allows", () => {
    // 400 firings: 1.96 * sqrt(0.25 / 400) = 1.96 * 0.025.
    expect(coinBand(400)).toBeCloseTo(0.049, 12);
    expect(coinBand(0)).toBeNull();
  });

  it("reads the published histories: no rule both made money and beat a coin flip, three rules lost money", () => {
    const by = new Map(ruleRecords(POOLED).map((r) => [r.kind, r]));
    expect(by.get("cheap")!.reading).toBe("coin flip");
    expect(by.get("accel")!.reading).toBe("coin flip");
    expect(by.get("pullback")!.reading).toBe("coin flip");
    // A hit rate above the coin's range does not help a rule that lost on average.
    expect(by.get("rich")!.hitRate! - 0.5).toBeGreaterThan(by.get("rich")!.band!);
    expect(by.get("rich")!.reading).toBe("against");
    expect(by.get("decel")!.reading).toBe("against");
    expect(by.get("breakdown")!.reading).toBe("against");
    expect(by.get("insiderBuy")!.reading).toBe("thin");
    expect(ideasVerdict(ruleRecords(POOLED))).toBe("None of the 6 rules with a history has both made money against the S&P 500 and beaten it more often than a coin flip allows; 3 lost to it on average. Use these ideas as a place to start research, not as forecasts.");
  });

  it("calls an edge only when the hit rate clears the coin's range and the average is positive", () => {
    expect(ruleRecord("cheap", { n: 400, avg: 0.05, avgExcess: 0.02, hitRate: 0.56 }).reading).toBe("edge");
    expect(ruleRecord("cheap", { n: 400, avg: 0.05, avgExcess: 0.02, hitRate: 0.54 }).reading).toBe("coin flip");
    expect(ruleRecord("cheap", { n: 400, avg: 0.05, avgExcess: -0.001, hitRate: 0.6 }).reading).toBe("against");
    expect(ruleRecord("cheap", { n: 60, avg: 0.05, avgExcess: 0.03, hitRate: 0.7 }).reading).toBe("thin");
  });
});

describe("ranking ideas", () => {
  const ideas = [
    idea("ONE", "long", ["accel"]),
    idea("TWO", "long", ["accel", "cheap"], "Energy"),
    idea("MIX", "long", ["accel", "cheap", "breakdown"], "Energy"),
    idea("INS", "long", ["insiderBuy"]),
    idea("CHI", "long", ["cheap", "insiderBuy"], "Utilities"),
    idea("SHO", "short", ["rich", "decel"]),
    idea("PUL", "long", ["pullback"], "Materials"),
  ];

  it("puts ideas with more supported reasons first and leaves out those resting on losing or untested rules", () => {
    const r = rankIdeas(ideas, POOLED);
    // TWO: two supported reasons. MIX: two supported, one against. CHI: one supported plus an untested one.
    expect(r.list.map((x) => x.ticker)).toEqual(["TWO", "MIX", "CHI", "ONE", "PUL"]);
    expect(r.all.map((x) => x.ticker).slice(-2).sort()).toEqual(["INS", "SHO"]);
    const two = r.all.find((x) => x.ticker === "TWO")!;
    expect(two).toMatchObject({ reasons: 2, supported: 2, opposing: 0 });
    expect(two.expected).toBeCloseTo((0.00769 + 0.00509) / 2, 12);
    expect(r.all.find((x) => x.ticker === "SHO")).toMatchObject({ reasons: 2, supported: 0, expected: null });
    expect(r.all.find((x) => x.ticker === "MIX")).toMatchObject({ supported: 2, opposing: 1 });
  });

  it("is the same whatever order the ideas arrive in", () => {
    const a = rankIdeas(ideas, POOLED).all.map((x) => x.ticker);
    const b = rankIdeas([...ideas].reverse(), POOLED).all.map((x) => x.ticker);
    expect(b).toEqual(a);
  });

  it("caps the list and how much of it one sector takes", () => {
    const many = Array.from({ length: 30 }, (_, k) => idea(`T${String(k).padStart(2, "0")}`, "long", ["accel"], k < 20 ? "Health Care" : `Sector ${k % 4}`));
    const r = rankIdeas(many, POOLED);
    expect(r.list.length).toBeLessThanOrEqual(IDEA_LIMITS.max);
    expect(r.list.filter((x) => x.sector === "Health Care")).toHaveLength(IDEA_LIMITS.perSector);
    expect(r.all).toHaveLength(30);
    expect(rankIdeas(many, POOLED, { max: 4, perSector: 2 }).list).toHaveLength(4);
  });

  it("lists nothing when no rule has made money", () => {
    const losing = { rich: POOLED.rich!, decel: POOLED.decel!, breakdown: POOLED.breakdown! };
    expect(rankIdeas(ideas, losing).list).toEqual([]);
  });

  it("holds on the published file: a dozen at most, none resting on a rule that lost", () => {
    const file = JSON.parse(readFileSync(resolve(process.cwd(), "public/data/signals.json"), "utf8")) as { ideas: Idea[]; pooled: Partial<Record<SignalKind, BacktestStats>> };
    const r = rankIdeas(file.ideas, file.pooled);
    expect(r.all).toHaveLength(file.ideas.length);
    expect(r.list.length).toBeLessThanOrEqual(IDEA_LIMITS.max);
    for (const x of r.list) expect(x.supported - x.opposing).toBeGreaterThanOrEqual(1);
    const perSector = new Map<string, number>();
    for (const x of r.list) perSector.set(x.sector, (perSector.get(x.sector) ?? 0) + 1);
    expect(Math.max(0, ...perSector.values())).toBeLessThanOrEqual(IDEA_LIMITS.perSector);
  });
});
