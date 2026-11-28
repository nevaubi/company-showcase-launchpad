import { describe, expect, it } from "vitest";
import type { PayloadCell } from "@/lib/ir/payload";
import { printedChecks, type CheckRow } from "@/lib/ir/statement-checks";

const QS = ["2025-12-27", "2026-03-28", "2026-06-27", "2026-09-26"];
/** A row printed in whole millions; `vals` in millions by quarter (null: not printed). */
function row(i: number, label: string, vals: (number | null)[], o: Partial<CheckRow> = {}): CheckRow {
  const cells: Record<string, PayloadCell> = {};
  const from: Record<string, string> = {};
  vals.forEach((v, n) => {
    if (v == null) return;
    cells[QS[n]] = { v: v * 1e6, m: 3, x: v.toLocaleString("en-US") };
    from[QS[n]] = `k${i}`;
  });
  return { i, label, unit: "usd", pit: false, total: false, q: { cells, from }, y: { cells: {}, from: {} }, step: () => 1e6, ...o };
}
const none = () => false;
const marks = (m: Map<string, { ok: boolean }>, i: number) => QS.map((e) => m.get(`k${i}|q|${e}`)?.ok);

// Apple's condensed statement of operations, fiscal 2026 quarters, in millions.
const apple = () => [
  row(0, "Products", [113743, 80208, 78678, 82904], { up: 2 }),
  row(1, "Services", [30013, 30976, 30739, 31573], { up: 2 }),
  row(2, "Total net sales", [143756, 111184, 109417, 114477], { total: true }),
  row(3, "Products", [67478, 49179, 47153, 52064], { up: 5 }),
  row(4, "Services", [7047, 7224, 7494, 7593], { up: 5 }),
  row(5, "Total cost of sales", [74525, 56403, 54647, 59657], { total: true }),
  row(6, "Gross margin", [69231, 54781, 54770, 54820]),
  row(7, "Research and development", [10887, 11419, 11729, 11730], { up: 9 }),
  row(8, "Selling, general and administrative", [7492, 7477, 7346, 7459], { up: 9 }),
  row(9, "Total operating expenses", [18379, 18896, 19075, 19189], { total: true }),
  row(10, "Operating income", [50852, 35885, 35695, 35631]),
  row(11, "Other income/(expense), net", [150, -52, 572, 504]),
  row(12, "Income before provision for income taxes", [51002, 35833, 36267, 36135]),
  row(13, "Provision for income taxes", [8905, 6255, 6478, 5424]),
  row(14, "Net income", [42097, 29578, 29789, 30711]),
  row(15, "Diluted", [2.84, 2.01, 2.02, 2.1], { unit: "usdPerShare", step: () => 0.01 }),
];

describe("checks the printed rows prove", () => {
  it("ties a total to the parts printed under it when the build stored no check", () => {
    const m = printedChecks(apple(), none);
    expect(marks(m, 2)).toEqual([true, true, true, true]);
    expect(m.get("k2|q|2026-09-26")).toMatchObject({ by: "block", n: 2, total: 114477e6, sum: 114477e6 });
  });

  it("ties a result to the lines printed above it, with their signs", () => {
    const m = printedChecks(apple(), none);
    expect(m.get("k6|q|2026-09-26")).toMatchObject({ by: "formula", ok: true, f: "Gross margin = Total net sales − Total cost of sales", sub: ["Total cost of sales"] });
    expect(m.get("k10|q|2026-03-28")?.f).toBe("Operating income = Gross margin − Total operating expenses");
    expect(m.get("k12|q|2026-03-28")?.f).toBe("Income before provision for income taxes = Operating income + Other income/(expense), net");
    expect(m.get("k14|q|2026-06-27")?.f).toBe("Net income = Income before provision for income taxes − Provision for income taxes");
    for (const i of [6, 10, 12, 14]) expect(marks(m, i)).toEqual([true, true, true, true]);
  });

  it("states nothing for a line no run of lines above it explains, or of another unit", () => {
    const m = printedChecks(apple(), none);
    expect(marks(m, 11)).toEqual([undefined, undefined, undefined, undefined]);
    expect(marks(m, 15)).toEqual([undefined, undefined, undefined, undefined]);
    // parts are terms of their own total only
    expect([...m.keys()].some((k) => k.startsWith("k7|") || k.startsWith("k13|"))).toBe(false);
  });

  it("leaves a key that already carries a check alone", () => {
    const m = printedChecks(apple(), (k) => k === "k6|q|2026-09-26");
    expect(m.has("k6|q|2026-09-26")).toBe(false);
    expect(m.get("k6|q|2026-06-27")?.ok).toBe(true);
  });

  it("needs two periods of different figures: one period is no evidence", () => {
    const one = apple().map((r) => ({ ...r, q: { cells: { [QS[3]]: r.q.cells[QS[3]] }, from: { [QS[3]]: r.q.from[QS[3]] } } }));
    expect(printedChecks(one, none).size).toBe(0);
  });

  it("marks a period that does not tie only when four others do, and no formula when too many are off", () => {
    const more = ["2025-03-29", "2025-06-28", "2025-09-27"];
    const wide = (i: number, label: string, vals: number[], o: Partial<CheckRow> = {}) => {
      const r = row(i, label, vals.slice(0, 4), o);
      vals.slice(4).forEach((v, n) => {
        r.q.cells[more[n]] = { v: v * 1e6, m: 3, x: String(v) };
        r.q.from[more[n]] = `k${i}`;
      });
      return r;
    };
    // Net income misread in one of seven quarters (29,578 stored as 29,518).
    const rows = [
      wide(0, "Income before taxes", [51002, 35833, 36267, 36135, 29310, 28031, 32804]),
      wide(1, "Provision", [8905, 6255, 6478, 5424, 4530, 4597, 5338]),
      wide(2, "Net income", [42097, 29518, 29789, 30711, 24780, 23434, 27466]),
    ];
    const m = printedChecks(rows, none);
    expect(m.get("k2|q|2026-03-28")).toMatchObject({ ok: false, total: 29518e6, sum: 29578e6 });
    expect(m.get("k2|q|2026-06-27")?.ok).toBe(true);
    // Three of four off: the lines are not a formula, nothing is marked.
    const bad = [row(0, "A", [10, 20, 30, 40]), row(1, "B", [1, 2, 3, 4]), row(2, "C", [11, 25, 36, 47])];
    expect(printedChecks(bad, none).size).toBe(0);
  });

  it("ties a period missing a term only when the printed terms alone give the result, never marks it off", () => {
    const rows = [
      row(0, "Operating income", [100, 120, 130, 140]),
      row(1, "Restructuring", [5, null, 7, null]),
      row(2, "Other", [1, 2, 3, 4]),
      row(3, "Pretax income", [96, 122, 126, 150]),
    ];
    const m = printedChecks(rows, none);
    // k=2 ("Restructuring", "Other") does not explain it; the run of three does: 100 − 5 + 1, 130 − 7 + 3.
    expect(m.get("k3|q|2025-12-27")?.f).toBe("Pretax income = Operating income − Restructuring + Other");
    expect(m.get("k3|q|2026-03-28")).toMatchObject({ ok: true, n: 2 });
    // 140 + 4 is not 150 and Restructuring is not printed: no claim either way.
    expect(m.has("k3|q|2026-09-26")).toBe(false);
  });

  it("allows half a unit of rounding per printed term, not more", () => {
    const near = [row(0, "A", [10, 20, 30, 40]), row(1, "B", [1, 2, 3, 4]), row(2, "C", [12, 22, 33, 44])];
    // off by one in two periods, within 1.5 units of rounding for three printed figures
    expect(marks(printedChecks(near, none), 2)).toEqual([true, true, true, true]);
    const far = [row(0, "A", [10, 20, 30, 40]), row(1, "B", [1, 2, 3, 4]), row(2, "C", [13, 24, 35, 46])];
    expect(printedChecks(far, none).size).toBe(0);
  });

  it("never mixes balances with flows or one unit with another", () => {
    const rows = [
      row(0, "Total current assets", [100, 110, 120, 130], { pit: true }),
      row(1, "Total non-current assets", [200, 210, 220, 230], { pit: true }),
      row(2, "Net income", [300, 320, 340, 360]),
      row(3, "Total assets", [300, 320, 340, 360], { pit: true }),
    ];
    const m = printedChecks(rows, none);
    expect(m.get("k3|q|2026-09-26")?.f).toBe("Total assets = Total current assets + Total non-current assets");
    expect([...m.keys()].some((k) => k.startsWith("k2|"))).toBe(false);
  });

  it("adds up money and counts only, and only figures large against their rounding", () => {
    // JPM's capital ratios: three neighbouring ratios "explained" a fourth in several quarters.
    const pct = (i: number, label: string, vals: number[]) => row(i, label, vals, { unit: "pct", step: () => 0.1 });
    const ratios = [pct(0, "Tier 1 capital ratio", [16.6, 16.4, 16.8, 16.9]), pct(1, "Total capital ratio", [18.5, 18.2, 18.7, 18.8]), pct(2, "Tier 1 leverage ratio", [7.2, 7.1, 7.3, 7.3]), pct(3, "SLR", [5.3, 5.3, 5.4, 5.4])];
    expect(printedChecks(ratios, none).size).toBe(0);
    const small = [row(0, "A", [1, 2, 1, 2]), row(1, "B", [1, 1, 2, 2]), row(2, "C", [2, 3, 3, 4])];
    expect(printedChecks(small, none).size).toBe(0);
  });

  it("says nothing against a period in which the table printed a line it no longer prints", () => {
    const more = ["2024-09-28", "2025-03-29", "2025-06-28", "2025-09-27"];
    const wide = (i: number, label: string, vals: (number | null)[], o: Partial<CheckRow> = {}) => {
      const r = row(i, label, vals.slice(0, 4) as number[], { pit: true, ...o });
      vals.slice(4).forEach((v, n) => {
        if (v == null) return;
        r.q.cells[more[n]] = { v: v * 1e6, m: 0, x: String(v) };
        r.q.from[more[n]] = `k${i}`;
      });
      for (const c of Object.values(r.q.cells)) c.m = 0;
      return r;
    };
    // Apple: total non-current liabilities = term debt + other, except while deferred revenue was printed too.
    const rows = [
      wide(0, "Term debt", [83956, 78566, 82430, 78328, 97207, 78566, 82430, 78328]),
      wide(1, "Other non-current liabilities", [46906, 42115, 43050, 41549, 40415, 42115, 43050, 41549]),
      wide(2, "Total non-current liabilities", [130862, 120681, 125480, 119877, 140458, 120681, 125480, 119877]),
      wide(3, "Deferred revenue", [null, null, null, null, 2836], { old: true }),
    ];
    const m = printedChecks(rows, none);
    expect(m.get("k2|q|2026-09-26")?.ok).toBe(true);
    expect(m.has("k2|q|2024-09-28")).toBe(false);
  });

  it("does not state a formula two sign sets explain equally, or one with a term that is always zero", () => {
    const zero = [row(0, "A", [10, 20, 30, 40]), row(1, "B", [0, 0, 0, 0]), row(2, "C", [10, 20, 30, 40])];
    expect(printedChecks(zero, none).size).toBe(0);
  });
});
