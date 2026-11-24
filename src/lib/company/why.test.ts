import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hydrateDataset } from "@/lib/financials/dataset";
import type { CompanyDataset } from "@/lib/financials/types";
import { fcfWhy, operatingIncomeWhy, revenueWhy, viewDrivers, whyCards } from "./why";

const load = (t: string) => hydrateDataset(JSON.parse(readFileSync(path.resolve(__dirname, `../../test/fixtures/companies/${t}.json`), "utf8")) as CompanyDataset);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("whyCards", () => {
  for (const t of ["NVDA", "AAPL", "MSFT", "GOOGL", "META", "JPM"]) {
    it(`${t}: every card's drivers account for the change and sit on distinct quarters`, () => {
      const d = load(t);
      for (const w of whyCards(d)) {
        const change = w.metric.value - w.metric.previous;
        expect(w.metric.series).toHaveLength(8);
        expect(w.metric.previousSeries).toHaveLength(8);
        expect(w.metric.points).toHaveLength(8);
        expect(w.metric.series.at(-1)).toBe(w.metric.value);
        expect(w.metric.previousSeries.at(-1)).toBe(w.metric.previous);
        for (const ins of [w.insight, ...w.followUps.map((f) => f.insight)]) {
          expect(ins.drivers.length).toBeGreaterThan(0);
          expect(ins.drivers.length).toBeLessThanOrEqual(3);
          expect(new Set(ins.drivers.map((x) => x.point)).size).toBe(ins.drivers.length);
          for (const x of ins.drivers) {
            expect(x.point).toBeGreaterThanOrEqual(0);
            expect(x.point).toBeLessThan(8);
          }
          // Drivers explain the change to within what the named lines leave out.
          expect(Math.abs(sum(ins.drivers.map((x) => x.delta)) - change)).toBeLessThanOrEqual(Math.abs(change) * 0.1 + 1);
          // Every driver named in the text exists, and each driver is read out once.
          const read = ins.segments.filter((s) => s.driver).map((s) => s.driver);
          expect(read).toEqual(ins.drivers.map((x) => x.id));
        }
      }
    });
  }

  it("walks NVIDIA's operating income down the income statement", () => {
    const w = operatingIncomeWhy(load("NVDA"))!;
    const change = w.metric.value - w.metric.previous;
    expect(sum(w.insight.drivers.map((x) => x.delta))).toBeCloseTo(change, 0);
    expect(w.insight.drivers[0].label).toBe("Revenue");
    const cost = w.insight.drivers.find((x) => x.label === "Cost of revenue")!;
    // Costs rose with sales, so they count against operating income.
    expect(cost.delta).toBeLessThan(0);
    expect(w.insight.segments.map((s) => s.text).join("")).toMatch(/Cost of revenue rose by \$[\d.]+B, which took that much off/);
    expect(w.insight.segments.at(-1)!.text).toMatch(/Operating margin went from \d+\.\d% to \d+\.\d%\./);
  });

  it("splits NVIDIA's revenue by reported segment and offers the other breakdowns that add up", () => {
    const w = revenueWhy(load("NVDA"))!;
    expect(w.followUps.map((f) => f.id)).toContain("segment");
    expect(w.insight.drivers[0].label).toBe("Compute & Networking");
    expect(w.insight.segments[0].text).toMatch(/^Revenue was \$[\d.]+B in Q\d FY\d\d, up \$[\d.]+B from a year earlier\.$/);
  });

  it("explains free cash flow with operating cash and capital spending only", () => {
    const w = fcfWhy(load("MSFT"))!;
    expect(w.insight.drivers.map((x) => x.label).sort()).toEqual(["Capital spending", "Cash from operations"]);
    expect(sum(w.insight.drivers.map((x) => x.delta))).toBeCloseTo(w.metric.value - w.metric.previous, 0);
  });
});

describe("viewDrivers", () => {
  it("keeps the served quarter's cards only when the read explains nothing, and names the newer quarter", () => {
    const served = load("JPM");
    const served_ = whyCards(served);
    expect(served_.length).toBeGreaterThan(0);
    // a read that adds a newer quarter whose lines cannot be split: nothing explains it
    const q = served.statements.quarterly;
    const newer = { ...q.income.periods.at(-1)!, label: "Q9 FY99", end: "2099-12-31" };
    const read: CompanyDataset = {
      ...served,
      segments: [],
      statements: { ...served.statements, quarterly: { ...q, income: { ...q.income, periods: [...q.income.periods, newer], rows: [] }, cashflow: { ...q.cashflow, rows: [] } } },
    };
    expect(whyCards(read)).toHaveLength(0);
    const v = viewDrivers(served, read);
    expect(v.data).toBe(served);
    expect(v.cards.map((c) => [c.id, c.metric.period])).toEqual(served_.map((c) => [c.id, c.metric.period]));
    expect(v.period).toBe(served_[0].metric.period);
    expect(v.newer).toBe("Q9 FY99");
  });

  it("prefers the newer quarter's cards when they explain at least one figure, even fewer of them", () => {
    const served = load("AAPL");
    const read: CompanyDataset = { ...served, segments: [] };
    const now = whyCards(read);
    expect(now.length).toBeGreaterThan(0);
    expect(now.length).toBeLessThan(whyCards(served).length);
    const v = viewDrivers(served, read);
    expect(v.data).toBe(read);
    expect(v.cards.map((c) => c.id)).toEqual(now.map((c) => c.id));
    expect(v.newer).toBeNull();
  });

  it("uses the served statements when nothing was read", () => {
    const served = load("AAPL");
    const v = viewDrivers(served, served);
    expect(v.data).toBe(served);
    expect(v.newer).toBeNull();
    expect(v.period).toBe(served.statements.quarterly.income.periods.at(-1)?.label);
  });
});
