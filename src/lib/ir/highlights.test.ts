import { describe, expect, it } from "vitest";
import type { IrPayload, PayloadGroup, PayloadSeries } from "./payload";
import { biggestMoves, changeOf, formatKpiChange, currency, keyLines, latestQuarter, yearAgo } from "./highlights";

const Q = ["2024-09-30", "2024-12-31", "2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"];
const ser = (k: string, vals: (number | null)[], extra: Partial<PayloadSeries> = {}): PayloadSeries => ({
  k, cat: "segment", met: "revenue", label: k, parent: null, total: false, unit: "usd",
  q: Object.fromEntries(vals.flatMap((v, i) => (v == null ? [] : [[Q[i], { v, m: 3 }]]))),
  y: {},
  ...extra,
});
const grp = (id: string, root: string | null, rows: string[], extra: Partial<PayloadGroup> = {}): PayloadGroup => ({
  id, cat: "segment", met: "revenue", unit: "usd", label: id, root, rows: rows.map((k, i) => ({ k, depth: k === root ? 0 : 1 + 0 * i })), ...extra,
});
const payload = (series: PayloadSeries[], groups: PayloadGroup[]): IrPayload =>
  ({ v: 2, ticker: "X", builtAt: "", quarters: Q, years: [], docs: [], series, groups, checks: [], stats: {} }) as unknown as IrPayload;

describe("IR highlights", () => {
  const total = ser("Total revenue", [90, 95, 100, 105, 110, 115, 120, 125, 132], { total: true });
  const cloud = ser("Cloud", [30, 32, 35, 38, 41, 44, 48, 52, 57], { parent: "Total revenue" });
  const devices = ser("Devices", [60, 63, 65, 67, 69, 71, 72, 73, 75], { parent: "Total revenue" });
  const other = ser("Other", [1, 1, 1, 1, 1, 1, 1, 1, 1], { parent: "Total revenue" });
  const stale = ser("Legacy unit", [5, 5, 5, 5, null, null, null, null, null]);
  const p = payload([total, cloud, devices, other, stale], [grp("rev", "Total revenue", ["Cloud", "Devices", "Other", "Total revenue"]), grp("old", null, ["Legacy unit"])]);

  it("measures change in percent, and in points for percentages", () => {
    expect(changeOf(110, 100, "usd")).toBeCloseTo(10);
    expect(changeOf(41.5, 40, "pct")).toBeCloseTo(1.5);
    expect(changeOf(-5, 10, "usd")).toBeNull();
  });

  it("distinguishes basis points from percentage points and skips a missing quarter", () => {
    expect(formatKpiChange(changeOf(86, 61, "bps"), "bps")).toBe("+25.0 bps");
    expect(formatKpiChange(changeOf(10.9, 11.2, "pct"), "pct")).toBe("−0.3 pts");
    expect(keyLines(p, Q.filter((e) => e !== "2026-06-30"))[0].qoq).toBeNull();
  });

  it("finds the year-ago column by date and the latest well-reported quarter", () => {
    expect(yearAgo(Q, "2026-09-30")).toBe("2025-09-30");
    expect(latestQuarter(p, Q)).toBe("2026-09-30");
  });

  it("leads with the total and its largest parts, never plumbing lines or lines no longer reported", () => {
    const keys = keyLines(p, Q).map((l) => l.s.k);
    expect(keys[0]).toBe("Total revenue");
    expect(keys).toContain("Cloud");
    expect(keys).not.toContain("Other");
    expect(keys).not.toContain("Legacy unit");
    expect(keyLines(p, Q).find((l) => l.s.k === "Cloud")!.yoy).toBeCloseTo((57 / 41 - 1) * 100);
  });

  it("ranks the biggest year-on-year moves", () => {
    expect(biggestMoves(p, Q).up[0].s.k).toBe("Cloud");
  });

  it("puts breakdowns missing from the latest columns after current ones", () => {
    const cells = (k: string) => p.series.find((s) => s.k === k)?.q;
    expect(currency(p.groups[0], cells, Q.slice(-8)).tier).toBe(0);
    expect(currency(p.groups[1], cells, Q.slice(-8)).tier).toBe(2);
  });
});

describe("IR highlights on roll-forwards", () => {
  it("keeps only the ending line of a customer roll-forward", () => {
    const beg = ser("Beginning funded customers", [20, 21, 22, 23, 24, 25, 26, 27, 28], { cat: "kpi", met: "users", unit: "count" });
    const churn = ser("Churned customers", [-1, -1, -1, -1, -1, -1, -1, -1, -1], { cat: "kpi", met: "users", unit: "count" });
    const end = ser("Ending funded customers", [21, 22, 23, 24, 25, 26, 27, 28, 29], { cat: "kpi", met: "users", unit: "count", total: true });
    const p = payload([beg, churn, end], [grp("roll", "Ending funded customers", ["Beginning funded customers", "Churned customers", "Ending funded customers"], { cat: "kpi", met: "users", unit: "count" })]);
    expect(keyLines(p, Q).map((l) => l.s.k)).toEqual(["Ending funded customers"]);
  });
});
