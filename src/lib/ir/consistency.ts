// Read-time consistency checks of the IR series (pure; run in the page worker after the tidy pass).
// Each failure is flagged at the figure it concerns with the arithmetic in words; nothing is changed.
//   1. Quarters against the year: a flow line whose fiscal year prints all four quarters and the year
//      (none of the five calculated) must add up, within the rounding the release prints in.
//   2. A calculated value against its formula: the shown value must equal the signed sum of the
//      parts it lists.
// Parts against totals are the build's tie-out checks (`payload.checks`), already shown at the total
// and listed under its table.
import { stockKind } from "@/lib/ir/stock";
import { printedStep } from "@/lib/ir/sec-check";
import type { IrPayload, PayloadCell, PayloadCellFlag, PayloadSeries } from "@/lib/ir/payload";

const DAY = 86_400_000;
const ms = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`);
const FLOW_UNITS = new Set(["usd", "count"]);

export interface ConsistencySummary {
  /** years checked against their four printed quarters, and how many failed */
  years: number;
  yearsFailed: number;
  /** calculated values checked against their formula, and how many failed */
  formulas: number;
  formulasFailed: number;
}

const num = (v: number, unit: string) => {
  const a = Math.abs(v);
  const s = unit === "usd" ? (a >= 1e9 ? `$${(a / 1e9).toFixed(3)}B` : a >= 1e6 ? `$${(a / 1e6).toFixed(1)}M` : `$${a.toLocaleString("en-US")}`) : a.toLocaleString("en-US");
  return v < 0 ? `−${s}` : s;
};

/** The four quarter ends inside the fiscal year that ends at `y`, or null when the grid doesn't hold four. */
function quartersOf(y: string, quarters: string[]): string[] | null {
  const qs = quarters.filter((e) => ms(e) <= ms(y) + 7 * DAY && ms(e) > ms(y) - 358 * DAY);
  return qs.length === 4 ? qs : null;
}

/** Whether a sum of rounded quarters equals the printed year at the precision they are printed in. */
function addsUp(sum: number, year: number, parts: number[]): boolean {
  const step = Math.min(...[year, ...parts].map(printedStep));
  // Two units of the coarsest printing, but never more than 2% of the year (round test figures).
  return Math.abs(sum - year) <= Math.max(Math.abs(year) * 0.001, Math.min(2 * step, Math.abs(year) * 0.02)) + 1e-6;
}

/** A quarter's value as first or as last filed, from the cell and its other printing. */
function pick(c: PayloadCell, which: "first" | "last", p: IrPayload): number {
  if (!c.alt || c.alt.d == null) return c.v;
  const at = (d: number | undefined) => (d != null ? p.docs[d]?.filed ?? null : null);
  const a = at(c.d);
  const b = at(c.alt.d);
  if (!a || !b || a === b) return c.v;
  return (which === "first") === (b < a) ? c.alt.v : c.v;
}

export function checkConsistency(p: IrPayload): { payload: IrPayload; summary: ConsistencySummary } {
  const summary: ConsistencySummary = { years: 0, yearsFailed: 0, formulas: 0, formulasFailed: 0 };
  const add = (c: PayloadCell, f: PayloadCellFlag): PayloadCell => ({ ...c, flags: [...(c.flags ?? []).filter((x) => x.k !== f.k), f] });
  const series = p.series.map((s): PayloadSeries => {
    let out: PayloadSeries | null = null;
    const edit = (kind: "q" | "y", e: string, f: PayloadCellFlag) => {
      out ??= { ...s, q: { ...s.q }, y: { ...s.y } };
      out[kind][e] = add(out[kind][e], f);
    };
    // 1. quarters against the year
    if (FLOW_UNITS.has(s.unit) && !stockKind({ pit: s.pit, category: s.cat, metric: s.met, label: s.label, parent: null, breakdown: s.bd }))
      for (const [y, yc] of Object.entries(s.y)) {
        if (yc.f) continue;
        const qs = quartersOf(y, p.quarters);
        if (!qs) continue;
        const cells = qs.map((e) => s.q[e]);
        if (cells.some((c) => !c || c.f)) continue;
        const parts = cells.map((c) => c!.v);
        const sum = parts.reduce((a, b) => a + b, 0);
        summary.years++;
        if (addsUp(sum, yc.v, parts)) continue;
        // One version throughout: when a quarter also has another printing (a recast or the original),
        // the sum is taken with every quarter as first filed, then with every quarter as last filed;
        // the year is flagged only when neither adds up (review iracc H2: LKQ FY2025 mixed vintages).
        const versions = (["first", "last"] as const).map((which) => cells.map((c) => pick(c!, which, p)));
        const mixed = versions.some((vs) => vs.some((v, i) => v !== parts[i]));
        if (mixed && versions.some((vs) => addsUp(vs.reduce((a, b) => a + b, 0), yc.v, vs))) continue;
        summary.yearsFailed++;
        edit("y", y, { k: "year", v: sum, why: `The four quarters add up to ${num(sum, s.unit)} (${parts.map((v) => num(v, s.unit)).join(" + ")}); the year prints ${num(yc.v, s.unit)}, ${num(yc.v - sum, s.unit)} apart.` });
      }
    // 2. calculated values against their formula
    for (const kind of ["q", "y"] as const)
      for (const [e, c] of Object.entries(s[kind])) {
        if (!c.f?.parts.length) continue;
        summary.formulas++;
        const sum = c.f.parts.reduce((a, pt) => a + pt.sign * pt.v, 0);
        if (Math.abs(sum - c.v) <= Math.max(1e-6 * Math.abs(c.v), 0.5)) continue;
        summary.formulasFailed++;
        edit(kind, e, { k: "formula", v: sum, why: `${c.f.formula}: ${c.f.parts.map((pt, i) => `${i ? (pt.sign < 0 ? "− " : "+ ") : pt.sign < 0 ? "−" : ""}${num(pt.v, s.unit)}`).join(" ")} = ${num(sum, s.unit)}, but the cell shows ${num(c.v, s.unit)}.` });
      }
    return out ?? s;
  });
  return { payload: { ...p, series }, summary };
}
