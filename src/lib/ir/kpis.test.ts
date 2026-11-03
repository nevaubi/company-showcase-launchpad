import { describe, expect, it } from "vitest";
import { buildIrSeries, crossCheckTotals, type IrFact } from "./kpis";
import { parseNumber, parseTables } from "./tables";

const f = (label: string, end: string, months: number, value: number, extra: Partial<IrFact> = {}): IrFact => ({
  category: "product",
  metric: "revenue",
  parent: "Total net sales",
  label,
  is_total: false,
  period_start: null,
  period_end: end,
  months,
  value,
  unit: "usd",
  accn: "a",
  doc: "ex99.htm",
  filed: "2026-01-01",
  locator: { t: 0, r: 0, c: 1 },
  ...extra,
});

describe("IR table parsing", () => {
  it("indexes tables, rows and cells in DOM order and reads accounting negatives", () => {
    const t = parseTables("<table><tr><td>iPhone</td><td>$</td><td>57,583</td></tr><tr><td>Loss</td><td>(1,234)</td></tr></table><table><tr><th>x</th></tr></table>");
    expect(t).toHaveLength(2);
    expect(t[0].rows[0][2]).toBe("57,583");
    expect(parseNumber(t[0].rows[1][1])).toBe(-1234);
    expect(parseNumber("$")).toBeNull();
  });
});

describe("IR KPI series", () => {
  it("derives Q4 as full year minus the three reported quarters", () => {
    const facts = [
      f("Mac", "2026-03-28", 3, 10, { period_start: "2026-01-01" }),
      f("Mac", "2026-06-27", 3, 11),
      f("Mac", "2026-09-26", 3, 12),
      f("Mac", "2026-12-26", 12, 50, { period_start: "2026-01-01" }),
    ];
    const s = buildIrSeries(facts).series[0];
    expect(s.cells["2026-12-26"].v).toBe(17);
    expect(s.cells["2026-12-26"].derived?.parts).toHaveLength(4);
  });

  it("detects a Products subtotal and reconciles every level to its total", () => {
    const end = "2026-09-26";
    const facts = [
      f("iPhone", end, 3, 57e9),
      f("Mac", end, 3, 11e9),
      f("Products", end, 3, 68e9),
      f("Services", end, 3, 32e9),
      f("Total net sales", end, 3, 100e9, { is_total: true, parent: null }),
    ];
    const { checks, series } = buildIrSeries(facts);
    expect(series.find((x) => x.label === "iPhone")?.parent).toBe("Products");
    expect(checks.length).toBe(2);
    expect(checks.every((c) => c.ok)).toBe(true);
  });

  it("flags a breakdown that doesn't add up", () => {
    const end = "2026-09-26";
    const { checks } = buildIrSeries([f("A", end, 3, 40), f("B", end, 3, 40), f("Total net sales", end, 3, 100e6, { is_total: true, parent: null })]);
    expect(checks[0].ok).toBe(false);
  });
});

describe("IR vs SEC cross-check", () => {
  it("matches a release total to the 10-Q revenue for the same quarter (52/53-week dates allowed)", () => {
    const { series } = buildIrSeries([f("Total net sales", "2026-09-26", 3, 114_477e6, { is_total: true, parent: null })]);
    const r = crossCheckTotals(series, [{ end: "2026-09-27", v: 114_477e6 }]);
    expect(r).toEqual([expect.objectContaining({ ok: true })]);
    expect(crossCheckTotals(series, [{ end: "2026-09-26", v: 110_000e6 }])[0].ok).toBe(false);
  });
});

describe("double breakdowns", () => {
  it("splits segment and product lines that were both parented to the same total", () => {
    const P = { parent: "Total revenue" };
    const facts = ["2026-06-30", "2026-09-30"].flatMap((d, i) => [
      f("Total revenue", d, 3, 100e9 + i * 1e9, { is_total: true, parent: null }),
      f("Cloud", d, 3, 60e9 + i * 1e9, P), f("Devices", d, 3, 40e9, P),
      f("Server products", d, 3, 30e9 + i * 1e9, P), f("Office", d, 3, 45e9, P), f("Gaming", d, 3, 25e9, P),
    ]);
    const { checks, series } = buildIrSeries(facts);
    expect(checks.filter((c) => !c.ok)).toEqual([]);
    expect(series.find((s) => s.label === "Gaming")?.parent).toBe("Total revenue — second breakdown");
    expect(series.find((s) => s.label === "Cloud")?.parent).toBe("Total revenue");
  });
});
