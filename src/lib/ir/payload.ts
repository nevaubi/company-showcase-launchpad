// Compact, precomputed IR series payload stored per company (ir_company_series) and sent to the
// IR data page. Pure: built by the pipeline scripts and by the server after new extractions.
import { isReportedMeasure } from "./reported-scope";
import { isPeriodComparison } from "./comparison-column";
import type { PayloadBudget } from "@/lib/ir/payload-budget";
import { tidyPayload } from "@/lib/ir/tidy";
import {
  buildIrSeries,
  childrenOf,
  neverTies,
  scopeName,
  type IrCell,
  type IrFact,
  type IrSeries,
  type LabelMapEntry,
  type ReconcileCheck,
} from "@/lib/ir/kpis";

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
  sheetCell?: string;
  ixConcept?: string;
  ixId?: string;
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
  sheetCell?: string;
  ixConcept?: string;
  ixId?: string;
  s?: string;
  e?: string;
  m?: number;
  f?: { formula: string; parts: PayloadPart[] };
  /**
   * "scale": about 1,000× off the neighbouring periods (older payloads); "suspect": the figure's unit
   * or period is contradicted by the documents (reason in `why`). `holdSuspects` (suspect.ts) moves
   * such cells out of `q`/`y`/`mo` into `held`, so they are never plotted, summed or compared.
   */
  w?: "scale" | "suspect";
  why?: string;
  /** another document prints a different value for this period (see IrCell.alt) */
  alt?: PayloadAlt;
  /** read-time checks this figure fails (sec-check.ts, consistency.ts): shown at the figure, never applied */
  flags?: PayloadCellFlag[];
  /** set at read time: the figure is the section table's own printing, not the line's shown cell (`rowCells`) */
  own?: boolean;
  /** "printed": read by the build from the stored document's table (table fill), not by a model */
  how?: "printed";
}
/** A failed read-time check at one figure: what failed and the arithmetic, in words. */
export interface PayloadCellFlag {
  /** "sec": differs from the 10-Q/10-K; "year": the quarters don't add up to the year; "formula": a calculated value doesn't match its parts */
  k: "sec" | "year" | "formula";
  why: string;
  /** the other figure (the filing's, the quarters' sum, the formula's result) */
  v?: number;
}
export interface PayloadAlt {
  v: number;
  d?: number;
  l?: PayloadLocator;
  x?: string;
  p?: number;
  sh?: string;
  e?: string;
  m?: number;
  kind: "conflict" | "restated";
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
  /** monthly view only: one-month flows and balances at month-ends that don't close a quarter */
  mo?: Record<string, PayloadCell>;
  /** cells held back as suspect, by period kind: shown with their reason, never used in figures */
  held?: {
    q?: Record<string, PayloadCell>;
    y?: Record<string, PayloadCell>;
    mo?: Record<string, PayloadCell>;
  };
  /** trailing-twelve-month figures of this line taken out of the quarter and year columns (ttm.ts) */
  ttm?: number;
  /**
   * Where the line is printed, shown figure or not: [doc index, table, row] in the newest documents that print
   * it (at most `PRINTED_DOCS`), so a statement section lists every line its table prints, also one whose shown
   * figures cite another printing of the same number. A fourth element, when present, holds what this printing
   * gives that the line shows differently (`PrintedExtra`), so a section shows its own table's printing.
   */
  at?: PayloadAt[];
}

/** One printing's figure where it differs from the shown cell: value (full units), printed column, printed text. */
export type PrintedAt = [number, number, string];
/** What one printing of a line gives that the line shows differently. */
export interface PrintedExtra {
  /** its figures that differ from the shown cells, by "q:<end>" or "y:<end>" */
  v?: Record<string, PrintedAt>;
  /** the name the row is printed under there, when the line shows another ("TOTAL NONINTEREST EXPENSE") */
  n?: string;
}
/**
 * Where a line is printed: [doc index, table, row], with what that printing gives differently (`PrintedExtra`).
 * Payloads built before build format 2 carry the first three only.
 */
export type PayloadAt = [number, number, number] | [number, number, number, PrintedExtra];

/**
 * Version of what the build stores. 2: label-map drops keep printed table figures (kpis.ts `applyLabelMap`)
 * and `series.at` carries each printing's differing figures. 3: table fill (rows the readers left out, read
 * from the stored documents, cells marked `how: "printed"`), the printed row layout (`PayloadTable.rows`),
 * fill conflicts and `stats.quality`. A stored payload with a lower `build` (or none) still lays out, with the
 * rows and figures of its own build: the worker should rebuild it.
 */
export const BUILD_FORMAT = 5;

/** Whether a stored payload predates the current build format (the worker rebuilds such companies first). */
export const needsRebuild = (p: Pick<IrPayload, "build">) => (p.build ?? 1) < BUILD_FORMAT;
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
  /** display title set by `tidyPayload` (tells tables of one subject apart) */
  t?: string;
  /** lead-in every line of this loose list shares ("Aetna — …"), dropped from row labels */
  px?: string;
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
  /**
   * Set at read time: found from the section's own printed rows (statement-checks.ts), not stored by the build.
   * "block": the parts printed under the total; "formula": the lines printed above a result (`f` in words).
   */
  by?: "block" | "formula";
  f?: string;
}
export interface PayloadDoc {
  id: string;
  accn: string | null;
  doc: string | null;
  kind: string | null;
  /** filing date: the facts' own, else the document row's (build format 3) */
  filed: string | null;
  /** "supplement": stored under another kind, the document calls itself a supplement (title or first page) */
  hint?: "supplement";
}
/**
 * What a stored document prints around one of its tables (table-captions.ts), kept for the tables the
 * statement view is laid out from (`statementAnchors`): its printed title and scale line, verbatim, its
 * block headings and its empty spacer rows, by row index.
 */
export interface PayloadTable {
  title?: string;
  unit?: string;
  heads?: [number, string][];
  blank?: number[];
  /**
   * Printed layout of the table's figure and heading rows (build format 3, table-fill.ts): [row, indent level,
   * flags, printed name], level 0 the least indented label of the table, flags 1 bold, 2 a rule above, 4 the
   * row's figures were read from the document by the build; the name is the row's own label cells as printed
   * (a name wrapped over two printed rows joined, footnote marks taken off), for model-read rows too.
   */
  rows?: [number, number, number, string][];
  /**
   * The table's printed figure columns, one per period: [grid column, months (0 for balances), period end,
   * printed head] (table-fill.ts). A table of six- or nine-month columns with no three-month one is a
   * year-to-date table.
   */
  cols?: [number, number, string, string][];
}
/** A stored fact the document prints differently at its own position (kept as stored; shown in the checks). */
export interface PayloadFillConflict {
  d: number;
  t: number;
  r: number;
  c: number;
  /** what the document prints there */
  printed: string;
  /** what the stored fact says it read there */
  stored: string;
  v: number;
}
/**
 * Quality summary of one build (stats.quality), small enough to audit every company with one query over
 * ir_company_series. Field meanings: `qualityOf` in table-fill-build.ts.
 */
export interface IrQuality {
  v: 2;
  /** the rebuild's document plan (doc-plan.ts): documents stored, loaded, left out by reason */
  plan?: { stored: number; loaded: number; left: Partial<Record<string, number>> };
  /** the payload budget (payload-budget.ts) */
  budget?: PayloadBudget;
  sections: number;
  mainSections: number;
  mainDoc: { filed: string | null; kind: string | null } | null;
  rows: {
    printed: number;
    before: number;
    after: number;
    filled: number;
    missing: Partial<Record<string, number>>;
  };
  main: {
    printed: number;
    before: number;
    after: number;
    missing: Partial<Record<string, number>>;
    /** statement tables the main document prints, and those shown as sections */
    tables: { printed: number; shown: number };
    /** filing date and kind of the document these counts are of */
    doc: { filed: string | null; kind: string | null } | null;
  };
  fill: {
    docs: number;
    read: number;
    failed: number;
    tables: number;
    cells: number;
    shownCells: number;
    conflicts: number;
    signs: number;
    moved: number;
    /** stored money figures given their table's printed scale */
    scaled?: number;
    /** documents chosen but left for a later rebuild (history not yet read) */
    waiting?: number;
    /** rebuilds in a row that left documents waiting (the stale lane stops after 8) */
    pass?: number;
    /** documents left unread, and their stored figures left out, because they are pro forma financial information */
    proForma?: number;
    /** documents with no stored table figure left unread because their 8-K reported no results (no Item 2.02) */
    notResults?: number;
    /** when this rebuild ran (ISO time) */
    at?: string;
  };
  dupLabels: number;
  mixedScale: number;
  orphanHeads: number;
  latest: string | null;
  newest: { filed: string; kind: string | null } | null;
  ties: { ok: number; total: number };
}
export interface IrPayload {
  v: 2;
  ticker: string;
  builtAt: string;
  /** A bounded statement view with the precomputed history available separately. */
  preview?: { basis: "latest-filing" | "recent-statements"; archivePath: string };
  quarters: string[];
  years: string[];
  /** month-ends that carry monthly data (see `mo` on each series) */
  months?: string[];
  docs: PayloadDoc[];
  series: PayloadSeries[];
  groups: PayloadGroup[];
  checks: PayloadCheck[];
  stats: IrStats;
  /** `TIDY_VERSION` of the merge pass this payload went through */
  tidy?: number;
  /** retired line key → the line it was merged into (old workbook links still resolve) */
  alias?: Record<string, string>;
  /** printed captions of section tables, by "<doc index>:<table index>" (added by the build after the series) */
  tables?: Record<string, PayloadTable>;
  /** `BUILD_FORMAT` of the build that wrote it (absent before format 2) */
  build?: number;
  /** stored facts the stored document prints differently at their own position (first 200, and the count) */
  fill?: { conflicts: PayloadFillConflict[]; n: number };
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
  /** cells held back as suspect (see suspect.ts) */
  held?: number;
  /** trailing-twelve-month figures left out of the quarter and year columns (ttm.ts) */
  ttm?: number;
  /** shown values that another document prints differently */
  conflicts?: number;
  /** printed totals whose listed lines never add up, shown as plain lines instead of a breakdown */
  unlinked?: number;
  /** tables and lines before the merge pass (same tables split by era or wording, repeats) */
  tidied?: { groupsBefore: number; seriesBefore: number };
  /** `BUILD_FORMAT` of the build, copied here so the worker finds stale payloads from the table alone */
  build?: number;
  /** what the build read and how complete the statements are (build format 3) */
  quality?: IrQuality;
}

const locOf = (f: IrFact): PayloadLocator | undefined => {
  const l = f.locator as Record<string, unknown>;
  if (typeof l.t === "number") return [l.t as number, l.r as number, l.c as number];
  if (typeof l.page === "number" && Array.isArray(l.box))
    return { p: l.page as number, b: l.box as number[] };
  return undefined;
};

/** Documents that print a line (its cells' facts). */
const docsOf = (s: IrSeries) =>
  new Set(
    [...Object.values(s.cells), ...Object.values(s.annual)]
      .map((c) => c.fact?.document_id ?? c.fact?.accn)
      .filter(Boolean),
  );

/**
 * Several lines can carry the label a part names as its parent ("Noninterest income" of one segment
 * and of the whole bank). The part belongs to the one printed in its own table: same breakdown, then a
 * one printed in the same documents, then a printed total; ties keep the first, as before.
 */
export function bestParent(kid: IrSeries, candidates: IrSeries[]): IrSeries {
  const mine = docsOf(kid);
  const score = (p: IrSeries) => {
    let n = 0;
    // Breakdown names drift between releases ("Consolidated Income Statement" / "Income statement"),
    // so they are compared by their scope name; a shared document outranks a printed total.
    if (kid.breakdown && scopeName(p.breakdown) === scopeName(kid.breakdown)) n += 4;
    if (p.isTotal) n += 1;
    for (const d of docsOf(p)) if (mine.has(d)) return n + 2;
    return n;
  };
  return candidates.reduce((best, p) => (score(p) > score(best) ? p : best));
}

/** Documents per line whose printing positions the payload keeps (`PayloadSeries.at`). */
export const PRINTED_DOCS = 2;

export function buildPayload(
  ticker: string,
  facts: IrFact[],
  labelMap?: Record<string, LabelMapEntry>,
): IrPayload {
  // Preserve raw observations. A comparison-column amount cannot be the reported level for a prior quarter.
  facts = facts.filter((f) => isReportedMeasure(f) && !isPeriodComparison((f.locator as { q?: string } | null)?.q, f.label, f.value, f.unit));
  // Second pass without hierarchies whose parts never add up to their total in any period.
  let built = buildIrSeries(facts, { labelMap });
  const unlink = neverTies(built.checks);
  if (unlink.size) built = buildIrSeries(facts, { labelMap, unlink });
  const { series, quarters, years, months, checks } = built;
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
  // A figure read from running text cites its sentence; table and slide figures their printed cell text.
  const factCell = (f: IrFact) => ({
    d: di(f),
    l: locOf(f),
    x: (f.locator as { q?: string; text?: string }).q ?? (f.locator as { text?: string }).text,
    s: f.period_start ?? undefined,
    e: f.period_end,
    m: f.months,
  });
  const altOf = (a: NonNullable<IrCell["alt"]>): PayloadAlt => {
    const { s: _s, ...rest } = factCell(a.fact);
    return { v: a.v, ...rest, kind: a.kind };
  };
  const cellOf = (c: IrCell): PayloadCell => {
    if (c.derived)
      return {
        v: c.v,
        f: {
          formula: c.derived.formula,
          parts: c.derived.parts.map((p) => ({
            label: p.label,
            v: p.value,
            sign: p.sign,
            ...factCell(p.fact),
            e: p.fact.period_end,
            m: p.fact.months,
          })),
        },
      };
    if (!c.fact) return { v: c.v };
    const out: PayloadCell = { v: c.v, ...factCell(c.fact) };
    if (c.fact.method === "printed") out.how = "printed";
    if (c.suspect) Object.assign(out, { w: "suspect" as const, why: c.suspect });
    if (c.alt) out.alt = altOf(c.alt);
    return out;
  };

  // Parent keys from the (possibly re-parented) hierarchy.
  const claims = new Map<IrSeries, IrSeries[]>();
  for (const s of series)
    for (const k of childrenOf(series, s)) claims.set(k, [...(claims.get(k) ?? []), s]);
  const parentOf = new Map<IrSeries, IrSeries>();
  for (const [k, list] of claims) parentOf.set(k, list.length > 1 ? bestParent(k, list) : list[0]);
  const kids = new Map<IrSeries, IrSeries[]>();
  for (const [k, p] of parentOf) kids.set(p, [...(kids.get(p) ?? []), k]);

  // Printing positions in the line's newest documents (by filing date), one per table and row.
  // A printing's own figure for a period, when it differs from the shown cell (another printing of the line
  // wins the shown cell: HON's segment table prints 4,926 where the release summary prints 4,929).
  const differs = (s: IrSeries, f: IrFact): [string, PrintedAt] | null => {
    const kind = f.months === 3 ? "q" : f.months === 12 ? "y" : null;
    if (!kind) return null;
    const shown = (kind === "q" ? s.cells : s.annual)[f.period_end];
    if (!shown || shown.fact === f || shown.v === f.value) return null;
    const l = f.locator as { c?: number; text?: string };
    return [`${kind}:${f.period_end}`, [f.value, l.c ?? 0, l.text ?? ""]];
  };
  const atOf = (s: IrSeries): PayloadAt[] | undefined => {
    if (!s.printed?.length) return undefined;
    const byDoc = new Map<string, IrFact[]>();
    for (const f of s.printed) {
      const id = f.document_id ?? `${f.accn}/${f.doc}`;
      byDoc.set(id, [...(byDoc.get(id) ?? []), f]);
    }
    const newest = [...byDoc.values()]
      .sort((a, b) => (b[0].filed ?? "").localeCompare(a[0].filed ?? ""))
      .slice(0, PRINTED_DOCS);
    const byPos = new Map<
      string,
      { at: [number, number, number]; v: Record<string, PrintedAt>; n?: string }
    >();
    for (const fs of newest)
      for (const f of fs) {
        const l = f.locator as { t: number; r: number };
        const at: [number, number, number] = [di(f), l.t, l.r];
        const id = at.join(":");
        let pos = byPos.get(id);
        if (!pos) {
          const name = f.label
            .replace(/\s*[®™©℠]+/g, "")
            .replace(/\s{2,}/g, " ")
            .trim();
          byPos.set(id, (pos = { at, v: {}, n: name !== s.label ? name : undefined }));
        }
        const d = differs(s, f);
        if (d && !pos.v[d[0]]) pos.v[d[0]] = d[1];
      }
    return [...byPos.values()].map(({ at, v, n }) => {
      const extra: PrintedExtra = {
        ...(Object.keys(v).length ? { v } : {}),
        ...(n ? { n } : {}),
      };
      return Object.keys(extra).length ? ([...at, extra] as PayloadAt) : at;
    });
  };

  // Unit slips and other contradicted figures are held back by `holdSuspects` (suspect.ts) in the tidy pass.
  const cellsMap = (cells: Record<string, IrCell>) =>
    Object.fromEntries(Object.entries(cells).map(([e, c]) => [e, cellOf(c)]));
  const out: PayloadSeries[] = series
    .filter(
      (s) =>
        Object.keys(s.cells).length ||
        Object.keys(s.annual).length ||
        Object.keys(s.monthly ?? {}).length,
    )
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
      q: cellsMap(s.cells),
      y: cellsMap(s.annual),
      ...(s.monthly && Object.keys(s.monthly).length
        ? { mo: Object.fromEntries(Object.entries(s.monthly).map(([e, c]) => [e, cellOf(c)])) }
        : {}),
      ...(atOf(s) ? { at: atOf(s) } : {}),
    }));
  const kept = new Set(out.map((s) => s.k));

  // Groups: each root total with its subtree (parts first, total last); loose lines by dimension.
  const groups: PayloadGroup[] = [];
  const placed = new Set<IrSeries>();
  const size = (s: IrSeries): number => 1 + (kids.get(s) ?? []).reduce((n, k) => n + size(k), 0);
  const magnitude = (s: IrSeries) =>
    Math.abs(Object.values(s.cells).at(-1)?.v ?? Object.values(s.annual).at(-1)?.v ?? 0);
  const roots = series
    .filter((s) => !parentOf.has(s) && kids.has(s))
    .sort(
      (a, b) =>
        a.category.localeCompare(b.category) ||
        a.metric.localeCompare(b.metric) ||
        size(b) - size(a),
    );
  for (const root of roots) {
    const rows: { k: string; depth: number }[] = [];
    const walk = (s: IrSeries, depth: number) => {
      placed.add(s);
      const ks = (kids.get(s) ?? []).sort((a, b) => magnitude(b) - magnitude(a));
      for (const k of ks) walk(k, depth + 1);
      if (kept.has(s.key)) rows.push({ k: s.key, depth });
    };
    walk(root, 0);
    if (rows.length)
      groups.push({
        id: root.key,
        cat: root.category,
        met: root.metric,
        unit: root.unit,
        label: root.label,
        bd: root.breakdown ?? null,
        root: root.key,
        rows,
      });
  }
  const loose = new Map<string, IrSeries[]>();
  for (const s of series) {
    if (placed.has(s) || !kept.has(s.key)) continue;
    const id = `${s.category}|${s.metric}|${s.unit}`;
    loose.set(id, [...(loose.get(id) ?? []), s]);
  }
  for (const [id, list] of loose) {
    const s0 = list[0];
    groups.push({
      id,
      cat: s0.category,
      met: s0.metric,
      unit: s0.unit,
      label: "",
      bd: null,
      root: null,
      rows: list.sort((a, b) => magnitude(b) - magnitude(a)).map((s) => ({ k: s.key, depth: 0 })),
    });
  }

  const pc = (c: ReconcileCheck): PayloadCheck => ({
    k: c.totalKey,
    e: c.period,
    kind: c.kind,
    total: c.total,
    sum: c.sum,
    ok: c.ok,
    n: c.children,
    ...(c.partial ? { partial: true } : {}),
    ...(c.subtracted ? { sub: c.subtracted } : {}),
  });
  const allPeriods = out
    .flatMap((s) => [...Object.keys(s.q), ...Object.keys(s.y), ...Object.keys(s.mo ?? {})])
    .sort();
  const q = checks.filter((c) => c.kind === "q");
  const fy = checks.filter((c) => c.kind === "fy");
  return tidyPayload({
    v: 2,
    ticker,
    build: BUILD_FORMAT,
    builtAt: new Date().toISOString(),
    quarters,
    years,
    ...(months.length ? { months } : {}),
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
      checksQ: {
        ok: q.filter((c) => c.ok).length,
        total: q.filter((c) => !c.partial).length,
        partial: q.filter((c) => c.partial).length,
      },
      checksFY: {
        ok: fy.filter((c) => c.ok).length,
        total: fy.filter((c) => !c.partial).length,
        partial: fy.filter((c) => c.partial).length,
      },
      unlinked: unlink.size,
      build: BUILD_FORMAT,
    },
  });
}
