// Compact, precomputed IR series payload stored per company (ir_company_series) and sent to the
// IR data page. Pure: built by the pipeline scripts and by the server after new extractions.
import { buildIrSeries, childrenOf, type IrCell, type IrFact, type IrSeries, type LabelMapEntry, type ReconcileCheck } from "@/lib/ir/kpis";

export type PayloadLocator = [number, number, number] | { p: number; b: number[] };

export interface PayloadPart {
  label: string;
  v: number;
  sign: 1 | -1;
  d?: number;
  l?: PayloadLocator;
  x?: string;
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
  s?: string;
  e?: string;
  m?: number;
  f?: { formula: string; parts: PayloadPart[] };
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
  checksQ: { ok: number; total: number };
  checksFY: { ok: number; total: number };
}

const locOf = (f: IrFact): PayloadLocator | undefined => {
  const l = f.locator as Record<string, unknown>;
  if (typeof l.t === "number") return [l.t as number, l.r as number, l.c as number];
  if (typeof l.page === "number" && Array.isArray(l.box)) return { p: l.page as number, b: l.box as number[] };
  return undefined;
};

export function buildPayload(ticker: string, facts: IrFact[], labelMap?: Record<string, LabelMapEntry>): IrPayload {
  const { series, quarters, years, checks } = buildIrSeries(facts, { labelMap });
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
      ...(s.pit ? { pit: true } : {}),
      q: Object.fromEntries(Object.entries(s.cells).map(([e, c]) => [e, cellOf(c)])),
      y: Object.fromEntries(Object.entries(s.annual).map(([e, c]) => [e, cellOf(c)])),
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

  const pc = (c: ReconcileCheck): PayloadCheck => ({ k: c.totalKey, e: c.period, kind: c.kind, total: c.total, sum: c.sum, ok: c.ok, n: c.children });
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
      checksQ: { ok: q.filter((c) => c.ok).length, total: q.length },
      checksFY: { ok: fy.filter((c) => c.ok).length, total: fy.length },
    },
  };
}
