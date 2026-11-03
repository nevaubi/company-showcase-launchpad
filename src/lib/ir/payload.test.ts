import { describe, expect, it } from "vitest";
import { buildPayload, scaleOutliers } from "./payload";

const cells = (vals: number[]) => Object.fromEntries(vals.map((v, i) => [`2025-0${i + 1}-30`, { v }]));

describe("unit mix-up detection", () => {
  it("flags a quarter read in thousands instead of millions", () => {
    const c = cells([4.1e9, 4.3e9, 4.4e6, 4.6e9, 4.8e9]);
    expect([...scaleOutliers(c)]).toEqual(["2025-03-30"]);
  });
  it("does not flag ordinary growth or a 10× jump", () => {
    expect(scaleOutliers(cells([1e6, 2e6, 4e6, 8e6, 16e6])).size).toBe(0);
    expect(scaleOutliers(cells([1e9, 1.1e9, 11e9, 1.2e9, 1.3e9])).size).toBe(0);
  });
  it("needs agreeing neighbours as a baseline", () => {
    expect(scaleOutliers(cells([1e3, 1e6, 1e9])).size).toBe(0);
  });
});

describe("totals whose lines never add up", () => {
  const fact = (label: string, end: string, value: number, extra: Record<string, unknown> = {}) =>
    ({ category: "kpi", metric: "volume", parent: "Commercial", label, is_total: false, period_start: null, period_end: end, months: 3, value, unit: "count", accn: "a", doc: `${end}.htm`, filed: end, locator: { t: 0, r: 0, c: 1 }, ...extra }) as never;
  it("shows them as plain lines instead of a breakdown that fails every quarter", () => {
    const ends = ["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31"];
    const facts = ends.flatMap((e, i) => [fact("Residential", e, 9000 + i), fact("Unbilled Sales", e, 100 + i), fact("Commercial", e, 8600 + i * 3, { parent: null, is_total: true })]);
    const p = buildPayload("DUK", facts);
    expect(p.stats.unlinked).toBe(1);
    expect(p.checks.filter((c) => !c.ok)).toHaveLength(0);
  });
  it("keeps a real breakdown that misses by a little in one quarter", () => {
    const ends = ["2025-03-31", "2025-06-30", "2025-09-30"];
    const facts = ends.flatMap((e, i) => [fact("A", e, 60), fact("B", e, 40), fact("Commercial", e, i === 1 ? 103 : 100, { parent: null, is_total: true })]);
    const p = buildPayload("X", facts);
    expect(p.stats.unlinked).toBe(0);
    expect(p.checks.filter((c) => c.ok)).toHaveLength(2);
  });
});
