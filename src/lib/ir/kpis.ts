// Pure assembly of IR-sourced segment / KPI series.
//  1. optional cross-period label map (renames, merges, category / parent fixes) is applied
//  2. every (series, period) keeps all vintages — one per document that printed it
//  3. fourth quarters are derived (FY − Q1 − Q2 − Q3, else FY − nine-month YTD); fiscal years are
//     read directly or derived as the sum of four quarters
//  4. each breakdown is shown, period by period, "as reported in the latest consistent release":
//     the newest document that printed the total *and* whose printed parts add up to it. Lines that
//     release no longer shows (a recast segment structure) are hidden for that period, so every
//     column of a breakdown adds up to its total — and the check result is recorded per period.

export interface IrFact {
  id?: string;
  document_id?: string;
  document_kind?: string | null;
  category: string; // dimension, e.g. "segment", "product", "geography", "kpi", "cost"
  metric: string; // e.g. "revenue", "operating_income", "units"
  breakdown?: string | null;
  parent: string | null;
  label: string;
  is_total: boolean;
  period_start: string | null;
  period_end: string;
  months: number; // 3, 6, 9, 12; 0 = point in time
  value: number;
  unit: string;
  accn: string | null;
  doc: string | null;
  filed: string | null;
  method?: string;
  locator: { t: number; r: number; c: number; text?: string } | { page: number; box: number[]; text?: string } | Record<string, never>;
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
  breakdown?: string | null;
  /** Point-in-time values (balances, subscriber counts) rather than flows */
  pit?: boolean;
  cells: Record<string, IrCell>; // quarter end (YYYY-MM-DD)
  annual: Record<string, IrCell>; // fiscal-year end
}

export interface ReconcileCheck {
  group: string; // `${category}:${total label}`
  totalKey: string;
  period: string;
  kind: "q" | "fy";
  total: number;
  sum: number;
  ok: boolean;
  children: number;
}

export interface LabelMapEntry {
  category: string;
  metric: string;
  label: string;
  parent: string | null;
  is_total: boolean;
  drop?: boolean;
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

/** Identity of a raw extracted line, used to key the label map. */
export const rawKey = (f: Pick<IrFact, "category" | "metric" | "unit" | "label" | "parent">) => `${f.category}|${f.metric}|${f.unit}|${normLabel(f.label)}|${normLabel(f.parent ?? "")}`;

/** A line is its dimension, label and the total it rolls into (the same label can appear in two tables). */
const seriesKey = (f: Pick<IrFact, "category" | "metric" | "label" | "unit" | "parent">) => `${f.category}|${f.metric}|${normLabel(f.label)}|${f.unit}|${normLabel(f.parent ?? "")}`;
const docOf = (f: IrFact) => f.document_id ?? f.accn ?? "doc";
const FLOW_UNITS = new Set(["usd", "count", "other"]);
/** Lines that can't be negative: a negative derived value means mismatched vintages, not data. */
const NONNEG_METRICS = new Set(["revenue", "units", "users", "volume", "backlog", "assets", "deposits", "loans", "aum", "headcount", "stores"]);

/** Snap a period end to an existing grid date within a few days (52/53-week filers). */
function snap(ends: string[], d: string) {
  return ends.find((e) => near(e, d)) ?? d;
}

export function applyLabelMap(facts: IrFact[], map: Record<string, LabelMapEntry> | undefined): IrFact[] {
  if (!map) return facts;
  const out: IrFact[] = [];
  for (const f of facts) {
    const m = map[rawKey(f)];
    if (!m) out.push(f);
    else if (!m.drop) out.push({ ...f, category: m.category, metric: m.metric, label: m.label, parent: m.parent, is_total: m.is_total });
  }
  return out;
}

interface Vintage {
  v: number;
  fact?: IrFact;
  derived?: IrCell["derived"];
  doc: string;
  filed: string;
}

/** Fiscal-year end month (1-12): the most common end month among 12-month periods (trailing-twelve-month columns are rarer). */
export function fiscalYearEndMonth(facts: IrFact[]): number | null {
  const n = new Map<number, number>();
  for (const f of facts) if (f.months === 12) n.set(Number(f.period_end.slice(5, 7)), (n.get(Number(f.period_end.slice(5, 7))) ?? 0) + 1);
  const best = [...n.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : null;
}

const monthNear = (d: string, m: number) => {
  const dm = Number(d.slice(5, 7));
  const day = Number(d.slice(8, 10));
  return dm === m || (dm === (m % 12) + 1 && day <= 7) || (dm === ((m + 10) % 12) + 1 && day >= 24);
};

export function buildIrSeries(input: IrFact[], opts: { labelMap?: Record<string, LabelMapEntry>; fyEndMonth?: number | null } = {}): { series: IrSeries[]; quarters: string[]; years: string[]; checks: ReconcileCheck[] } {
  const mapped = applyLabelMap(input, opts.labelMap).filter((f) => Number.isFinite(f.value));
  // Trailing-twelve-month columns ending mid-year are not fiscal years.
  const fyEnd = opts.fyEndMonth ?? fiscalYearEndMonth(mapped);
  const facts = fyEnd ? mapped.filter((f) => f.months !== 12 || monthNear(f.period_end, fyEnd)) : mapped;

  // Period grids: quarter ends (3-month and point-in-time values) and fiscal-year ends.
  const quarters: string[] = [];
  for (const f of facts.filter((x) => x.months === 3).sort((a, b) => a.period_end.localeCompare(b.period_end))) {
    if (!quarters.some((e) => near(e, f.period_end))) quarters.push(f.period_end);
  }
  const years: string[] = [];
  for (const f of facts.filter((x) => x.months === 12).sort((a, b) => a.period_end.localeCompare(b.period_end))) {
    const e = snap(quarters, f.period_end);
    if (!years.some((y) => near(y, e))) years.push(e);
  }
  for (const y of years) if (!quarters.some((e) => near(e, y))) quarters.push(y);
  for (const f of facts.filter((x) => x.months === 0)) if (!quarters.some((e) => near(e, f.period_end, 20))) quarters.push(f.period_end);
  quarters.sort();
  years.sort();

  // All vintages per series and period, newest filing first.
  const bySeries = new Map<string, IrSeries>();
  const qv = new Map<string, Map<string, Vintage[]>>(); // quarterly (3M or point in time)
  const fv = new Map<string, Map<string, Vintage[]>>(); // fiscal year
  const nine = new Map<string, IrFact[]>();
  const votes = new Map<string, { total: number; n: number; breakdown: Map<string, number>; parent: Map<string, number> }>();
  const push = (m: Map<string, Map<string, Vintage[]>>, key: string, end: string, v: Vintage) => {
    let per = m.get(key);
    if (!per) m.set(key, (per = new Map()));
    const list = per.get(end) ?? [];
    list.push(v);
    per.set(end, list);
  };
  for (const f of facts) {
    const key = seriesKey(f);
    let s = bySeries.get(key);
    if (!s) {
      s = { key, category: f.category, metric: f.metric, label: f.label, parent: f.parent, isTotal: f.is_total, unit: f.unit, cells: {}, annual: {} };
      bySeries.set(key, s);
      votes.set(key, { total: 0, n: 0, breakdown: new Map(), parent: new Map() });
    }
    const vt = votes.get(key)!;
    vt.n++;
    if (f.is_total) vt.total++;
    if (f.breakdown) vt.breakdown.set(f.breakdown, (vt.breakdown.get(f.breakdown) ?? 0) + 1);
    vt.parent.set(f.parent ?? "", (vt.parent.get(f.parent ?? "") ?? 0) + 1);
    const vin: Vintage = { v: f.value, fact: f, doc: docOf(f), filed: f.filed ?? "" };
    if (f.months === 3) push(qv, key, snap(quarters, f.period_end), vin);
    else if (f.months === 0) {
      s.pit = true;
      push(qv, key, quarters.find((e) => near(e, f.period_end, 20)) ?? f.period_end, vin);
    } else if (f.months === 12) push(fv, key, snap(years, f.period_end), vin);
    else if (f.months === 9) nine.set(key, [...(nine.get(key) ?? []), f]);
  }
  const top = <K>(m: Map<K, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  for (const s of bySeries.values()) {
    const vt = votes.get(s.key)!;
    s.isTotal = vt.total * 2 >= vt.n;
    s.breakdown = top(vt.breakdown) ?? null;
    s.parent = top(vt.parent) || null;
  }
  for (const m of [qv, fv]) for (const per of m.values()) for (const list of per.values()) list.sort((a, b) => b.filed.localeCompare(a.filed));

  // Latest vintage per cell.
  for (const s of bySeries.values()) {
    for (const [end, list] of qv.get(s.key) ?? []) s.cells[end] = { v: list[0].v, fact: list[0].fact };
    for (const [end, list] of fv.get(s.key) ?? []) s.annual[end] = { v: list[0].v, fact: list[0].fact };
  }

  // Fourth quarters: FY − (Q1+Q2+Q3), else FY − 9M YTD. Never for ratios, percentages or balances.
  for (const s of bySeries.values()) {
    if (s.pit || !FLOW_UNITS.has(s.unit)) continue;
    for (const [fyEnd, list] of fv.get(s.key) ?? []) {
      const fy = list[0].fact!;
      const q4 = snap(quarters, fyEnd);
      if (s.cells[q4]) continue;
      const start = fy.period_start ?? new Date(t(fy.period_end) - 364 * DAY).toISOString().slice(0, 10);
      const qs = Object.entries(s.cells)
        .filter(([end, c]) => c.fact && t(end) > t(start) && t(end) < t(fy.period_end) - 40 * DAY)
        .sort(([a], [b]) => a.localeCompare(b));
      const fyPart: IrPart = { label: `Fiscal year ending ${fy.period_end}`, value: fy.value, sign: 1, fact: fy };
      let cell: IrCell | null = null;
      if (qs.length === 3) {
        cell = {
          v: fy.value - qs.reduce((n, [, c]) => n + c.v, 0),
          derived: { formula: "Full year − Q1 − Q2 − Q3", parts: [fyPart, ...qs.map(([end, c]) => ({ label: `Quarter ending ${end}`, value: c.v, sign: -1 as const, fact: c.fact! }))] },
        };
      } else {
        const ytd = (nine.get(s.key) ?? []).filter((y) => t(y.period_end) < t(fy.period_end) && t(y.period_end) > t(fy.period_end) - 120 * DAY).sort((a, b) => (b.filed ?? "").localeCompare(a.filed ?? ""))[0];
        if (ytd) cell = { v: fy.value - ytd.value, derived: { formula: "Full year − nine-month YTD", parts: [fyPart, { label: `Nine months ending ${ytd.period_end}`, value: ytd.value, sign: -1, fact: ytd }] } };
      }
      if (!cell || (cell.v < 0 && NONNEG_METRICS.has(s.metric))) continue;
      s.cells[q4] = cell;
      push(qv, s.key, q4, { v: cell.v, derived: cell.derived, doc: "derived", filed: fy.filed ?? "" });
    }
  }

  // Fiscal years not printed: sum of the four quarters inside the year.
  for (const s of bySeries.values()) {
    for (const fyEnd of years) {
      if (s.annual[fyEnd]) continue;
      if (s.pit) {
        const c = s.cells[snap(quarters, fyEnd)];
        if (c) {
          s.annual[fyEnd] = c;
          push(fv, s.key, fyEnd, { v: c.v, fact: c.fact, derived: c.derived, doc: c.fact ? docOf(c.fact) : "derived", filed: c.fact?.filed ?? "" });
        }
        continue;
      }
      if (!FLOW_UNITS.has(s.unit)) continue;
      const qs = quarters.filter((e) => t(e) <= t(fyEnd) + 6 * DAY && t(e) > t(fyEnd) - 360 * DAY).slice(-4);
      if (qs.length !== 4 || !qs.every((e) => s.cells[e])) continue;
      const parts = qs.map((e) => ({ e, c: s.cells[e] }));
      const cell: IrCell = {
        v: parts.reduce((n, p) => n + p.c.v, 0),
        derived: {
          formula: "Q1 + Q2 + Q3 + Q4",
          parts: parts.flatMap((p) => (p.c.fact ? [{ label: `Quarter ending ${p.e}`, value: p.c.v, sign: 1 as const, fact: p.c.fact }] : (p.c.derived?.parts ?? []))),
        },
      };
      s.annual[fyEnd] = cell;
      push(fv, s.key, fyEnd, { v: cell.v, derived: cell.derived, doc: "derived-fy", filed: "" });
    }
  }

  const series = [...bySeries.values()];
  borrowTotals(series, qv, fv);
  inferSubtotals(series);
  splitDoubleBreakdowns(series, qv, fv);

  // Per-period vintage choice and reconciliation, top-down from each root total.
  const checks: ReconcileCheck[] = [];
  const kidsMemo = new Map<IrSeries, IrSeries[]>();
  const kidsOf = (s: IrSeries) => {
    let k = kidsMemo.get(s);
    if (!k) kidsMemo.set(s, (k = childrenOf(series, s)));
    return k;
  };
  const tol = (v: number) => Math.max(Math.abs(v) * 0.005, 1.5e6);
  const tolFor = (s: IrSeries, v: number) => (s.unit === "usd" ? tol(v) : Math.max(Math.abs(v) * 0.005, 1.5));

  for (const kind of ["q", "fy"] as const) {
    const store = kind === "q" ? qv : fv;
    const cellsOf = (s: IrSeries) => (kind === "q" ? s.cells : s.annual);
    const fromDoc = (s: IrSeries, end: string, doc: string) => store.get(s.key)?.get(end)?.find((x) => x.doc === doc);

    /** Evaluate a subtree for one period using one document's printed values. */
    const evaluate = (node: IrSeries, end: string, doc: string, out: ReconcileCheck[], apply: boolean): boolean => {
      const own = fromDoc(node, end, doc);
      if (apply && own) cellsOf(node)[end] = { v: own.v, fact: own.fact, derived: own.derived };
      const value = own?.v ?? cellsOf(node)[end]?.v;
      const kids = kidsOf(node);
      if (!kids.length || value == null) return true;
      const inDoc = kids.filter((k) => fromDoc(k, end, doc));
      let members: IrSeries[];
      if (inDoc.length >= 2) {
        members = inDoc;
        if (apply) for (const k of kids) if (!inDoc.includes(k)) delete cellsOf(k)[end];
      } else {
        members = kids.filter((k) => cellsOf(k)[end]);
      }
      let ok = true;
      for (const k of members) {
        const childDoc = fromDoc(k, end, doc) ? doc : (store.get(k.key)?.get(end)?.[0]?.doc ?? doc);
        ok = evaluate(k, end, childDoc, out, apply) && ok;
      }
      if (members.length >= 2 && node.isTotal && (node.unit === "usd" || node.unit === "count")) {
        const sum = members.reduce((n, k) => n + (fromDoc(k, end, doc)?.v ?? cellsOf(k)[end]?.v ?? 0), 0);
        const pass = Math.abs(sum - value) <= tolFor(node, value);
        out.push({ group: `${node.category}:${node.label}`, totalKey: node.key, period: end, kind, total: value, sum, ok: pass, children: members.length });
        ok = ok && pass;
      }
      return ok;
    };

    const roots = series.filter((s) => s.isTotal && kidsOf(s).length && !series.some((p) => p !== s && kidsOf(p).includes(s)));
    for (const root of roots) {
      for (const end of Object.keys(cellsOf(root))) {
        const vintages = store.get(root.key)?.get(end) ?? [];
        let chosen = vintages[0]?.doc;
        for (const v of vintages) {
          const trial: ReconcileCheck[] = [];
          if (evaluate(root, end, v.doc, trial, false) && trial.length) {
            chosen = v.doc;
            break;
          }
        }
        if (!chosen) continue;
        evaluate(root, end, chosen, checks, true);
      }
    }
  }
  return { series, quarters, years, checks };
}

/**
 * A second breakdown of the same total (revenue by product type next to revenue by segment) lives
 * in its own category but names the shared total as parent. Give that category a copy of the total.
 */
function borrowTotals(series: IrSeries[], qv: Map<string, Map<string, Vintage[]>>, fv: Map<string, Map<string, Vintage[]>>) {
  const has = new Set(series.filter((s) => s.isTotal).map((s) => `${s.category}|${s.metric}|${s.unit}|${normLabel(s.label)}`));
  const wanted = new Map<string, IrSeries>();
  for (const s of series) {
    if (!s.parent) continue;
    const k = `${s.category}|${s.metric}|${s.unit}|${normLabel(s.parent)}`;
    if (has.has(k) || wanted.has(k)) continue;
    const src = series.find((t) => t.isTotal && t.metric === s.metric && t.unit === s.unit && t.category !== s.category && normLabel(t.label) === normLabel(s.parent!));
    if (src) wanted.set(k, { ...src, key: `${src.key}#in:${s.category}`, category: s.category, cells: { ...src.cells }, annual: { ...src.annual } });
  }
  for (const copy of wanted.values()) {
    const base = copy.key.split("#in:")[0];
    series.push(copy);
    if (qv.has(base)) qv.set(copy.key, qv.get(base)!);
    if (fv.has(base)) fv.set(copy.key, fv.get(base)!);
  }
}

export const childrenOf = (series: IrSeries[], total: IrSeries) =>
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

/**
 * Two breakdowns of the same total (e.g. by segment and by product) are sometimes put under one
 * parent, so the children add to 2× the total. When a subset of children matches the total in every
 * quarter and the rest does too, split the rest into its own "second breakdown" group.
 */
export function splitDoubleBreakdowns(series: IrSeries[], qv?: Map<string, Map<string, Vintage[]>>, fv?: Map<string, Map<string, Vintage[]>>) {
  for (const total of series.filter((s) => s.isTotal && !s.key.endsWith("#alt"))) {
    const kids = childrenOf(series, total);
    if (kids.length < 4 || kids.length > 16) continue;
    const ends = Object.keys(total.cells).filter((e) => kids.every((k) => k.cells[e]));
    if (!ends.length) continue;
    const tol = (e: string) => Math.max(Math.abs(total.cells[e].v) * 0.005, 1.5e6);
    const sumOf = (xs: IrSeries[], e: string) => xs.reduce((n, k) => n + k.cells[e].v, 0);
    if (!ends.every((e) => Math.abs(sumOf(kids, e) - 2 * total.cells[e].v) <= 2 * tol(e))) continue;
    // Both breakdowns must be printed side by side in one release — otherwise it's a recast, not a split.
    if (qv) {
      const together = ends.some((e) => {
        const docSets = kids.map((k) => new Set((qv.get(k.key)?.get(e) ?? []).map((v) => v.doc)));
        return [...docSets[0]].some((d) => docSets.every((ds) => ds.has(d)));
      });
      if (!together) continue;
    }
    let split: IrSeries[] | null = null;
    for (let mask = 1; mask < 1 << kids.length && !split; mask++) {
      const sub = kids.filter((_, i) => mask & (1 << i));
      if (sub.length < 2 || sub.length > kids.length - 2 || !(mask & 1)) continue;
      if (ends.every((e) => Math.abs(sumOf(sub, e) - total.cells[e].v) <= tol(e))) split = kids.filter((_, i) => !(mask & (1 << i)));
    }
    if (!split) continue;
    const alt: IrSeries = { ...total, key: `${total.key}#alt`, label: `${total.label} — second breakdown`, cells: { ...total.cells }, annual: { ...total.annual } };
    series.push(alt);
    if (qv?.has(total.key)) qv.set(alt.key, qv.get(total.key)!);
    if (fv?.has(total.key)) fv.set(alt.key, fv.get(total.key)!);
    for (const k of split) k.parent = alt.label;
  }
}

/** Compare IR top-line totals against the SEC-reported statement value for the same quarter. */
export function crossCheckTotals(
  series: IrSeries[],
  reported: { end: string; v: number }[],
  metric = "revenue",
): { label: string; period: string; ir: number; sec: number; ok: boolean }[] {
  const out: { label: string; period: string; ir: number; sec: number; ok: boolean }[] = [];
  for (const s of series) {
    if (!s.isTotal || s.metric !== metric || s.unit !== "usd" || s.parent || s.key.endsWith("#alt")) continue;
    for (const [end, c] of Object.entries(s.cells)) {
      const r = reported.find((x) => near(x.end, end));
      if (!r) continue;
      out.push({ label: s.label, period: end, ir: c.v, sec: r.v, ok: Math.abs(c.v - r.v) <= Math.max(Math.abs(r.v) * 0.005, 1e6) });
    }
  }
  return out;
}
