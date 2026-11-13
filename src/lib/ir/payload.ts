// Compact, precomputed IR series payload stored per company (ir_company_series) and sent to the
// IR data page. Pure: built by the pipeline scripts and by the server after new extractions.
import { buildIrSeries, childrenOf, neverTies, type IrCell, type IrFact, type IrSeries, type LabelMapEntry, type ReconcileCheck } from "@/lib/ir/kpis";

export type PayloadLocator = [number, number, number] | { p: number; b: number[] };

export interface PayloadPart {
  label: string;
  v: number;
  sign: 1 | -1;
  d?: number;
  l?: PayloadLocator;
  x?: string;
  /** page (1-based) or worksheet of the stored document that prints the line in `x` */
  p?: number;
  sh?: string;
  s?: string;
  e: string;
  m: number;
}
export interface PayloadCell {
  v: number;
  /** index into payload.docs */
  d?: number;
  l?: PayloadLocator;
  /** printed text of the source cell */
  x?: string;
  /** page (1-based) or worksheet of the stored document that prints the line in `x` */
  p?: number;
  sh?: string;
  s?: string;
  e?: string;
  m?: number;
  f?: { formula: string; parts: PayloadPart[] };
  /** "scale": about 1,000× off the neighbouring periods — likely a thousands/millions mix-up */
  w?: "scale";
}
export interface PayloadSeries {
  k: string;
  cat: string;
  met: string;
  label: string;
  parent: string | null; // parent series key
  total: boolean;
  unit: string;
  bd?: string | null;
  /** table the line belongs to, when the same label appears in several tables of one release */
  sc?: string;
  pit?: boolean;
  q: Record<string, PayloadCell>;
  y: Record<string, PayloadCell>;
}
export interface PayloadGroup {
  id: string;
  cat: string;
  met: string;
  unit: string;
  label: string;
  bd?: string | null;
  root: string | null;
  /** Rows in display order: components first, each total after its parts. */
  rows: { k: string; depth: number }[];
}
export interface PayloadCheck {
  k: string;
  e: string;
  kind: "q" | "fy";
  total: number;
  sum: number;
  ok: boolean;
  n: number;
  /** parts are a selected list that covers only part of the total */
  partial?: boolean;
  /** lines subtracted for the parts to equal the total (deductions printed as positives) */
  sub?: string[];
}
export interface PayloadDoc {
  id: string;
  accn: string | null;
  doc: string | null;
  kind: string | null;
  filed: string | null;
}
export interface IrPayload {
  v: 2;
  ticker: string;
  builtAt: string;
  quarters: string[];
  years: string[];
  docs: PayloadDoc[];
  series: PayloadSeries[];
  groups: PayloadGroup[];
  checks: PayloadCheck[];
  stats: IrStats;
}
export interface IrStats {
  series: number;
  groups: number;
  documents: number;
  facts: number;
  firstPeriod: string | null;
  lastPeriod: string | null;
  checksQ: { ok: number; total: number; partial?: number };
  checksFY: { ok: number; total: number; partial?: number };
  /** values flagged as ~1,000× off their neighbouring periods */
  scaleFlags?: number;
  /** printed totals whose listed lines never add up, shown as plain lines instead of a breakdown */
  unlinked?: number;
}

const locOf = (f: IrFact): PayloadLocator | undefined => {
  const l = f.locator as Record<string, unknown>;
  if (typeof l.t === "number") return [l.t as number, l.r as number, l.c as number];
  if (typeof l.page === "number" && Array.isArray(l.box)) return { p: l.page as number, b: l.box as number[] };
  return undefined;
};

/**
 * Periods whose value is ~1,000× (or 1,000,000×) off its neighbours while the neighbours agree with
 * each other: the table was almost certainly read in the wrong unit (thousands vs millions).
 */
export function scaleOutliers(cells: Record<string, { v: number }>): Set<string> {
  const ends = Object.keys(cells).filter((e) => cells[e].v !== 0).sort();
  const out = new Set<string>();
  for (let i = 0; i < ends.length; i++) {
    const nb = [...ends.slice(Math.max(0, i - 2), i), ...ends.slice(i + 1, i + 3)].map((e) => Math.abs(cells[e].v));
    if (nb.length < 2) continue;
    const lo = Math.min(...nb);
    const hi = Math.max(...nb);
    if (hi / lo > 30) continue; // neighbours disagree among themselves: no baseline
    const med = [...nb].sort((a, b) => a - b)[Math.floor(nb.length / 2)];
    const r = Math.abs(cells[ends[i]].v) / med;
    const lg = Math.log10(r);
    if (Math.abs(lg) >= 2.5 && Math.abs(Math.abs(lg) - 3 * Math.round(Math.abs(lg) / 3)) <= 0.5) out.add(ends[i]);
  }
  return out;
}

export function buildPayload(ticker: string, facts: IrFact[], labelMap?: Record<string, LabelMapEntry>): IrPayload {
  // Second pass without hierarchies whose parts never add up to their total in any period.
  let built = buildIrSeries(facts, { labelMap });
  const unlink = neverTies(built.checks);
  if (unlink.size) built = buildIrSeries(facts, { labelMap, unlink });
  const { series, quarters, years, checks } = built;
  const docIndex = new Map<string, number>();
  const docs: PayloadDoc[] = [];
  const di = (f: IrFact) => {
    const id = f.document_id ?? `${f.accn}/${f.doc}`;
    let i = docIndex.get(id);
    if (i == null) {
      i = docs.length;
      docIndex.set(id, i);
      docs.push({ id, accn: f.accn, doc: f.doc, kind: f.document_kind ?? null, filed: f.filed });
    }
    return i;
  };
  const factCell = (f: IrFact) => ({ d: di(f), l: locOf(f), x: (f.locator as { text?: string }).text, s: f.period_start ?? undefined, e: f.period_end, m: f.months });
  const cellOf = (c: IrCell): PayloadCell => {
    if (c.derived)
      return {
        v: c.v,
        f: {
          formula: c.derived.formula,
          parts: c.derived.parts.map((p) => ({ label: p.label, v: p.value, sign: p.sign, ...factCell(p.fact), e: p.fact.period_end, m: p.fact.months })),
        },
      };
    return c.fact ? { v: c.v, ...factCell(c.fact) } : { v: c.v };
  };

  // Parent keys from the (possibly re-parented) hierarchy.
  const parentOf = new Map<IrSeries, IrSeries>();
  for (const s of series) for (const k of childrenOf(series, s)) if (!parentOf.has(k)) parentOf.set(k, s);
  const kids = new Map<IrSeries, IrSeries[]>();
  for (const [k, p] of parentOf) kids.set(p, [...(kids.get(p) ?? []), k]);

  let scaleFlags = 0;
  const flagged = (cells: Record<string, IrCell>, unit: string) => {
    const bad = unit === "pct" || unit === "ratio" ? new Set<string>() : scaleOutliers(cells);
    scaleFlags += bad.size;
    return Object.fromEntries(Object.entries(cells).map(([e, c]) => [e, bad.has(e) ? { ...cellOf(c), w: "scale" as const } : cellOf(c)]));
  };
  const out: PayloadSeries[] = series
    .filter((s) => Object.keys(s.cells).length || Object.keys(s.annual).length)
    .map((s) => ({
      k: s.key,
      cat: s.category,
      met: s.metric,
      label: s.label,
      parent: parentOf.get(s)?.key ?? null,
      total: s.isTotal,
      unit: s.unit,
      bd: s.breakdown ?? null,
      ...(s.scope ? { sc: s.breakdown ?? s.scope } : {}),
      ...(s.pit ? { pit: true } : {}),
      q: flagged(s.cells, s.unit),
      y: flagged(s.annual, s.unit),
    }));
  const kept = new Set(out.map((s) => s.k));

  // Groups: each root total with its subtree (parts first, total last); loose lines by dimension.
  const groups: PayloadGroup[] = [];
  const placed = new Set<IrSeries>();
  const size = (s: IrSeries): number => 1 + (kids.get(s) ?? []).reduce((n, k) => n + size(k), 0);
  const magnitude = (s: IrSeries) => Math.abs(Object.values(s.cells).at(-1)?.v ?? Object.values(s.annual).at(-1)?.v ?? 0);
  const roots = series.filter((s) => !parentOf.has(s) && kids.has(s)).sort((a, b) => a.category.localeCompare(b.category) || a.metric.localeCompare(b.metric) || size(b) - size(a));
  for (const root of roots) {
    const rows: { k: string; depth: number }[] = [];
    const walk = (s: IrSeries, depth: number) => {
      placed.add(s);
      const ks = (kids.get(s) ?? []).sort((a, b) => magnitude(b) - magnitude(a));
      for (const k of ks) walk(k, depth + 1);
      if (kept.has(s.key)) rows.push({ k: s.key, depth });
    };
    walk(root, 0);
    if (rows.length) groups.push({ id: root.key, cat: root.category, met: root.metric, unit: root.unit, label: root.label, bd: root.breakdown ?? null, root: root.key, rows });
  }
  const loose = new Map<string, IrSeries[]>();
  for (const s of series) {
    if (placed.has(s) || !kept.has(s.key)) continue;
    const id = `${s.category}|${s.metric}|${s.unit}`;
    loose.set(id, [...(loose.get(id) ?? []), s]);
  }
  for (const [id, list] of loose) {
    const s0 = list[0];
    groups.push({ id, cat: s0.category, met: s0.metric, unit: s0.unit, label: "", bd: null, root: null, rows: list.sort((a, b) => magnitude(b) - magnitude(a)).map((s) => ({ k: s.key, depth: 0 })) });
  }

  const pc = (c: ReconcileCheck): PayloadCheck => ({ k: c.totalKey, e: c.period, kind: c.kind, total: c.total, sum: c.sum, ok: c.ok, n: c.children, ...(c.partial ? { partial: true } : {}), ...(c.subtracted ? { sub: c.subtracted } : {}) });
  const allPeriods = out.flatMap((s) => [...Object.keys(s.q), ...Object.keys(s.y)]).sort();
  const q = checks.filter((c) => c.kind === "q");
  const fy = checks.filter((c) => c.kind === "fy");
  return {
    v: 2,
    ticker,
    builtAt: new Date().toISOString(),
    quarters,
    years,
    docs,
    series: out,
    groups,
    checks: checks.map(pc),
    stats: {
      series: out.length,
      groups: groups.length,
      documents: docs.length,
      facts: facts.length,
      firstPeriod: allPeriods[0] ?? null,
      lastPeriod: allPeriods.at(-1) ?? null,
      // Selected-item lists aren't additive by design: report them apart from real tie-out checks.
      checksQ: { ok: q.filter((c) => c.ok).length, total: q.filter((c) => !c.partial).length, partial: q.filter((c) => c.partial).length },
      checksFY: { ok: fy.filter((c) => c.ok).length, total: fy.filter((c) => !c.partial).length, partial: fy.filter((c) => c.partial).length },
      scaleFlags,
      unlinked: unlink.size,
    },
  };
}
