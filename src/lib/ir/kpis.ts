// Pure assembly of IR-sourced segment/KPI series: dedupe across releases (latest filing wins),
// derive missing fourth quarters (FY − Q1−Q2−Q3, or FY − 9M YTD), and reconcile children to parent totals.

export interface IrFact {
  document_id?: string;
  document_kind?: string | null;
  category: string; // dimension, e.g. "segment", "product", "geography", "kpi"
  metric: string; // e.g. "revenue", "operating_income", "units"
  parent: string | null;
  label: string;
  is_total: boolean;
  period_start: string | null;
  period_end: string;
  months: number;
  value: number;
  unit: string;
  accn: string | null;
  doc: string | null;
  filed: string | null;
  locator: { t: number; r: number; c: number; text?: string } | Record<string, never>;
}

export interface IrPart {
  label: string;
  value: number;
  sign: 1 | -1;
  fact: IrFact;
}

export interface IrCell {
  v: number;
  fact?: IrFact;
  derived?: { formula: string; parts: IrPart[] };
}

export interface IrSeries {
  key: string;
  category: string;
  metric: string;
  label: string;
  parent: string | null;
  isTotal: boolean;
  unit: string;
  cells: Record<string, IrCell>; // by quarter end date (YYYY-MM-DD)
}

export interface ReconcileCheck {
  group: string;
  period: string;
  total: number;
  sum: number;
  ok: boolean;
  children: number;
}

const DAY = 86_400_000;
const t = (d: string) => Date.parse(`${d}T00:00:00Z`);
const near = (a: string, b: string, days = 6) => Math.abs(t(a) - t(b)) <= days * DAY;
export const normLabel = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(net sales|net revenues?|revenues?|total)\b/g, (m) => (m === "total" ? "total" : "revenue"))
    .trim();

const seriesKey = (f: Pick<IrFact, "category" | "metric" | "label" | "unit">) => `${f.category}|${f.metric}|${normLabel(f.label)}|${f.unit}`;

/** Snap a period end to an existing quarter end within a few days (52/53-week filers). */
function snap(ends: string[], d: string) {
  return ends.find((e) => near(e, d)) ?? d;
}

export function buildIrSeries(facts: IrFact[]): { series: IrSeries[]; quarters: string[]; checks: ReconcileCheck[] } {
  // Latest filing wins for an identical (series, period, length).
  const best = new Map<string, IrFact>();
  for (const f of facts) {
    if (!Number.isFinite(f.value)) continue;
    const k = `${seriesKey(f)}|${f.period_end}|${f.months}`;
    const cur = best.get(k);
    if (!cur || (f.filed ?? "") > (cur.filed ?? "")) best.set(k, f);
  }
  const all = [...best.values()];
  const quarterEnds: string[] = [];
  for (const f of all.filter((x) => x.months === 3).sort((a, b) => a.period_end.localeCompare(b.period_end))) {
    if (!quarterEnds.some((e) => near(e, f.period_end))) quarterEnds.push(f.period_end);
  }
  for (const f of all.filter((x) => x.months === 12)) if (!quarterEnds.some((e) => near(e, f.period_end))) quarterEnds.push(f.period_end);
  quarterEnds.sort();

  const bySeries = new Map<string, IrSeries>();
  const annual = new Map<string, IrFact[]>();
  const ytd9 = new Map<string, IrFact[]>();
  for (const f of all) {
    const key = seriesKey(f);
    let s = bySeries.get(key);
    if (!s) {
      s = { key, category: f.category, metric: f.metric, label: f.label, parent: f.parent, isTotal: f.is_total, unit: f.unit, cells: {} };
      bySeries.set(key, s);
    }
    if (f.months === 3) s.cells[snap(quarterEnds, f.period_end)] = { v: f.value, fact: f };
    else if (f.months === 12) annual.set(key, [...(annual.get(key) ?? []), f]);
    else if (f.months === 9) ytd9.set(key, [...(ytd9.get(key) ?? []), f]);
  }

  // Q4 = FY − (Q1+Q2+Q3), else FY − 9M YTD. Ratios and percentages are never derived.
  for (const [key, fys] of annual) {
    const s = bySeries.get(key)!;
    if (s.unit === "pct" || s.unit === "ratio") continue;
    for (const fy of fys) {
      const q4 = snap(quarterEnds, fy.period_end);
      if (s.cells[q4]) continue;
      const start = fy.period_start ?? new Date(t(fy.period_end) - 364 * DAY).toISOString().slice(0, 10);
      const qs = Object.entries(s.cells)
        .filter(([end, c]) => c.fact && t(end) > t(start) && t(end) < t(fy.period_end) - 40 * DAY)
        .sort(([a], [b]) => a.localeCompare(b));
      const fyPart: IrPart = { label: `FY ending ${fy.period_end}`, value: fy.value, sign: 1, fact: fy };
      if (qs.length === 3) {
        const v = fy.value - qs.reduce((n, [, c]) => n + c.v, 0);
        s.cells[q4] = { v, derived: { formula: "Full year − Q1 − Q2 − Q3", parts: [fyPart, ...qs.map(([end, c]) => ({ label: `Quarter ending ${end}`, value: c.v, sign: -1 as const, fact: c.fact! }))] } };
        continue;
      }
      const nine = (ytd9.get(key) ?? []).find((y) => t(y.period_end) < t(fy.period_end) && t(y.period_end) > t(fy.period_end) - 120 * DAY);
      if (nine) {
        s.cells[q4] = { v: fy.value - nine.value, derived: { formula: "Full year − nine-month YTD", parts: [fyPart, { label: `Nine months ending ${nine.period_end}`, value: nine.value, sign: -1, fact: nine }] } };
      }
    }
  }

  // Reconcile: children of a parent total (same category & metric) must sum to it per quarter.
  const series = [...bySeries.values()];
  inferSubtotals(series);
  const checks: ReconcileCheck[] = [];
  const totals = series.filter((s) => s.isTotal);
  for (const total of totals) {
    const kids = childrenOf(series, total);
    if (kids.length < 2) continue;
    for (const [end, c] of Object.entries(total.cells)) {
      const vals = kids.map((k) => k.cells[end]?.v);
      if (vals.some((v) => v == null)) continue;
      const sum = (vals as number[]).reduce((a, b) => a + b, 0);
      const tol = Math.max(Math.abs(c.v) * 0.005, 1.5e6);
      checks.push({ group: `${total.category}:${total.label}`, period: end, total: c.v, sum, ok: Math.abs(sum - c.v) <= tol, children: kids.length });
    }
  }
  return { series, quarters: quarterEnds, checks };
}

const childrenOf = (series: IrSeries[], total: IrSeries) =>
  series.filter((s) => s !== total && s.category === total.category && s.metric === total.metric && s.unit === total.unit && s.parent && normLabel(s.parent) === normLabel(total.label));

/**
 * Releases often print a flat product table next to a "Products / Services" split. When one child
 * equals the sum of a subset of its siblings in every shared quarter, it is a subtotal: re-parent
 * that subset under it so totals reconcile at each level.
 */
export function inferSubtotals(series: IrSeries[]) {
  for (const total of series.filter((s) => s.isTotal)) {
    const kids = childrenOf(series, total);
    if (kids.length < 3 || kids.length > 14) continue;
    const ends = Object.keys(total.cells).filter((e) => kids.every((k) => k.cells[e]));
    if (!ends.length) continue;
    const kidSum = (e: string) => kids.reduce((n, k) => n + k.cells[e].v, 0);
    if (ends.every((e) => Math.abs(kidSum(e) - total.cells[e].v) <= Math.abs(total.cells[e].v) * 0.005)) continue;
    // Subtotals are larger than their parts: try the biggest candidates first.
    for (const k of [...kids].sort((a, b) => Math.abs(b.cells[ends[0]].v) - Math.abs(a.cells[ends[0]].v))) {
      const others = kids.filter((o) => o !== k);
      const e0 = ends[0];
      let found: IrSeries[] | null = null;
      for (let mask = 1; mask < 1 << others.length && !found; mask++) {
        const sub = others.filter((_, i) => mask & (1 << i));
        if (sub.length < 2) continue;
        const ok = ends.every((e) => Math.abs(sub.reduce((n, o) => n + o.cells[e].v, 0) - k.cells[e].v) <= Math.max(Math.abs(k.cells[e].v) * 0.002, 1e6));
        if (ok && Math.abs(sub.reduce((n, o) => n + o.cells[e0].v, 0)) > 0) found = sub;
      }
      if (found) {
        k.isTotal = true;
        for (const o of found) o.parent = k.label;
        break;
      }
    }
  }
}
