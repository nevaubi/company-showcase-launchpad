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

describe("recast segment structures", () => {
  it("shows each quarter as printed in the latest release whose parts add up, hiding superseded lines", () => {
    const S = { category: "segment", parent: "Total revenue" };
    const facts = [
      // original Q1 2025 release: old segments A + B
      f("Total revenue", "2025-03-31", 3, 100e6, { ...S, parent: null, is_total: true, document_id: "d1", filed: "2025-04-25" }),
      f("Alpha", "2025-03-31", 3, 50e6, { ...S, document_id: "d1", filed: "2025-04-25" }),
      f("Beta", "2025-03-31", 3, 50e6, { ...S, document_id: "d1", filed: "2025-04-25" }),
      // Q1 2026 release recasts Q1 2025 into new segments C + D
      f("Total revenue", "2025-03-31", 3, 100e6, { ...S, parent: null, is_total: true, document_id: "d2", filed: "2026-04-24" }),
      f("Cloud", "2025-03-31", 3, 60e6, { ...S, document_id: "d2", filed: "2026-04-24" }),
      f("Devices", "2025-03-31", 3, 40e6, { ...S, document_id: "d2", filed: "2026-04-24" }),
      f("Total revenue", "2026-03-31", 3, 120e6, { ...S, parent: null, is_total: true, document_id: "d2", filed: "2026-04-24" }),
      f("Cloud", "2026-03-31", 3, 75e6, { ...S, document_id: "d2", filed: "2026-04-24" }),
      f("Devices", "2026-03-31", 3, 45e6, { ...S, document_id: "d2", filed: "2026-04-24" }),
    ];
    const { series, checks } = buildIrSeries(facts);
    const by = (l: string) => series.find((s) => s.label === l)!;
    expect(by("Alpha").cells["2025-03-31"]).toBeUndefined();
    expect(by("Cloud").cells["2025-03-31"].v).toBe(60e6);
    expect(checks.filter((c) => c.kind === "q")).toHaveLength(2);
    expect(checks.every((c) => c.ok)).toBe(true);
  });

  it("falls back to an older release when the newest one's parts don't add up", () => {
    const S = { category: "segment", parent: "Total revenue" };
    const facts = [
      f("Total revenue", "2025-03-31", 3, 100e6, { ...S, parent: null, is_total: true, document_id: "d1", filed: "2025-04-25" }),
      f("Alpha", "2025-03-31", 3, 70e6, { ...S, document_id: "d1", filed: "2025-04-25" }),
      f("Beta", "2025-03-31", 3, 30e6, { ...S, document_id: "d1", filed: "2025-04-25" }),
      f("Total revenue", "2025-03-31", 3, 100e6, { ...S, parent: null, is_total: true, document_id: "d2", filed: "2026-04-24" }),
      f("Alpha", "2025-03-31", 3, 70e6, { ...S, document_id: "d2", filed: "2026-04-24" }),
      f("Beta", "2025-03-31", 3, 20e6, { ...S, document_id: "d2", filed: "2026-04-24" }),
    ];
    const { series, checks } = buildIrSeries(facts);
    expect(series.find((s) => s.label === "Beta")!.cells["2025-03-31"].v).toBe(30e6);
    expect(checks).toEqual([expect.objectContaining({ ok: true, sum: 100e6 })]);
  });
});

describe("fiscal years and point-in-time values", () => {
  it("sums four reported quarters into a fiscal year when the year isn't printed, and never derives balances", () => {
    const q = ["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31"];
    const facts = [
      ...q.map((e, i) => f("Mac", e, 3, 10 + i)),
      f("Mac", "2024-12-31", 12, 40),
      f("Subscribers", "2025-12-31", 0, 900, { category: "kpi", metric: "users", unit: "count", parent: null }),
      f("Subscribers", "2024-12-31", 0, 800, { category: "kpi", metric: "users", unit: "count", parent: null }),
    ];
    const { series, years } = buildIrSeries(facts);
    const mac = series.find((s) => s.label === "Mac")!;
    expect(years).toContain("2024-12-31");
    const subs = series.find((s) => s.label === "Subscribers")!;
    expect(subs.pit).toBe(true);
    expect(subs.cells["2025-12-31"].v).toBe(900);
    expect(subs.annual["2024-12-31"].v).toBe(800);
    expect(mac.annual["2024-12-31"].v).toBe(40);
  });
});

describe("flattened vs nested tables", () => {
  // Release A nests iPhone/Mac under "Products"; release B lists them straight under the total.
  const A = { document_id: "A", filed: "2026-07-30" };
  const B = { document_id: "B", filed: "2026-01-29" };
  const facts: IrFact[] = [
    f("iPhone", "2026-06-27", 3, 40, { ...A, parent: "Products" }),
    f("Mac", "2026-06-27", 3, 10, { ...A, parent: "Products" }),
    f("Products", "2026-06-27", 3, 50, { ...A, is_total: true }),
    f("Services", "2026-06-27", 3, 25, A),
    f("Total net sales", "2026-06-27", 3, 75, { ...A, is_total: true, parent: null }),
    f("iPhone", "2025-12-27", 3, 60, B),
    f("Mac", "2025-12-27", 3, 9, B),
    f("Services", "2025-12-27", 3, 26, B),
    f("Total net sales", "2025-12-27", 3, 95, { ...B, is_total: true, parent: null }),
  ];
  const { series, checks } = buildIrSeries(facts);

  it("keeps one iPhone line under Products for both releases", () => {
    const iphones = series.filter((s) => s.label === "iPhone");
    expect(iphones).toHaveLength(1);
    expect(iphones[0].parent).toBe("Products");
    expect(iphones[0].cells["2025-12-27"].v).toBe(60);
    expect(iphones[0].cells["2026-06-27"].v).toBe(40);
  });

  it("rebuilds the missing Products subtotal from the parts that release printed", () => {
    const products = series.find((s) => s.label === "Products")!;
    expect(products.cells["2025-12-27"].v).toBe(69);
    expect(products.cells["2025-12-27"].derived?.formula).toMatch(/Sum of the components/);
    expect(products.cells["2026-06-27"].v).toBe(50);
  });

  it("checks the grand total in both quarters but never counts the rebuilt subtotal as a check", () => {
    const total = checks.filter((c) => c.group === "product:Total net sales");
    expect(total.map((c) => [c.period, c.ok])).toEqual(expect.arrayContaining([["2025-12-27", true], ["2026-06-27", true]]));
    expect(checks.filter((c) => c.group === "product:Products").map((c) => c.period)).toEqual(["2026-06-27"]);
  });
});

describe("selected-item lists", () => {
  it("flags a total whose listed lines always fall short as a partial list, not an error", () => {
    const q = ["2026-03-31", "2026-06-30", "2026-09-30"];
    const facts = q.flatMap((e, i) => [
      f("Mounjaro", e, 3, 10 + i, { category: "product", breakdown: "Selected Products" }),
      f("Zepbound", e, 3, 5 + i, { category: "product", breakdown: "Selected Products" }),
      f("Total Revenue", e, 3, 24 + i, { category: "product", is_total: true, parent: null }),
    ]);
    const { checks } = buildIrSeries(facts.map((x) => ({ ...x, parent: x.label === "Total Revenue" ? null : "Total Revenue" })));
    expect(checks).toHaveLength(3);
    expect(checks.every((c) => !c.ok && c.partial)).toBe(true);
  });
  it("keeps a breakdown whose parts exceed the total as a real mismatch", () => {
    const facts = [
      f("A", "2026-03-31", 3, 20, { parent: "Total" }),
      f("B", "2026-03-31", 3, 15, { parent: "Total" }),
      f("Total", "2026-03-31", 3, 30, { is_total: true, parent: null }),
    ];
    const { checks } = buildIrSeries(facts);
    expect(checks[0].ok).toBe(false);
    expect(checks[0].partial).toBeUndefined();
  });
});
