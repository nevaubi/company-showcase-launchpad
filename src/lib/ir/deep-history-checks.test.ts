// Totals and their parts over fifteen years of history: the newest document's table says which lines a total
// closes, and periods in which the table printed other lines say nothing against it.
// Figures: Entegris' balance sheets and statements of cash flows as printed in its releases (thousands until
// 2023, millions since), read from the stored documents.
import { describe, expect, it } from "vitest";
import type { PayloadCell, PayloadSeries } from "@/lib/ir/payload";
import { printedChecks, type CheckRow } from "@/lib/ir/statement-checks";
import { addsUp, shapeRows, type TreeLine, type TreeRow } from "@/lib/ir/statement-tree";

const ENDS = ["2023-07-01", "2023-09-30", "2023-12-31", "2024-03-30", "2025-12-31", "2026-03-28", "2026-06-27", "2026-09-26"];
/** Document each period's figures come from: the newest release (0) prints its own date and the year end. */
const DOCS = [13, 12, 7, 10, 0, 2, 1, 0];
// Millions, as printed (thousands rounded to the thousand they print).
const CURRENT_ASSETS: [string, number[]][] = [
  ["Cash and cash equivalents", [567.017, 594.02, 456.929, 340.7, 360.4, 442.7, 353.6, 356.5]],
  ["Trade accounts and notes receivable, net", [435.973, 463.083, 457.052, 424.494, 458.7, 529.5, 559.1, 625.2]],
  ["Inventories, net", [740.351, 662.169, 607.051, 625.668, 643.2, 644.4, 703.9, 769.0]],
  ["Deferred tax charges and refundable income taxes", [55.461, 67.848, 63.879, 53.078, 35.1, 29.0, 30.1, 35.1]],
  ["Other current assets", [117.799, 111.223, 113.663, 123.53, 140.8, 140.4, 138.2, 134.9]],
  ["Total current assets", [2968.548, 2943.56, 1977.327, 1575.447, 1638.2, 1786.0, 1784.9, 1920.7]],
];
/** Printed until early 2024 only. */
const HELD_FOR_SALE = [1051.947, 1045.217, 278.753, 7.995];

const cellsOf = (vals: number[], docs = DOCS) =>
  Object.fromEntries(vals.map((v, i) => [ENDS[i], { v: Math.round(v * 1e6), m: 0, d: docs[i], x: String(v) } as PayloadCell]));

describe("which lines a total closes", () => {
  const lines: TreeLine[] = CURRENT_ASSETS.map(([name], i) => ({ kind: "line", k: `k${i}`, ks: [`k${i}`], depth: 0, total: false, name } as TreeLine & { name: string }));
  const figures = new Map(CURRENT_ASSETS.map(([, vals], i) => [`k${i}`, cellsOf(vals)]));
  const cells = (r: TreeLine, f: "q" | "y") => (f === "q" ? figures.get(r.k)! : {});
  const byKey = new Map(lines.map((l) => [l.k, { k: l.k, unit: "usd", total: false, parent: null } as unknown as PayloadSeries]));
  const label = (r: TreeLine) => (r as TreeLine & { name: string }).name;

  it("is decided by the periods the section's own document prints", () => {
    const [total, parts] = [lines[5], lines.slice(0, 5)];
    // Over all periods the five lines do not add up (assets held for sale stood among them until 2024)…
    expect(addsUp(total, parts, cells, "usd")).toBe(false);
    // …in the newest release's own two dates they do.
    expect(addsUp(total, parts, cells, "usd", 0)).toBe(true);
    // A document that prints none of the total's periods leaves the rule as it was.
    expect(addsUp(total, parts, cells, "usd", 99)).toBe(false);
  });

  it("gives the total its parts in the section's hierarchy", () => {
    const rows: TreeRow[] = [{ kind: "head", text: "Current assets", depth: 0 }, ...lines.map((l) => ({ ...l }))];
    shapeRows(rows, byKey, label, cells, 0);
    const total = rows[6] as TreeLine;
    expect(total.total).toBe(true);
    expect(rows.slice(1, 6).map((r) => (r as TreeLine).up)).toEqual([6, 6, 6, 6, 6]);
    const before: TreeRow[] = [{ kind: "head", text: "Current assets", depth: 0 }, ...lines.map((l) => ({ ...l }))];
    shapeRows(before, byKey, label, cells);
    expect((before[6] as TreeLine).total).toBe(false);
  });
});

const checkRow = (i: number, label: string, cells: Record<string, PayloadCell>, o: Partial<CheckRow> = {}): CheckRow => ({
  i,
  label,
  unit: "usd",
  pit: true,
  total: false,
  q: { cells, from: Object.fromEntries(Object.keys(cells).map((e) => [e, `k${i}`])) },
  y: { cells: {}, from: {} },
  step: (c) => (/\.\d$/.test(c.x ?? "") ? 1e5 : 1e3),
  ...o,
});

describe("a total's periods over a long history", () => {
  const parts = (docs = DOCS) => CURRENT_ASSETS.slice(0, 5).map(([name, vals], i) => checkRow(i, name, cellsOf(vals, docs), { up: 5 }));
  const total = (docs = DOCS) => checkRow(5, "Total current assets", cellsOf(CURRENT_ASSETS[5][1], docs), { total: true });
  const mark = (m: Map<string, { ok: boolean }>, e: string) => m.get(`k5|q|${e}`)?.ok;

  it("marks the periods that tie although half the history does not, and none of those as off", () => {
    const m = printedChecks([...parts(), total()], () => false);
    expect(ENDS.slice(4).map((e) => mark(m, e))).toEqual([true, true, true, true]);
    expect(ENDS.slice(0, 4).map((e) => mark(m, e))).toEqual([undefined, undefined, undefined, undefined]);
    expect(m.get("k5|q|2026-09-26")).toMatchObject({ by: "block", n: 5, total: 1920.7e6 });
  });

  it("says nothing against a period in which a line since dropped was printed, with that line shown", () => {
    const held = checkRow(6, "Assets held-for-sale", cellsOf(HELD_FOR_SALE), { old: true });
    const m = printedChecks([...parts(), total(), held], () => false);
    expect(ENDS.map((e) => mark(m, e))).toEqual([undefined, undefined, undefined, undefined, true, true, true, true]);
  });

  // One period off among eight (the total misprinted by 10.0), the rest tying.
  const oneOff = (docs: number[]) => {
    const vals = CURRENT_ASSETS.map(([, v]) => v.slice(4).concat(v.slice(4).map((x) => x + 1)));
    const ends = [...ENDS.slice(4), "2024-12-31", "2025-03-29", "2025-06-28", "2025-09-27"];
    const at = (v: number[], shift = 0) =>
      Object.fromEntries(v.map((x, i) => [ends[i], { v: Math.round((x + (i === 7 ? shift : 0)) * 1e6), m: 0, d: docs[i], x: x.toFixed(1) } as PayloadCell]));
    // Parts shifted by one each, so the sum moves by five; the total follows except in the last period.
    const rows = vals.slice(0, 5).map((v, i) => checkRow(i, CURRENT_ASSETS[i][0], at(v), { up: 5 }));
    const tot = vals[5].map((x, i) => (i >= 4 ? x + 4 : x));
    return [...rows, checkRow(5, "Total current assets", at(tot, 10), { total: true })];
  };
  it("marks a period that does not add up when the page holds every line", () => {
    const m = printedChecks(oneOff([0, 0, 0, 0, 1, 1, 1, 1]), () => false);
    expect(m.get("k5|q|2025-09-27")?.ok).toBe(false);
    expect(m.get("k5|q|2025-06-28")?.ok).toBe(true);
  });
  it("with lines left out of the page, only when one document prints the total and every part", () => {
    const same = printedChecks(oneOff([0, 0, 0, 0, 1, 1, 1, 1]), () => false, { partial: true });
    expect(same.get("k5|q|2025-09-27")?.ok).toBe(false);
    // The last period's parts come from other documents than its total.
    const rows = oneOff([0, 0, 0, 0, 1, 1, 1, 1]);
    rows[5].q.cells["2025-09-27"].d = 2;
    const mixed = printedChecks(rows, () => false, { partial: true });
    expect(mixed.has("k5|q|2025-09-27")).toBe(false);
    expect(mixed.get("k5|q|2025-06-28")?.ok).toBe(true);
  });
});

describe("a result of the lines above it, where older periods held other lines", () => {
  // Entegris' investing activities, quarters and the year 2025, in millions.
  const flow = (i: number, label: string, q: Record<string, number>, y: Record<string, number>, o: Partial<CheckRow> = {}): CheckRow => {
    const mk = (m: Record<string, number>, months: number) =>
      Object.fromEntries(Object.entries(m).map(([e, v]) => [e, { v: Math.round(v * 1e6), m: months, x: v.toFixed(1) } as PayloadCell]));
    const from = (m: Record<string, number>) => Object.fromEntries(Object.keys(m).map((e) => [e, `k${i}`]));
    return { i, label, unit: "usd", pit: false, total: false, q: { cells: mk(q, 3), from: from(q) }, y: { cells: mk(y, 12), from: from(y) }, step: () => 1e5, ...o };
  };
  const rows = [
    flow(0, "Acquisition of property, plant and equipment", { "2025-09-27": -66.7, "2025-12-31": -58.0, "2026-03-28": -41.5, "2026-06-27": -39.3, "2026-09-26": -43.2 }, { "2025-12-31": -299.2 }),
    flow(1, "Proceeds from government incentives", { "2025-09-27": 8.2, "2025-12-31": 0, "2026-03-28": 2.0, "2026-06-27": 3.4, "2026-09-26": 0 }, { "2025-12-31": 8.2 }),
    flow(2, "Other", { "2025-09-27": -1.2, "2025-12-31": -1.6, "2026-03-28": 1.1, "2026-06-27": -0.3, "2026-09-26": -6.1 }, { "2025-12-31": -3.1 }),
    flow(3, "Net cash used in investing activities", { "2025-09-27": -59.7, "2025-12-31": -66.3, "2026-03-28": -38.4, "2026-06-27": -36.2, "2026-09-26": -49.3 }, { "2025-12-31": -300.8 }),
    // Printed in the fourth quarter of 2025 only (the sale closed then).
    flow(4, "Proceeds from sale of business, net", { "2025-12-31": -6.7 }, { "2025-12-31": -6.7 }, { old: true }),
  ];
  it("is proved by the periods in which only the lines printed now stood", () => {
    const m = printedChecks(rows, () => false);
    for (const e of ["2025-09-27", "2026-03-28", "2026-06-27", "2026-09-26"]) expect(m.get(`k3|q|${e}`)?.ok).toBe(true);
    expect(m.get("k3|q|2026-09-26")?.f).toBe(
      "Net cash used in investing activities = Acquisition of property, plant and equipment + Proceeds from government incentives + Other",
    );
    // The quarter and year of the sale are neither tied nor marked as off.
    expect(m.has("k3|q|2025-12-31")).toBe(false);
    expect(m.has("k3|y|2025-12-31")).toBe(false);
  });
  it("without that line on the page, two periods off in six are too many for a formula", () => {
    expect(printedChecks(rows.slice(0, 4), () => false).size).toBe(0);
  });
});

describe("a period that does not tie", () => {
  // Netflix's financing activities, in thousands, as printed in its releases of 2025 and 2026.
  const ENDS6 = ["2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"];
  const line = (i: number, label: string, vals: number[]): CheckRow => {
    const cells = Object.fromEntries(vals.map((v, n) => [ENDS6[n], { v: v * 1e3, m: 3, x: v.toLocaleString("en-US") } as PayloadCell]));
    return { i, label, unit: "usd", pit: false, total: false, q: { cells, from: Object.fromEntries(ENDS6.map((e) => [e, `k${i}`])) }, y: { cells: {}, from: {} }, step: () => 1e3 };
  };
  const financing = () => [
    line(0, "Proceeds from issuance of debt", [0, 0, 0, 0, 0, 992_550]),
    line(1, "Repayments of debt", [-1_033_450, 0, 0, 0, 0, 0]),
    line(2, "Proceeds from issuance of common stock", [169_066, 70_215, 76_082, 49_310, 59_980, 74_674]),
    line(3, "Repurchases of common stock", [-1_654_327, -1_856_885, -2_079_559, -1_270_588, -4_714_403, -4_796_725]),
    line(4, "Taxes paid related to net share settlement of equity awards", [-6_114, -6_196, -5_985, -29_230, -6_631, -5_165]),
    line(5, "Other financing activities", [21_957, 55_837, -67_948, 19_694, -8_573, -20_306]),
    line(6, "Net cash used in financing activities", [-2_502_868, -1_737_029, -2_077_410, -1_230_814, -4_669_627, -3_754_972]),
  ];
  it("is not marked when a line printed straight above the terms carries the difference", () => {
    const m = printedChecks(financing(), () => false);
    // Five quarters tie without the debt issue…
    for (const e of ENDS6.slice(0, 5)) expect(m.get(`k6|q|${e}`)?.ok).toBe(true);
    // …and the quarter of the issue (992,550 above the terms) is left unmarked, not marked as off.
    expect(m.has("k6|q|2026-09-30")).toBe(false);
  });
  it("is marked when nothing above explains it", () => {
    const rows = financing();
    rows[0].q.cells["2026-09-30"].v = 0;
    expect(printedChecks(rows, () => false).get("k6|q|2026-09-30")?.ok).toBe(false);
  });
  it("is marked only from the date the page gives: older periods show what ties and nothing else", () => {
    const rows = financing();
    rows[0].q.cells["2026-09-30"].v = 0;
    expect(printedChecks(rows, () => false, { offSince: "2026-07-01" }).get("k6|q|2026-09-30")?.ok).toBe(false);
    const later = printedChecks(rows, () => false, { offSince: "2026-10-01" });
    expect(later.has("k6|q|2026-09-30")).toBe(false);
    expect(later.get("k6|q|2026-06-30")?.ok).toBe(true);
  });
});
