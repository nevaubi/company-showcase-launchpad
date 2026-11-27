// Pure: statement-shaped sections of an IR payload, laid out as the company's documents print them.
//
// Every table or slide figure keeps where it was printed (`d`: the document, `l`: table, row and column).
// A section is one printed table of the newest document that prints it, in the document's own order;
// the same table in older documents (matched by the lines they share, which the series build already
// links across documents) is stitched onto it, so one section carries the whole history of its lines.
// Rows follow the printed row order, children are indented under the total they add up to, totals are
// marked, and the document's own headings and spacer rows are kept where the build stored them
// (`payload.tables`). A section holds exactly the rows its anchor table prints, in printed order: a line of
// an older copy joins only as the history of a row the anchor prints (the same printed row, or the same name,
// unit and total in the same printed scale with no figure in conflict); lines only other copies print (an older
// supplement, the release's version of the table) are listed apart in the "more" group ("lines only other
// copies print"), and a figure printed at another scale never fills a row.
import { CATEGORY_LABEL, METRIC_LABEL, shownLabel } from "@/lib/ir/display";
import type { IrPayload, PayloadCell, PayloadCheck, PayloadSeries, PayloadTable, PrintedAt, PrintedExtra } from "@/lib/ir/payload";
import { cellsFor, heldFor, type IrPeriodKind } from "@/lib/ir/periods";
import { parseNumber } from "@/lib/ir/tables";
import { capitalWords, sentenceCase, type TableCaption } from "@/lib/ir/table-captions";
import { shapeRows } from "@/lib/ir/statement-tree";
import { basisOf } from "@/lib/ir/kpis";
import { FILTER_OF, sectionKind, sectorOf, type SectionKind } from "@/lib/ir/sector-order";

export type StatementRow =
  /** `k` is the line shown; `ks` every line printed in this row (the same printed cell, or the same name under the
   *  same total with no figure in conflict: one line under two stored identities), `k` first; `at` the row's
   *  printing in the anchor table [doc, table, row], whose own figures the row shows (`rowCells`) */
  | {
      kind: "line";
      k: string;
      ks: string[];
      depth: number;
      total: boolean;
      at?: [number, number, number];
      /** the first printed line of a label the table wraps over two rows ("Federal funds purchased and
       *  securities loaned or" over "sold under repurchase agreements"), read before the row's own name */
      wrap?: string;
      /** a part the total that closes its block got back from the table (it lost that total in the build) */
      sib?: boolean;
      /** index in the section's rows of the row it is printed as a part of (`shapeRows`) */
      up?: number;
      /** what tells this line from the other lines printed on the same row (column groups: "Operating
       *  income", "margin"), shown after the printed name */
      twin?: string;
      /** a line only older documents' copies of the table print, listed after the table's own rows */
      old?: true;
      /** the name the anchor table prints the row under (`PayloadTable.rows`, build format 3) */
      name?: string;
      /** printed in bold, and with a rule above it, as the anchor table marks the row */
      bold?: boolean;
      rule?: "single";
      /** the heading printed over it, when its stored name repeats that heading ("Cloud Memory Business Unit:
       *  Revenue" under "Cloud Memory Business Unit"): the row reads "Revenue" */
      under?: string;
    }
  | {
      kind: "head";
      text: string;
      depth: number;
      /** its printed row in the anchor table */
      r?: number;
      bold?: boolean;
    }
  | { kind: "gap" };

/**
 * Where a section stands on the page (`arrange`): "main", the tables of the company's newest statement document
 * (supplement, else earnings release) in its own order; "other", tables only other documents of the same
 * release print (release tables, presentation slides), and one compact section of the small fragments of
 * both; "more", tables of older documents and lines only other copies of a table print, in a collapsed group.
 */
export type StatementGroup = "main" | "other" | "more";

export interface Statement {
  /** "<doc index>:<table>" of the table it is laid out from ("12:3", or "12:p4" for a slide page) */
  id: string;
  title: string;
  /** where the title comes from: the document's printed title, the stored table name, the line category, or
   *  "merged" for the compact section of small tables (each part under its own title as a heading) */
  titleFrom: "printed" | "breakdown" | "category" | "merged";
  group: StatementGroup;
  /** the kind of document it comes from, for sections outside the main document ("earnings release") */
  source?: string;
  /** the printed scale line ("In millions, except per share data"), else one stated from the figures; "" when no money line */
  unitLine: string;
  /** divisor that turns a money figure into the section's printed scale (1e6 for "in millions") */
  div: number;
  rows: StatementRow[];
  /** line keys in row order */
  keys: string[];
  /** documents whose copies of this table were stitched together */
  docs: number;
  /** the documents whose copies of this table were stitched together (indexes into payload.docs) */
  copies?: number[];
  /** newest and oldest period end any of its lines carries */
  last: string;
  first: string;
  /** most common line category (for the category filter) */
  cat: string;
  /** the newest document that prints it, index into payload.docs */
  doc: number;
  /** what kind of statement it is for the company's sector, and the tab filter it belongs to (sector-order.ts) */
  kind?: SectionKind;
  filter?: "revenue" | "profit" | "cost" | "kpi" | "balance";
  /**
   * "ytd" when the anchor table prints year-to-date columns (six or nine months) and no three-month column: the
   * section's figures are `series.ytd` cells under their printed length and end, never quarter heads
   * (`ytdBasis`). Quarters in `q` derived from two of them stay calculated, with their formula.
   */
  basis?: "ytd";
}

/** Year-to-date figures as printed (build format 6): "<months>:<period end>" → cell. Read optionally. */
type YtdCells = { ytd?: Record<string, PayloadCell> };
/** Printed figure columns of a table (build format 6): [grid column, months (0 balances), end, printed head]. */
type PrintedCols = { cols?: [number, number, string, string][] };

interface Table {
  id: string;
  d: number;
  t: string;
  /** line key → printed row (first printing within the table) */
  rows: Map<string, number>;
  /** further printings of a line in the same table (a total that closes two blocks), as [key, row] */
  again: [string, number][];
  /** "<key>|<row>" → the period ends whose shown or held figure this printing gives */
  ends: Map<string, Set<string>>;
  /** "<key>|<row>" → the first printed column of the line on that row */
  col: Map<string, number>;
}

/** A slot of a section: a line key, or "<key>\u0001<row>" for a line printed again further down the same table. */
const REPEAT = "\u0001";
export const slotKey = (slot: string) => slot.split(REPEAT)[0];

const isTableLoc = (l: PayloadCell["l"]): l is [number, number, number] => Array.isArray(l);

/** Where a cell was printed: "<doc>:<table>" and its row, or a slide page and the mark's height on it. */
function placeOf(c: {
  d?: number;
  l?: PayloadCell["l"];
}): { id: string; d: number; t: string; r: number } | null {
  if (c.d == null || !c.l) return null;
  if (isTableLoc(c.l)) return { id: `${c.d}:${c.l[0]}`, d: c.d, t: String(c.l[0]), r: c.l[1] };
  if (typeof c.l.p === "number")
    return {
      id: `${c.d}:p${c.l.p}`,
      d: c.d,
      t: `p${c.l.p}`,
      r: Math.round((c.l.b?.[1] ?? 0) * 1000),
    };
  return null;
}

function* endsOf(s: PayloadSeries): Generator<[string, PayloadCell]> {
  for (const [kind, m] of [
    ["q", s.q],
    ["y", s.y],
    ["m", s.mo ?? {}],
    ["q", s.held?.q ?? {}],
    ["y", s.held?.y ?? {}],
    ["m", s.held?.mo ?? {}],
    ["ytd", (s as YtdCells).ytd ?? {}],
  ] as const)
    for (const [e, c] of Object.entries(m)) yield [`${kind}:${e}`, c];
}

function* cellsOf(s: PayloadSeries): Generator<PayloadCell> {
  for (const m of [s.q, s.y, s.mo ?? {}, s.held?.q ?? {}, s.held?.y ?? {}, s.held?.mo ?? {}, (s as YtdCells).ytd ?? {}])
    for (const c of Object.values(m)) yield c;
}

/** Every printed table of the payload with the lines it prints (from shown, held and alternative printings). */
function tablesOf(p: IrPayload): Table[] {
  const by = new Map<string, Table>();
  const add = (k: string, c: { d?: number; l?: PayloadCell["l"]; e?: string }, end?: string) => {
    const at = placeOf(c);
    if (!at) return;
    let t = by.get(at.id);
    if (!t) by.set(at.id, (t = { id: at.id, d: at.d, t: at.t, rows: new Map(), again: [], ends: new Map(), col: new Map() }));
    if (end) {
      const id = `${k}|${at.r}`;
      t.ends.set(id, (t.ends.get(id) ?? new Set()).add(end));
    }
    if (end && isTableLoc(c.l)) {
      const id = `${k}|${at.r}`;
      const c0 = t.col.get(id);
      if (c0 == null || c.l[2] < c0) t.col.set(id, c.l[2]);
    }
    const r0 = t.rows.get(k);
    if (r0 == null) t.rows.set(k, at.r);
    else if (at.r !== r0 && !t.again.some(([k2, r2]) => k2 === k && r2 === at.r)) {
      if (at.r < r0) {
        t.again.push([k, r0]);
        t.rows.set(k, at.r);
      } else t.again.push([k, at.r]);
    }
  };
  for (const s of p.series) {
    for (const [end, c] of endsOf(s)) {
      add(s.k, c, end);
      if (c.alt) add(s.k, c.alt);
    }
    for (const [d, t, r] of s.at ?? []) add(s.k, { d, l: [t, r, 0] });
  }
  return [...by.values()];
}

const tNum = (t: string) => (t.startsWith("p") ? 10_000 + Number(t.slice(1)) : Number(t));

/** Documents from the newest (by filing date, then the one printing the most lines), as a rank per index. */
function docRank(p: IrPayload, tables: Table[]): Map<number, number> {
  const lines = new Map<number, number>();
  for (const t of tables) lines.set(t.d, (lines.get(t.d) ?? 0) + t.rows.size);
  const ds = [...lines.keys()].sort(
    (a, b) =>
      (p.docs[b]?.filed ?? "").localeCompare(p.docs[a]?.filed ?? "") ||
      (lines.get(b) ?? 0) - (lines.get(a) ?? 0) ||
      b - a,
  );
  return new Map(ds.map((d, i) => [d, i]));
}

interface Draft {
  anchor: Table;
  order: string[];
  set: Set<string>;
  docs: Set<number>;
  /** line key → printed rows ("<doc>:<table>:<row>") in the stitched copies */
  places: Map<string, Set<string>>;
  /** slot → its printed row in the anchor table */
  slotR: Map<string, number>;
  /** lines only other copies print, in the order met: history of an anchor row, or listed apart */
  extra: string[];
  extraSet: Set<string>;
}

/** Minimum share of a table's lines another copy must share to be the same table (and at least two lines). */
export const STITCH_SHARE = 0.4;

/**
 * Sections before rows are laid out: the newest document's tables in printed order, older copies stitched on.
 * Exported for the build, which stores the printed captions of exactly these anchor tables.
 */
function drafts(p: IrPayload): Draft[] {
  const tables = tablesOf(p);
  const rank = docRank(p, tables);
  tables.sort((a, b) => (rank.get(a.d) ?? 0) - (rank.get(b.d) ?? 0) || tNum(a.t) - tNum(b.t));
  const out: Draft[] = [];
  const index = new Map<string, Draft[]>();
  // Lines by printed name and measure too: the reader keys one printed row differently from one release to
  // the next (Coca-Cola's segment revenue under "Revenue by operating segment" and "Net operating revenue"),
  // so an older copy of a table is found by its names as well as by its keys.
  const byKey0 = new Map(p.series.map((x) => [x.k, x]));
  const nameKey = (k: string) => {
    const x = byKey0.get(k);
    return x ? `${x.unit}|${x.met}|${nameCore(lineLabel(x))}` : k;
  };
  const byName = new Map<string, Draft[]>();
  for (const t of tables) {
    // Printed order; lines printed on one row (a row of several column groups) in column order.
    // A line whose figure here was stored under another identity takes its column from the same row of another
    // table of the document (Intel's "Total Intel Products" revenue, stored from the prior-year matrix).
    const colOf = (k: string, r: number) =>
      t.col.get(`${k}|${r}`) ?? tables.find((o) => o !== t && o.d === t.d && o.col.has(`${k}|${r}`))?.col.get(`${k}|${r}`) ?? 0;
    const rows = [...t.rows.entries()].sort((a, b) => a[1] - b[1] || colOf(a[0], a[1]) - colOf(b[0], b[1])).map(([k]) => k);
    // The section sharing most lines with this table, among those with no copy from this document yet.
    const shared = new Map<Draft, number>();
    // A second table of one document joins a section only as the same table printed for other periods
    // (Intel prints its segment matrix once for this quarter and once for last year's).
    const otherPeriods = (s: Draft) => {
      let known = 0;
      for (const k of rows) {
        const a = s.anchor.rows.get(k);
        if (a == null) continue;
        const mine = t.ends.get(`${k}|${t.rows.get(k)}`);
        const theirs = s.anchor.ends.get(`${k}|${a}`);
        if (!mine?.size || !theirs?.size) continue;
        if ([...mine].some((e) => theirs.has(e))) return false;
        // A year-to-date table is not the quarter or year table printed again (Coca-Cola's statement of income
        // for the quarter and for the nine months); quarters and fiscal years of one table do join (Cisco).
        const lengths = (xs: Set<string>) =>
          [...new Set([...xs].map((e) => (e.startsWith("ytd:") ? e.slice(0, e.lastIndexOf(":")) : "")))].sort().join();
        if (lengths(mine) !== lengths(theirs)) return false;
        known++;
      }
      return known >= 2;
    };
    for (const k of rows) {
      const met = new Set<Draft>();
      for (const s of [...(index.get(k) ?? []), ...(byName.get(nameKey(k)) ?? [])]) {
        if (met.has(s)) continue;
        met.add(s);
        if (!s.docs.has(t.d) || (s.anchor.d === t.d && otherPeriods(s))) shared.set(s, (shared.get(s) ?? 0) + 1);
      }
    }
    let best: Draft | null = null;
    let n = 0;
    for (const [s, c] of shared)
      if (c > n) {
        best = s;
        n = c;
      }
    const need = Math.max(
      rows.length === 1 ? 1 : 2,
      Math.ceil(STITCH_SHARE * Math.min(rows.length, best?.anchor.rows.size ?? rows.length)),
    );
    if (!best || n < need) {
      best = {
        anchor: t,
        order: [],
        set: new Set(),
        docs: new Set(),
        places: new Map(),
        slotR: new Map(t.rows),
        extra: [],
        extraSet: new Set(),
      };
      out.push(best);
    }
    const isAnchor = best.anchor === t;
    best.docs.add(t.d);
    for (const [k, r] of t.rows) {
      const at = best.places.get(k) ?? new Set<string>();
      at.add(`${t.id}:${r}`);
      best.places.set(k, at);
    }
    // The anchor's lines in printed order; an older copy's other lines are only candidates (`extra`): they
    // join a row as its history, or are listed apart, never placed among the anchor's rows.
    for (const k of rows) {
      if (best.set.has(k) || best.extraSet.has(k)) continue;
      if (isAnchor) {
        best.order.push(k);
        best.set.add(k);
      } else {
        best.extra.push(k);
        best.extraSet.add(k);
      }
      index.set(k, [...(index.get(k) ?? []), best]);
      if (isAnchor) byName.set(nameKey(k), [...(byName.get(nameKey(k)) ?? []), best]);
    }
    // The anchor's second printings of a line, at their own place in its row order.
    if (isAnchor)
      for (const [k, r] of [...t.again].sort((a, b) => a[1] - b[1])) {
        const slot = `${k}${REPEAT}${r}`;
        // One row per printed row: another line already standing for this row keeps it.
        if ([...best.slotR.entries()].some(([x, rx]) => rx === r && best!.order.includes(x)))
          continue;
        // A printing that gives only periods the first printing does not is the same row's history, printed
        // in another block of a matrix table (Coca-Cola's prior-year "Reported (GAAP)" row of segment columns).
        const mine = t.ends.get(`${k}|${r}`);
        const first = t.ends.get(`${k}|${t.rows.get(k)}`);
        if (mine?.size && first?.size && ![...mine].some((e) => first.has(e))) continue;
        let after = -1;
        best.order.forEach((x, i) => {
          const rx = best!.slotR.get(x);
          if (rx != null && rx < r) after = i;
        });
        best.order.splice(after + 1, 0, slot);
        best.slotR.set(slot, r);
      }
  }
  return out;
}

/** The anchor tables of the statement sections ("<doc>:<table>"), newest document first: what the build captions. */
export function statementAnchors(p: IrPayload): { d: number; t: number }[] {
  return drafts(p)
    .map((s) => s.anchor)
    .filter((a) => !a.t.startsWith("p"))
    .map((a) => ({ d: a.d, t: Number(a.t) }));
}

/** Power of 1,000 a printed money figure was multiplied by (1, 1e3, 1e6, 1e9), from value ÷ printed number. */
export function printedDiv(c: { v: number; x?: string }): number | null {
  if (!c.x) return null;
  const n = parseNumber(c.x);
  if (n == null || n === 0 || c.v === 0) return null;
  const r = Math.abs(c.v / n);
  for (const d of [1, 1e3, 1e6, 1e9]) if (Math.abs(r / d - 1) < 0.02) return d;
  return null;
}

const mode = <T>(xs: T[]): T | undefined => {
  const n = new Map<T, number>();
  let best: T | undefined;
  let c = 0;
  for (const x of xs) {
    const k = (n.get(x) ?? 0) + 1;
    n.set(x, k);
    if (k > c) {
      best = x;
      c = k;
    }
  }
  return best;
};

const SCALE_WORD: Record<number, string> = {
  1: "",
  1e3: "in thousands",
  1e6: "in millions",
  1e9: "in billions",
};

/** Divisor a line's figures were printed at, by the cells' own printed text (money and counts only). */
export function lineDiv(s: PayloadSeries): number {
  if (s.unit !== "usd" && s.unit !== "count") return 1;
  const ds: number[] = [];
  for (const c of cellsOf(s)) {
    const d = printedDiv(c);
    if (d != null) ds.push(d);
  }
  return mode(ds) ?? 1;
}

/** The latest period end any cell of a line carries. */
export function lastEnd(s: PayloadSeries): string {
  let m = "";
  for (const c of cellsOf(s)) if (c.e && c.e > m) m = c.e;
  for (const e of [...Object.keys(s.q), ...Object.keys(s.y), ...Object.keys(s.mo ?? {})])
    if (e > m) m = e;
  return m;
}

function firstEnd(s: PayloadSeries): string {
  let m = "9999";
  for (const e of [...Object.keys(s.q), ...Object.keys(s.y), ...Object.keys(s.mo ?? {})])
    if (e < m) m = e;
  return m;
}

const norm = (x: string | undefined) =>
  (x ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, " ")
    .trim();

/** The scale a money or count line is printed at, from its cells' printed text; null when no cell tells. */
export function knownDiv(s: PayloadSeries): number | null {
  if (s.unit !== "usd" && s.unit !== "count") return null;
  const ds: number[] = [];
  for (const c of cellsOf(s)) {
    const d = printedDiv(c);
    if (d != null) ds.push(d);
  }
  return mode(ds) ?? null;
}

/** Two lines printed at different scales (millions and billions) are never one row. */
function sameScale(a: PayloadSeries, b: PayloadSeries) {
  const da = knownDiv(a);
  const db = knownDiv(b);
  return da == null || db == null || da === db;
}

/** Two lines print the same figure (within 0.5 percent) for at least one common period. */
function sharesFigure(a: PayloadSeries, b: PayloadSeries) {
  for (const [x, y] of [
    [a.q, b.q],
    [a.y, b.y],
  ] as const)
    for (const [e, c] of Object.entries(x)) {
      const o = y[e];
      if (o && c.v !== 0 && Math.abs(o.v - c.v) <= 0.005 * Math.max(Math.abs(o.v), Math.abs(c.v))) return true;
    }
  return false;
}

/** Two lines never print different figures for the same period (within 0.5 percent). */
function agree(a: PayloadSeries, b: PayloadSeries) {
  if (!sameScale(a, b)) return false;
  for (const [x, y] of [
    [a.q, b.q],
    [a.y, b.y],
  ] as const)
    for (const [e, c] of Object.entries(x)) {
      const o = y[e];
      if (o && Math.abs(o.v - c.v) > 0.005 * Math.max(Math.abs(o.v), Math.abs(c.v))) return false;
    }
  return true;
}

/**
 * Lines of one section that are one printed row: the same printed row in a stitched copy, or the same
 * name under the same total, in the same unit, with no period where their figures differ. Groups keep the
 * section order; the first line of a group (printed in the newest copy) is the one shown.
 */
/** A printed name without footnote marks ("(a)", "(1)", "*", "†") and a closing colon, normalised. */
export const nameCore = (x: string) =>
  norm(x.replace(/\s*(?:\((?:[a-z]|\d{1,2})\)|[*†‡]+)(?=\s|$|:)/g, "").replace(/:\s*$/, ""));

/**
 * Two lines carry the same printed name: equal up to footnote marks and case, or one is the other under its
 * block's name ("Stock-based compensation expense: cost of revenue" for "Cost of revenue" under "Total
 * stock-based compensation expense", as Broadcom's older releases were stored).
 */
export function sameName(a: PayloadSeries, b: PayloadSeries, byKey: Map<string, PayloadSeries>): boolean {
  const na = nameCore(lineLabel(a));
  const nb = nameCore(lineLabel(b));
  if (na === nb) return true;
  const [long, short] = na.length > nb.length ? [na, nb] : [nb, na];
  if (!short) return false;
  // One is the other followed by the measure its table is named after: Intel's matrix stores "CCPG — Revenue"
  // in one release and "CCPG" in "Revenue by segment" in the next (same metric and unit, checked by callers).
  if (long.startsWith(`${short} `)) {
    const tail = long.slice(short.length + 1).trim();
    const shortLine = na.length > nb.length ? b : a;
    const bd = shortLine.bd ? nameCore(shortLine.bd) : "";
    if (tail && a.met === b.met && (bd === tail || bd.startsWith(`${tail} `))) return true;
  }
  if (!long.endsWith(` ${short}`)) return false;
  const head = long.slice(0, long.length - short.length - 1).trim();
  const blocks = [a, b].flatMap((s) => {
    const par = s.parent ? byKey.get(s.parent) : undefined;
    return [par ? nameCore(lineLabel(par)).replace(/^total /, "") : "", s.bd ? nameCore(s.bd) : ""];
  });
  return blocks.some((x) => x && x === head);
}

/** "<doc>:<table>:<row>" without its document: the table and row number a copy prints a line at. */
const rowOfPlace = (x: string) => x.slice(x.indexOf(":") + 1);

export function sameRows(
  keys: string[],
  byKey: Map<string, PayloadSeries>,
  places: Map<string, Set<string>>,
  extraKeys: Iterable<string> = [],
): string[][] {
  const extra = new Set(extraKeys);
  const groups: { ks: string[]; at: Set<string> }[] = [];
  const pl = (s: PayloadSeries) => {
    const par = s.parent ? byKey.get(s.parent) : undefined;
    return norm(par ? lineLabel(par) : "");
  };
  // The same name, unit and role, under the same total; or in the same named table when one lost its total.
  const same = (a: PayloadSeries, b: PayloadSeries) =>
    sameName(a, b, byKey) &&
    a.unit === b.unit &&
    !!a.total === !!b.total &&
    (pl(a) === pl(b) || ((!a.parent || !b.parent) && !!a.bd && norm(a.bd) === norm(b.bd ?? "")));
  const docsIn = (at: Set<string>) => new Set([...at].map((x) => x.split(":")[0]));
  for (const k of keys) {
    const s = byKey.get(k)!;
    const at = places.get(k) ?? new Set<string>();
    const mine = docsIn(at);
    const hit =
      groups.find(
        (g) =>
          [...at].some((x) => g.at.has(x)) &&
          g.ks.every((o) => {
            const b = byKey.get(o)!;
            // One printed row is one measure: never a cost line and a revenue line that share a slide's height.
            // A matrix row prints several measures under one name: a position join needs the same measure
            // (a filled printed row, category "statement", carries none of its own).
            return (
              agree(b, s) &&
              b.unit === s.unit &&
              (b.met === s.met || ((b.cat === "statement" || s.cat === "statement") && sameName(b, s, byKey)))
            );
          }),
      ) ??
      // By name only across documents: two rows of one document are two printed rows.
      groups.find(
        (g) =>
          same(byKey.get(g.ks[0])!, s) &&
          ![...docsIn(g.at)].some((d) => mine.has(d)) &&
          g.ks.every((o) => agree(byKey.get(o)!, s)),
      ) ??
      // The same printed row (table and row number) of another document's copy, under the same name: one
      // line even when the two copies name its total differently ("Total net income" / "NET INCOME").
      groups.find((g) => {
        const o = byKey.get(g.ks[0])!;
        return (
          sameName(o, s, byKey) &&
          o.unit === s.unit &&
          !!o.total === !!s.total &&
          (o.met === s.met || o.cat === "statement" || s.cat === "statement") &&
          ![...docsIn(g.at)].some((d) => mine.has(d)) &&
          [...at].some((x) => [...g.at].some((y) => rowOfPlace(x) === rowOfPlace(y))) &&
          g.ks.every((k) => agree(byKey.get(k)!, s))
        );
      }) ??
      // A line only other copies print that prints the same figure as a row in a common period, under the same
      // name and measure, with no figure in conflict, is that row's history, whatever table index or table name
      // the older copies carry (DELL's operating income and net income across releases; filled printed rows
      // and the reader's lines keyed apart).
      (extra.has(k)
        ? groups.find((g) => {
            const o = byKey.get(g.ks[0])!;
            return (
              !extra.has(g.ks[0]) &&
              sameName(o, s, byKey) &&
              o.unit === s.unit &&
              (o.met === s.met || o.cat === "statement" || s.cat === "statement") &&
              g.ks.every((k2) => agree(byKey.get(k2)!, s)) &&
              g.ks.some((k2) => sharesFigure(byKey.get(k2)!, s))
            );
          })
        : undefined);
    if (hit) {
      hit.ks.push(k);
      for (const x of at) hit.at.add(x);
    } else groups.push({ ks: [k], at: new Set(at) });
  }
  return groups.map((g) => g.ks);
}

/**
 * A total the document prints under its parts but whose stored figures cite another printing of it (the
 * build keeps one copy per table it closes: "Total noninterest expense" closes both the income statement and
 * the segment table) joins the section after the last of its parts, when at least two of them are here.
 */
function closeTotals(dr: Draft, byKey: Map<string, PayloadSeries>) {
  for (let pass = 0; pass < 3; pass++) {
    const kids = new Map<string, string[]>();
    for (const k of dr.order) {
      const par = byKey.get(slotKey(k))?.parent;
      if (par && !dr.set.has(par) && byKey.has(par)) kids.set(par, [...(kids.get(par) ?? []), k]);
    }
    if (!kids.size) return;
    for (const [par, ks] of kids) {
      if (ks.length < 2) continue;
      const at = Math.max(...ks.map((k) => dr.order.indexOf(k)));
      dr.order.splice(at + 1, 0, par);
      dr.set.add(par);
    }
  }
}

/** A line's name as a statement row prints it: the build's "second breakdown" copy of a total is that total. */
export function lineLabel(s: PayloadSeries): string {
  return shownLabel(s.label.replace(/:\s*second breakdown$/i, ""));
}

/**
 * A row's name: the name its table prints it under (`series.at`, when the line is shown under another name
 * after merging), else the line's name.
 */
export function rowLabel(
  r: { k: string; ks: string[]; at?: [number, number, number]; wrap?: string; twin?: string; under?: string },
  byKey: Map<string, PayloadSeries>,
): string {
  let own = printedName(r, byKey);
  if (r.under) {
    const u = nameCore(r.under);
    const i = own.indexOf(":");
    if (i > 0 && nameCore(own.slice(0, i)) === u && own.slice(i + 1).trim()) {
      const rest = own.slice(i + 1).trim();
      own = rest.charAt(0).toUpperCase() + rest.slice(1);
    }
  }
  const name = r.twin ? `${own}: ${r.twin}` : own;
  if (!r.wrap || norm(name).startsWith(norm(r.wrap))) return name;
  return `${r.wrap} ${/^[A-Z][a-z]/.test(name) && !/^[A-Z][a-z]+\s+[A-Z]/.test(name) ? name[0].toLowerCase() + name.slice(1) : name}`;
}

/** A row of column heads only ("Amount ($ billions) Year/Year Growth (%)"): its words are measure and change heads. */
const COLUMN_HEAD = {
  test: (x: string) => {
    const words = x
      .replace(/\([^)]*\)/g, " ")
      .toLowerCase()
      .split(/[\s/]+/)
      .filter(Boolean);
    return words.length > 0 && words.every((w) => /^(amount|margin|growth|change|year|quarter|y|q|yoy|qoq|%|percent|basis|points|bps|reported|actual|gaap|non-gaap)$/.test(w));
  },
};
const MONTH_YEAR = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+(19|20)\d{2}\b/i;

/** The printed layout irtables' build format 3 adds to a section table (`PayloadTable.rows`): [row, indent
 *  level, flags (1 bold, 2 rule above, 4 filled by the build), printed name]. Read optionally, so older payloads lay out as before. */
type PrintedLayout = { rows?: [number, number, number, string][] };

/**
 * Indent levels as the table prints them (build format 3), where the table prints at least two levels among
 * the section's lines: each row's depth is its printed level above the least indented line's; headings too.
 * Tables printed flush (JPM's statements, which mark totals by type and rules only) keep the levels of the
 * stored hierarchy (`shapeRows`).
 */
function printedLevels(rows: StatementRow[], printed: Map<number, { l: number; f: number; n: string }>) {
  const lev = (r: StatementRow) =>
    r.kind === "line" && r.at ? printed.get(r.at[2])?.l : r.kind === "head" && r.r != null ? printed.get(r.r)?.l : undefined;
  const lines = rows.filter((r) => r.kind === "line");
  const known = lines.map(lev).filter((x): x is number => x != null);
  if (known.length < Math.max(2, lines.length * 0.6) || new Set(known).size < 2) return;
  // A table that indents its totals past their parts (JPM prints "Noninterest revenue" and "TOTAL NET REVENUE"
  // to the right of the lines they close) marks totals by indent, not hierarchy: keep the stored levels.
  for (const r of rows) {
    if (r.kind !== "line" || r.up == null) continue;
    const a = lev(r);
    const b = lev(rows[r.up]);
    if (a != null && b != null && b > a) return;
  }
  const min = Math.min(...known);
  for (const r of rows) {
    if (r.kind === "gap") continue;
    const l = lev(r);
    if (l != null) r.depth = Math.max(0, l - min);
  }
}

/** What a line measures, in words, for telling lines printed on one row apart. */
function measureWord(s: PayloadSeries): string {
  if (s.unit === "pct") return s.met === "margin" || /margin/i.test(s.label) ? "margin" : "percent";
  if (s.unit === "usdPerShare") return "per share";
  return (METRIC_LABEL[s.met] ?? s.met).toLowerCase();
}

/**
 * Lines printed on one row of the anchor table under one name (a row of several column groups: Coca-Cola's
 * segment revenue and operating income, P&G's net sales, pretax and net earnings) are told apart by what
 * they measure, else by their stored table name; never two rows under one name.
 */
function nameTwins(rows: StatementRow[], byKey: Map<string, PayloadSeries>) {
  const byRow = new Map<string, LineRow[]>();
  for (const r of rows)
    if (r.kind === "line" && r.at) {
      const id = r.at.join(":");
      byRow.set(id, [...(byRow.get(id) ?? []), r]);
    }
  for (const list of byRow.values()) {
    if (list.length < 2) continue;
    const names = new Map<string, LineRow[]>();
    for (const r of list) {
      const n = nameCore(printedName(r, byKey));
      names.set(n, [...(names.get(n) ?? []), r]);
    }
    for (const same of names.values()) if (same.length > 1) twinNames(same, byKey);
  }
}

/** Lines under one printed name, told apart by what they measure, else by basis and measure, else table name. */
function twinNames(same: LineRow[], byKey: Map<string, PayloadSeries>) {
  const basisWord = (r: LineRow) => {
    const bd = (byKey.get(r.k)!.bd ?? "").toLowerCase();
    return /non[- ]?gaap/.test(bd) ? "non-GAAP" : /\bgaap\b/.test(bd) ? "GAAP" : (basisOf(bd) ?? "");
  };
  const tries = [
    (r: LineRow) => measureWord(byKey.get(r.k)!),
    (r: LineRow) => (basisWord(r) ? `${basisWord(r)} ${measureWord(byKey.get(r.k)!)}` : ""),
    (r: LineRow) => byKey.get(r.k)!.bd ?? "",
  ];
  for (const q of tries) {
    const words = same.map(q);
    if (words.every(Boolean) && new Set(words.map((w) => w.toLowerCase())).size === same.length) {
      same.forEach((r, i) => (r.twin = words[i]));
      break;
    }
  }
}

/**
 * A printed heading as the document prints it: only one shouted in capitals ("NONINTEREST EXPENSE") is put in
 * sentence case; "Client and Gaming Segment" keeps its case. A closing colon goes.
 */
export function headText(h: string, keep: Set<string>): string {
  const t = h.trim().replace(/\s*:\s*$/, "");
  const words = t.split(/\s+/).filter((w) => /[a-z]{2}/i.test(w));
  const caps = words.filter((w) => !/[a-z]/.test(w)).length;
  return shownLabel(caps * 2 >= words.length ? sentenceCase(t, keep) : t);
}

/** Words a printed label can break after only mid-phrase: a row ending in one continues on the next row. */
const DANGLING = /(?:\s(?:or|and|of|to|for|the|in|on|by|with|from|at|a|an|nor|than|as)|[,&/-])$/i;
/** Whether a label-only row is the first line of a wrapped label. */
export const wrapped = (text: string) => DANGLING.test(text.trim());

function printedName(
  r: { k: string; ks: string[]; at?: [number, number, number]; name?: string },
  byKey: Map<string, PayloadSeries>,
): string {
  if (r.name) return shownLabel(r.name);
  const s = byKey.get(r.k)!;
  // A balance's period change the build split off the same cells ("<name>: net change") names the row last.
  const derived = (k: string) => /:\s*net change$/i.test(byKey.get(k)?.label ?? "");
  if (r.at)
    for (const k of [...r.ks.filter((x) => !derived(x)), ...r.ks.filter(derived)]) {
      const hit = byKey
        .get(k)
        ?.at?.find((x) => x[0] === r.at![0] && x[1] === r.at![1] && x[2] === r.at![2]);
      if (!hit) continue;
      const n = (hit[3] as PrintedExtra | undefined)?.n;
      return n ? shownLabel(n.replace(/:\s*second breakdown$/i, "")) : lineLabel(byKey.get(k)!);
    }
  return lineLabel(s);
}

/**
 * Whether a caption read above a table can be its title: not a bullet or a sentence carrying figures
 * (a release's "Positive operating leverage of 5.3% yoy" or "• Wealth fees increased $16 million, ..."),
 * which name a highlight rather than the table; the section then keeps its stored table name.
 */
export function tableTitle(t: string): boolean {
  const x = t.trim();
  return (
    x.length > 0 &&
    x.length <= 90 &&
    !/^[•·▪◦‣*-]/.test(x) &&
    !(/[a-z]\.\s*$/.test(x) && x.split(/\s+/).length >= 4) &&
    !/\d\s*%|\$\s*\d|\d\s*(bps|basis points)\b/i.test(x)
  );
}

/**
 * Statement sections of a payload, in the company's order, arranged into groups (`arrange`), each classified
 * by kind for the company's sector when the caller gives the sector and industry fields it has.
 */
export function assembleStatements(
  p: IrPayload,
  company?: { sector?: string | null; industry?: string | null },
): Statement[] {
  const out = assembleSections(p);
  const sector = sectorOf(company?.sector, company?.industry);
  for (const s of out) {
    s.kind = sectionKind(s, sector);
    s.filter = FILTER_OF[s.kind];
  }
  return out;
}

function assembleSections(p: IrPayload): Statement[] {
  const byKey = new Map(p.series.map((s) => [s.k, s]));
  const keep = capitalWords(p.series.flatMap((s) => [s.label, s.bd ?? ""]));
  // Payloads built with printing positions list every line a table prints; only older ones need a total
  // printed elsewhere brought in after its parts.
  const hasAt = p.series.some((s) => s.at?.length);
  const sections: Statement[] = [];
  const retired: Statement[] = [];
  for (const dr of drafts(p)) {
    if (!hasAt) closeTotals(dr, byKey);
    const slots = dr.order.filter((k) => byKey.has(slotKey(k)));
    const keys = slots.filter((x) => !x.includes(REPEAT));
    if (!keys.length) continue;
    const set = new Set(keys);
    const extra = dr.extra.filter((k) => byKey.has(k) && !set.has(k));
    // Second printings stay rows of their own; the other lines are grouped into printed rows. A group led by
    // an older copy's line (no row of the anchor table) is listed apart.
    const grouped = sameRows([...keys, ...extra], byKey, dr.places, extra);
    const groupOf = new Map(grouped.filter((g) => set.has(g[0])).map((g) => [g[0], g]));
    let gone = grouped.filter((g) => !set.has(g[0]));
    const groups: { slot: string; ks: string[] }[] = slots.flatMap((x) =>
      x.includes(REPEAT)
        ? [{ slot: x, ks: [slotKey(x)] }]
        : groupOf.has(x)
          ? [{ slot: x, ks: groupOf.get(x)! }]
          : [],
    );
    const depthOf = (k: string) => {
      let d = 0;
      let s = byKey.get(k);
      const seen = new Set<string>();
      while (s?.parent && !seen.has(s.parent) && d < 6) {
        seen.add(s.parent);
        if (set.has(s.parent)) d++;
        s = byKey.get(s.parent);
      }
      return d;
    };
    const cap = p.tables?.[dr.anchor.id];
    // A label-only row that ends mid-phrase is the first line of the next row's wrapped name, not a heading.
    const heads = new Map((cap?.heads ?? []).filter(([, h]) => !wrapped(h)));
    const wraps = new Map((cap?.heads ?? []).filter(([, h]) => wrapped(h)));
    const blank = new Set(cap?.blank ?? []);
    const onTable = !dr.anchor.t.startsWith("p");
    // A table printing one set of lines under two bases (reported and comparable): each block is headed by its
    // basis where the document's own heading was not kept.
    // A row filled from the print (category "statement") carries the table's name, not a basis of its own.
    const basisOfKey = (k: string) => (byKey.get(k)?.cat === "statement" ? null : basisOf(byKey.get(k)?.bd));
    const bases = new Set(keys.map(basisOfKey).filter(Boolean));
    let lastBasis: string | null = null;
    const rows: StatementRow[] = [];
    let prevR: number | null = null;
    for (const { slot, ks } of groups) {
      const k = ks[0];
      const r = dr.slotR.get(slot) ?? ks.map((x) => dr.slotR.get(x)).find((x) => x != null);
      const depth = depthOf(k);
      if (r != null && prevR != null && r > prevR + 1) {
        // What the document prints between the two lines: headings, else a spacer band.
        const between: StatementRow[] = [];
        let gap = false;
        for (let i = prevR + 1; i < r; i++) {
          const h = heads.get(i);
          if (h) between.push({ kind: "head", text: headText(h, keep), depth: 0, r: i });
          else if (blank.has(i) || !cap) {
            // A spacer band closes the headings above it: their rows are not in this section (the reader
            // did not keep them), so they would head the wrong lines. A spacer between a heading and the line it
            // heads, with nothing else printed up to that line, keeps it (Microsoft's "Devices and Consumer", a
            // blank row, then "Revenue").
            const onlySpace = (x: number) => blank.has(x) || heads.has(x) || wraps.has(x);
            const headsLine = !!cap && between.length > 0 && [...Array(r - i - 1).keys()].every((x) => onlySpace(i + 1 + x));
            if (!headsLine) between.length = 0;
            gap = true;
          } else if (!wraps.has(i)) {
            // A printed row the reader did not keep: the headings above it head that row, not this line
            // (Oracle's growth-rate headings over unread percentage rows).
            if (between.length) gap = true;
            between.length = 0;
          }
        }
        if (between.length) {
          if (gap || rows.at(-1)?.kind === "line") rows.push({ kind: "gap" });
          for (const h of between)
            rows.push({ ...h, depth: Math.max(0, depth - 1) } as StatementRow);
        } else if (gap) rows.push({ kind: "gap" });
      } else if (r != null && prevR == null && cap) {
        const before = [...heads.entries()].filter(
          ([i]) => i < r && i >= r - 2 && [...Array(r - i - 1).keys()].every((x) => heads.has(i + 1 + x) || blank.has(i + 1 + x) || wraps.has(i + 1 + x)),
        );
        for (const [i, h] of before)
          rows.push({ kind: "head", text: headText(h, keep), depth: Math.max(0, depth - 1), r: i });
      }
      // Lines of several bases on one printed row (GAAP and non-GAAP columns) are told apart by their names.
      const rowBases =
        r == null ? 0 : new Set(groups.filter((g) => dr.slotR.get(g.slot) === r).map((g) => basisOfKey(g.ks[0]))).size;
      if (bases.size > 1 && rowBases < 2) {
        const b = basisOfKey(k);
        if (b && b !== lastBasis) {
          if (rows.at(-1)?.kind !== "head") {
            if (rows.at(-1)?.kind === "line") rows.push({ kind: "gap" });
            rows.push({ kind: "head", text: shownLabel(sentenceCase(byKey.get(k)!.bd!, keep)), depth: 0 });
          }
          lastBasis = b;
        }
      }
      if (r != null) prevR = r;
      // Bold with a rule only where the section prints parts of it; a total of parts printed elsewhere reads as a line.
      rows.push({
        kind: "line",
        k,
        ks,
        depth,
        total:
          ks.some((x) => !!byKey.get(x)!.total) &&
          keys.some((o) => ks.includes(byKey.get(o)!.parent ?? "")),
        ...(onTable && r != null ? { at: [dr.anchor.d, Number(dr.anchor.t), r] as [number, number, number] } : {}),
        ...(r != null && wraps.has(r - 1) ? { wrap: wraps.get(r - 1)!.trim() } : {}),
      });
    }
    // The table's printed layout (build format 3): the row's printed name, bold and rule marks.
    const printedRows = new Map(((cap as PrintedLayout | undefined)?.rows ?? []).map(([r, l, f, n]) => [r, { l, f, n }]));
    const lostHeads = new Map<StatementRow, StatementRow>();
    for (const r of rows) {
      const pr = r.kind === "line" ? (r.at ? printedRows.get(r.at[2]) : undefined) : r.kind === "head" && r.r != null ? printedRows.get(r.r) : undefined;
      if (!pr) continue;
      if (r.kind === "line") {
        // A printed row's name names its lines only when they are one line under one name (a table printed
        // with dates down the side names its rows "As of July 31, 2026", not "Current" and "Noncurrent").
        const same = rows.filter((x): x is LineRow => x.kind === "line" && !!x.at && x.at[2] === r.at![2]);
        const one = new Set(same.map((x) => nameCore(lineLabel(byKey.get(x.k)!)))).size === 1;
        // A name joined to the row above it that prints no figures and heads columns ("Amount ($ billions)
        // Year/Year Growth (%) ... cRPO", ServiceNow) keeps only its own words.
        let n = pr.n?.trim() ?? "";
        const above = printedRows.get(r.at![2] - 1)?.n?.trim();
        if (above && n.startsWith(`${above} `) && COLUMN_HEAD.test(above)) n = n.slice(above.length).trim();
        // A heading taken for the first line of a wrapped name (Apple's "(1) Net sales by category:" over
        // "iPhone", whose lower-case start read as a continuation): when what follows the row above is the
        // line's whole stored name, the row reads that name and the row above is drawn as its heading.
        else if (
          above &&
          n.startsWith(`${above} `) &&
          one &&
          !/\d/.test(above) &&
          nameCore(n.slice(above.length)) === nameCore(lineLabel(byKey.get(r.k)!)) &&
          !rows.some((x) => x.kind === "head" && x.r === r.at![2] - 1)
        ) {
          n = n.slice(above.length).trim();
          lostHeads.set(r, { kind: "head", text: headText(above, keep), depth: Math.max(0, r.depth - 1), r: r.at![2] - 1 });
        }
        if (n && one && !MONTH_YEAR.test(n)) r.name = n;
        if (pr.f & 1) r.bold = true;
        if (pr.f & 2) r.rule = "single";
      } else if (r.kind === "head" && pr.f & 1) r.bold = true;
    }
    for (const [line, h] of lostHeads) {
      const i = rows.indexOf(line);
      if (i < 0) continue;
      rows.splice(i, 0, ...(rows[i - 1]?.kind === "line" ? [{ kind: "gap" } as StatementRow, h] : [h]));
    }
    nameTwins(rows, byKey);
    let head = "";
    for (const r of rows) {
      if (r.kind === "head") head = r.text;
      else if (r.kind === "gap") continue;
      else if (head) {
        const own = printedName(r, byKey);
        const i = own.indexOf(":");
        if (i > 0 && nameCore(own.slice(0, i)) === nameCore(head)) r.under = head;
      }
    }
    shapeRows(
      rows,
      byKey,
      (r) => rowLabel(r as LineRow, byKey),
      (r, f) => rowCells(r.ks, byKey, f, (r as LineRow).at).cells,
    );
    printedLevels(rows, printedRows);
    // Lines only older documents' copies print (not the same release) close the section, under a heading that
    // says so, never among the rows the table prints now; lines another document of the same release prints
    // stay apart in the more group.
    const anchorDay = Date.parse(`${p.docs[dr.anchor.d]?.filed ?? ""}T00:00:00Z`);
    const older = (g: string[]) => {
      const ds = g.flatMap((k) => [...(dr.places.get(k) ?? [])].map((x) => Number(x.split(":")[0])));
      return (
        Number.isFinite(anchorDay) &&
        ds.length > 0 &&
        ds.every((d) => {
          const f = Date.parse(`${p.docs[d]?.filed ?? ""}T00:00:00Z`);
          return Number.isFinite(f) && anchorDay - f > RELEASE_DAYS * DAY_MS;
        })
      );
    };
    const earlier = gone.filter(older);
    if (earlier.length) {
      rows.push({ kind: "gap" }, { kind: "head", text: "Printed only in earlier periods", depth: 0 });
      const olds: LineRow[] = [];
      for (const g of earlier) {
        const row: LineRow = { kind: "line", k: g[0], ks: g, depth: 0, total: false, old: true };
        rows.push(row);
        olds.push(row);
        keys.push(g[0]);
      }
      // Older lines under one printed name are told apart as the table's own rows are (Coca-Cola's older
      // segment tables: "EMEA" revenue, operating income and income before taxes).
      const names = new Map<string, LineRow[]>();
      for (const r of olds) {
        const n = nameCore(printedName(r, byKey));
        names.set(n, [...(names.get(n) ?? []), r]);
      }
      for (const same of names.values()) if (same.length > 1) twinNames(same, byKey);
    }
    gone = gone.filter((g) => !older(g));
    const lines = keys.map((k) => byKey.get(k)!);
    const money = lines.filter((s) => s.unit === "usd");
    // The section's scale is the one its own table prints (a line can also be printed in another table at
    // another scale).
    const ownDiv = rows.flatMap((r) =>
      r.kind === "line" && byKey.get(r.k)?.unit === "usd" ? (mode(ownScale(r.ks, byKey, r.at).ownDivs) ?? []) : [],
    );
    const div = mode(ownDiv.length ? ownDiv : money.map(lineDiv)) ?? 1;
    const bds = lines.map((s) => s.bd).filter((x): x is string => !!x);
    const printed = cap?.title && tableTitle(cap.title) ? shownLabel(sentenceCase(cap.title, keep)) : "";
    const bd = mode(bds);
    const cat = mode(lines.map((s) => s.cat)) ?? "kpi";
    const unitText = cap?.unit?.replace(/^\(|\)$/g, "").trim();
    const sec: Statement = {
      id: dr.anchor.id,
      title: shownLabel(printed || bd || CATEGORY_LABEL[cat] || cat),
      titleFrom: printed ? "printed" : bd ? "breakdown" : "category",
      group: "main",
      unitLine: unitText
        ? unitText.charAt(0).toUpperCase() + unitText.slice(1)
        : money.length
          ? div === 1
            ? "Dollars"
            : `Dollars ${SCALE_WORD[div]}`
          : "",
      div,
      rows,
      keys,
      docs: dr.docs.size,
      copies: [...dr.docs],
      last: lines.reduce((m, s) => (lastEnd(s) > m ? lastEnd(s) : m), ""),
      first: lines.reduce((m, s) => (firstEnd(s) < m ? firstEnd(s) : m), "9999"),
      cat,
      doc: dr.anchor.d,
      ...(onTable && ytdBasis(cap, keys, byKey, dr.anchor.d, Number(dr.anchor.t)) ? { basis: "ytd" as const } : {}),
    };
    sections.push(sec);
    if (gone.length) {
      const old = gone.map((g) => byKey.get(g[0])!);
      retired.push({
        ...sec,
        id: `${sec.id}~old`,
        title: `${sec.title}: lines only other copies print`,
        titleFrom: sec.titleFrom,
        group: "more",
        rows: gone.map((g) => ({ kind: "line", k: g[0], ks: g, depth: 0, total: false })),
        keys: gone.map((g) => g[0]),
        last: old.reduce((m, s) => (lastEnd(s) > m ? lastEnd(s) : m), ""),
        first: old.reduce((m, s) => (firstEnd(s) < m ? firstEnd(s) : m), "9999"),
      });
    }
  }
  return arrange(p, sections, retired);
}

const DAY_MS = 864e5;
/** Documents filed this close to the main document belong to the same release. */
export const RELEASE_DAYS = 10;
/** A section with this many lines or fewer is a fragment: listed compactly with the other fragments. */
export const FRAGMENT_LINES = 2;

const KIND_WORD: Record<string, string> = {
  "press-release": "earnings release",
  supplement: "supplement",
  presentation: "presentation",
  data: "data file",
  other: "document",
};

/**
 * The page order. The main document is the newest supplement (else earnings release, else the newest
 * document), by filing date and then lines printed; its tables come first, in its own order. Tables only
 * other documents of the same release print follow (within `RELEASE_DAYS`), by document and table order,
 * each naming its source. Sections of at most `FRAGMENT_LINES` lines from either are folded into one compact
 * section after them, each under its own title. Everything else (tables of older documents, lines only other
 * copies of a table print) is in the "more" group, newest first. Nothing is dropped: every section stays reachable.
 */
export function arrange(p: IrPayload, sections: Statement[], retired: Statement[] = []): Statement[] {
  const lines = new Map<number, number>();
  for (const s of sections) lines.set(s.doc, (lines.get(s.doc) ?? 0) + s.keys.length);
  // A document stored under another kind whose own title calls it a supplement (`hint`, build format 3).
  const kindRank = (d: number) =>
    p.docs[d]?.kind === "supplement" || (p.docs[d] as { hint?: string } | undefined)?.hint === "supplement"
      ? 0
      : p.docs[d]?.kind === "press-release"
        ? 1
        : 2;
  // A document whose tables are the supplement's own (a stored supplement copy of the same release is
  // stitched onto them: Citigroup's EX-99.2 stored as "other" beside the investor-site PDF) ranks as one.
  const rankKind = (d: number) => {
    let r = kindRank(d);
    for (const s of sections)
      if (s.doc === d)
        for (const c of s.copies ?? []) if (c !== d && recent(c)) r = Math.min(r, kindRank(c));
    return r;
  };
  const docs = [...lines.keys()];
  // The release is dated by the documents that print statement tables: a slide image or a presentation
  // filed weeks later (Salesforce's investor day) never moves the release's tables to the older group.
  const slidesOnly = (d: number) => sections.every((s) => s.doc !== d || s.id.includes(":p"));
  const statementDocs = docs.filter(
    (d) => !slidesOnly(d) && p.docs[d]?.kind !== "image" && p.docs[d]?.kind !== "presentation",
  );
  const dated = statementDocs.length ? statementDocs : docs;
  const newest = dated.reduce((m, d) => ((p.docs[d]?.filed ?? "") > m ? (p.docs[d]?.filed ?? "") : m), "");
  const lastDay = Date.parse(`${newest || "1970-01-01"}T00:00:00Z`);
  // A copy stored without a filing date (an investor-site PDF or workbook of the supplement) belongs to the
  // release when it prints the newest period any section carries.
  const lastOf = new Map<number, string>();
  for (const s of p.series)
    for (const [key, c] of endsOf(s)) {
      const e = key.slice(key.lastIndexOf(":") + 1);
      if (c.d != null && e > (lastOf.get(c.d) ?? "")) lastOf.set(c.d, e);
    }
  for (const s of sections) if (s.last > (lastOf.get(s.doc) ?? "")) lastOf.set(s.doc, s.last);
  const newestPeriod = [...lastOf.values()].reduce((m, x) => (x > m ? x : m), "");
  const recent = (d: number) => {
    const f = p.docs[d]?.filed;
    if (!f) return !newest || (!!newestPeriod && lastOf.get(d) === newestPeriod);
    return !newest || Math.abs(lastDay - Date.parse(`${f}T00:00:00Z`)) <= RELEASE_DAYS * DAY_MS;
  };
  const main = dated
    .filter(recent)
    .sort(
      (a, b) =>
        rankKind(a) - rankKind(b) ||
        (p.docs[b]?.filed ?? "").localeCompare(p.docs[a]?.filed ?? "") ||
        (lines.get(b) ?? 0) - (lines.get(a) ?? 0),
    )[0];
  const source = (d: number) => KIND_WORD[p.docs[d]?.kind ?? ""] ?? "document";
  const lineCount = (s: Statement) => s.rows.filter((r) => r.kind === "line").length;
  const first: Statement[] = [];
  const other: Statement[] = [];
  const small: Statement[] = [];
  const more: Statement[] = [];
  for (const s of sections) {
    if (s.doc === main) (lineCount(s) <= FRAGMENT_LINES ? small : first).push(s);
    else if (recent(s.doc))
      (lineCount(s) <= FRAGMENT_LINES ? small : other).push({
        ...s,
        group: "other",
        source: source(s.doc),
      });
    else more.push({ ...s, group: "more", source: source(s.doc) });
  }
  // Tables the document prints under one title over several pages read as the document's own "continued".
  for (let i = 1; i < first.length; i++)
    if (first[i].title.replace(/, continued$/i, "") === first[i - 1].title.replace(/, continued$/i, ""))
      first[i] = { ...first[i], title: `${first[i - 1].title.replace(/, continued$/i, "")}, continued` };
  const merged = small.length ? [mergeFragments(p, small, main)] : [];
  return [...first, ...other, ...merged, ...retired, ...more];
}

/** The compact section of small tables: each fragment's lines under its own title, in page order. */
function mergeFragments(p: IrPayload, small: Statement[], main: number | undefined): Statement {
  const rows: StatementRow[] = [];
  for (const s of small) {
    if (rows.length) rows.push({ kind: "gap" });
    rows.push({
      kind: "head",
      text: s.source ? `${s.title} (${s.source})` : s.title,
      depth: 0,
    });
    for (const r of s.rows)
      if (r.kind === "line") rows.push({ ...r, depth: 0, total: false, up: undefined, sib: undefined });
  }
  const divs = small.map((s) => s.div);
  return {
    id: "small",
    title: "Smaller tables",
    titleFrom: "merged",
    group: "other",
    unitLine: small.every((s) => s.unitLine === small[0].unitLine) ? small[0].unitLine : "",
    div: mode(divs) ?? 1,
    rows,
    keys: small.flatMap((s) => s.keys),
    docs: new Set(small.map((s) => s.doc)).size,
    last: small.reduce((m, s) => (s.last > m ? s.last : m), ""),
    first: small.reduce((m, s) => (s.first < m ? s.first : m), "9999"),
    cat: mode(small.map((s) => s.cat)) ?? "kpi",
    doc: main ?? small[0].doc,
  };
}

/** The scales a row's own table prints its figures at (cells located there and the table's own printings). */
function ownScale(ks: string[], byKey: Map<string, PayloadSeries>, at?: [number, number, number]) {
  const ownDivs: number[] = [];
  const ownOf = (k: string) =>
    at
      ? ((byKey.get(k)?.at?.find((x) => x[0] === at[0] && x[1] === at[1] && x[2] === at[2] && x.length > 3)?.[3] as
          | PrintedExtra
          | undefined)?.v ?? {})
      : {};
  if (at)
    for (const k of ks) {
      const s = byKey.get(k);
      if (!s || (s.unit !== "usd" && s.unit !== "count")) continue;
      for (const c of cellsOf(s))
        if (c.d === at[0] && Array.isArray(c.l) && c.l[0] === at[1]) {
          const d = printedDiv(c);
          if (d != null) ownDivs.push(d);
        }
      for (const [val, , text] of Object.values(ownOf(k))) {
        const d = printedDiv({ v: val, x: text });
        if (d != null) ownDivs.push(d);
      }
    }
  return { ownDivs, ownOf };
}

/**
 * The scale a table prints its money and count figures at: the most common printed scale of the cells located
 * in it, over every line of the payload (one pass per series map, kept beside it).
 */
const tableDivCache = new WeakMap<Map<string, PayloadSeries>, Map<string, number>>();
function tableDiv(byKey: Map<string, PayloadSeries>, d: number, t: number): number | undefined {
  let m = tableDivCache.get(byKey);
  if (!m) {
    const seen = new Map<string, number[]>();
    for (const s of byKey.values()) {
      if (s.unit !== "usd" && s.unit !== "count") continue;
      for (const c of cellsOf(s)) {
        if (c.d == null || !Array.isArray(c.l) || typeof c.l[0] !== "number") continue;
        const x = printedDiv(c);
        if (x == null) continue;
        const key = `${c.d}:${c.l[0]}`;
        const xs = seen.get(key);
        if (xs) xs.push(x);
        else seen.set(key, [x]);
      }
    }
    m = new Map([...seen].map(([k, xs]) => [k, mode(xs)!]));
    tableDivCache.set(byKey, m);
  }
  return m.get(`${d}:${t}`);
}

/**
 * Whether a table prints year-to-date columns only (six or nine months, no three-month column): by its printed
 * columns (`PayloadTable.cols`, build format 6), else by the figures located in it (year-to-date cells and no
 * quarter cell). Such a section is shown under its printed lengths and ends, never under quarter heads.
 */
export function ytdBasis(
  cap: PayloadTable | undefined,
  keys: string[],
  byKey: Map<string, PayloadSeries>,
  d: number,
  t: number,
): boolean {
  const cols = (cap as PrintedCols | undefined)?.cols;
  if (cols?.length) {
    const months = cols.map((c) => c[1]).filter((m) => m > 0);
    return months.some((m) => m === 6 || m === 9) && !months.includes(3);
  }
  const here = (c: PayloadCell) => c.d === d && Array.isArray(c.l) && c.l[0] === t;
  let ytd = 0;
  for (const k of keys) {
    const s = byKey.get(k);
    if (!s) continue;
    if ([...Object.values(s.q), ...Object.values(s.held?.q ?? {})].some(here)) return false;
    ytd += Object.values((s as YtdCells).ytd ?? {}).filter(here).length;
  }
  return ytd > 0;
}

/** Whether the table at `at` prints two different figures of line s for one period on that one row. */
function twoGroups(s: PayloadSeries | undefined, freq: IrPeriodKind, at: [number, number, number]) {
  if (!s) return false;
  return Object.values(cellsFor(s, freq)).some((c) => {
    const a = c.alt;
    if (!a || a.kind !== "conflict" || c.d !== at[0] || a.d !== at[0] || a.v === c.v) return false;
    if (!Array.isArray(c.l) || !Array.isArray(a.l)) return false;
    return c.l[0] === at[1] && c.l[1] === at[2] && a.l[0] === at[1] && a.l[1] === at[2] && a.l[2] !== c.l[2] && a.e === c.e && a.m === c.m;
  });
}

/**
 * One row's figures for a period kind: the first line of the row that prints a period wins (newest copy first).
 * A row printed in a table (`at`) shows that table's own printing where the build stored a differing figure
 * (`series.at`), marked `own`, with the shown cell kept as its other printing. A line merged into the row
 * fills a period only in the row's printed scale: a billions figure never fills a row printed in millions.
 */
export function rowCells(
  ks: string[],
  byKey: Map<string, PayloadSeries>,
  freq: IrPeriodKind,
  at?: [number, number, number],
): {
  cells: Record<string, PayloadCell>;
  held: Record<string, PayloadCell>;
  from: Record<string, string>;
} {
  const cells: Record<string, PayloadCell> = {};
  const held: Record<string, PayloadCell> = {};
  const from: Record<string, string> = {};
  // A row whose own table prints two figures for one period on it (column groups the reader did not name,
  // Walmart's "Walmart International" and "Consolidated" constant-currency columns) cannot say which group
  // its figures, or its history from other documents, belong to: it shows none rather than a mix.
  if (at && ks.some((k) => twoGroups(byKey.get(k), freq, at))) return { cells, held, from };
  const lead = byKey.get(ks[0]);
  // The row's printed scale: its own table's printing where it has one (Netflix prints regional revenue in
  // thousands in one table and in millions in another; one series holds both), else the lead line's.
  const { ownDivs, ownOf } = ownScale(ks, byKey, at);
  // A row of a table with no figure stored at its own position takes the scale the rest of its table prints
  // (Wells Fargo's balance sheet "Total equity" held only the capital table's rounded billions): figures
  // printed at another scale are not this row's printing and stay out.
  const tableScale =
    at && !ownDivs.length && lead && (lead.unit === "usd" || lead.unit === "count")
      ? tableDiv(byKey, at[0], at[1])
      : undefined;
  if (tableScale != null) ownDivs.push(tableScale);
  // A row with no table position of its own (a slide's line, a line only older copies print) keeps the scale of
  // its newest printed figure: Walmart's segment sales printed $125.2 billion on a slide and 124,969 million in a
  // table never share one row.
  if (!ownDivs.length && lead && (lead.unit === "usd" || lead.unit === "count") && (!at || tableScale == null)) {
    let newest: PayloadCell | undefined;
    for (const k of ks) {
      const s = byKey.get(k);
      if (!s) continue;
      for (const [e, c] of Object.entries(cellsFor(s, freq)))
        if (printedDiv(c) != null && (!newest || e > (newest.e ?? ""))) newest = { ...c, e: c.e ?? e };
    }
    const d = newest ? printedDiv(newest) : null;
    if (d != null) ownDivs.push(d);
  }
  const rowDiv = mode(ownDivs) ?? (lead ? knownDiv(lead) : null);
  const fits = (c: PayloadCell) => {
    if (rowDiv == null) return true;
    const d = printedDiv(c);
    return d == null || d === rowDiv;
  };
  // A shown figure printed at another scale than the row's table: kept aside, in case the table's own
  // printing of that period replaces it below.
  const other: Record<string, [PayloadCell, string]> = {};
  for (const [i, k] of ks.entries()) {
    const s = byKey.get(k);
    if (!s) continue;
    for (const [e, c] of Object.entries(cellsFor(s, freq)))
      if (!cells[e] && !held[e] && ((i === 0 && !ownDivs.length) || fits(c))) {
        cells[e] = c;
        from[e] = k;
      } else if (!other[e]) other[e] = [c, k];
    for (const [e, c] of Object.entries(heldFor(s, freq)))
      if (!cells[e] && !held[e] && ((i === 0 && !ownDivs.length) || fits(c))) {
        held[e] = c;
        from[e] = k;
      }
  }
  if (at && (freq === "q" || freq === "y"))
    for (const k of ks) {
      const v = ownOf(k);
      for (const [key, [val, col, text]] of Object.entries(v)) {
        const [kind, e] = key.split(":");
        if (kind !== freq) continue;
        if (!cells[e] && !held[e] && other[e]?.[1] === k) {
          cells[e] = other[e][0];
          from[e] = k;
        }
        const c = cells[e];
        if (!c || from[e] !== k || c.v === val) continue;
        cells[e] = {
          ...c,
          v: val,
          d: at[0],
          l: [at[1], at[2], col],
          x: text,
          f: undefined,
          flags: undefined,
          own: true,
          alt: { v: c.v, d: c.d, l: c.l, x: c.x, e: c.e, m: c.m, kind: "conflict" },
        };
      }
    }
  return { cells, held, from };
}

type LineRow = Extract<StatementRow, { kind: "line" }>;

/** The parts a total row closes, as its own table prints them (`shapeRows`): indexes into `rows`. */
export function blockParts(rows: StatementRow[], i: number, _byKey?: Map<string, PayloadSeries>): number[] {
  const t = rows[i];
  if (t?.kind !== "line" || !t.total) return [];
  const out: number[] = [];
  rows.forEach((r, j) => {
    if (r.kind === "line" && r.up === i) out.push(j);
  });
  return out;
}

/**
 * Tie-out checks of a section's totals against the parts this table prints (`blockParts`), never against
 * lines of other tables or documents stored under the same total (JPM's TOTAL NET REVENUE also closes the
 * AWM table and a deck slide). A period the build checked and found not adding up is re-checked here from the
 * figures of the parts this section prints (stored under the total, or siblings brought to their level); it
 * ties when they add up, and keeps the build's verdict otherwise. Checks the build passed and selected-line
 * lists stand as stored. Keyed "<line key>|<q|y>|<period end>" like the stored checks.
 */
export function sectionChecks(
  sec: Statement,
  byKey: Map<string, PayloadSeries>,
  stored: PayloadCheck[] | Map<string, PayloadCheck>,
): Map<string, PayloadCheck> {
  const map =
    stored instanceof Map
      ? stored
      : new Map(stored.map((c) => [`${c.k}|${c.kind === "fy" ? "y" : "q"}|${c.e}`, c]));
  const out = new Map<string, PayloadCheck>();
  sec.rows.forEach((t, i) => {
    if (t.kind !== "line" || !t.total) return;
    // The rows of its block stored under it, and the siblings brought to their level; other rows the block
    // shows at that level (stored under another line) are not its parts.
    const parts = blockParts(sec.rows, i).map((j) => sec.rows[j] as LineRow);
    for (const freq of ["q", "y"] as const) {
      const tc = rowCells(t.ks, byKey, freq, t.at);
      const pc = parts.map((r) => rowCells(r.ks, byKey, freq, r.at));
      for (const [e, cell] of Object.entries(tc.cells)) {
        const owner = tc.from[e];
        const key = `${owner}|${freq}|${e}`;
        const x = map.get(key);
        if (!x || x.total !== cell.v) continue;
        // A passed stored check remains tied to its actual reported total. For a failed
        // check, require this table's own comparable components before making a claim.
        if (x.ok || x.partial) {
          out.set(key, x);
          continue;
        }
        const parent = byKey.get(owner);
        if (!parent || parts.length < 2) continue;
        const partsAt = pc.map((r) => ({ cell: r.cells[e], series: byKey.get(r.from[e]) }));
        if (partsAt.some((p) => !p.cell || !p.series || p.series.unit !== parent.unit ||
          p.cell.m !== cell.m || !!p.series.pit !== !!parent.pit)) continue;
        const addresses = partsAt.map(({cell: c, series}) =>
          c.d != null && Array.isArray(c.l) ? `${c.d}:${c.l.join(":")}` : `series:${series!.k}`);
        const ownAddress = cell.d != null && Array.isArray(cell.l) ? `${cell.d}:${cell.l.join(":")}` : `series:${owner}`;
        if (new Set(addresses).size !== addresses.length || addresses.includes(ownAddress)) continue;
        const sub = new Set(x.sub ?? []);
        const sum = parts.reduce((n, r, j) =>
          n + (r.ks.some((k) => sub.has(byKey.get(k)?.label ?? "")) ? -1 : 1) * partsAt[j].cell.v, 0);
        const tol = Math.max(Math.abs(cell.v) * 0.005, parent.unit === "usd" ? 1.5e6 : 1.5);
        out.set(key, { ...x, total: cell.v, sum, ok: Math.abs(sum - cell.v) <= tol, n: parts.length });
      }
    }
  });
  return out;
}

/** Lines no printed table or slide places (figures read from sentences): listed apart, by category. */
export function unplacedLines(p: IrPayload, sections: Statement[]): PayloadSeries[] {
  const placed = new Set(sections.flatMap((s) => s.keys));
  return p.series.filter((s) => !placed.has(s.k));
}

const DAY = 864e5;
/** How long a line may go unprinted and still count as current: fifteen months, as the older site did. */
export const CURRENT_DAYS = 455;

/** The cut-off for "current": fifteen months before the payload's newest period. */
export function currentCut(p: IrPayload): string {
  const last =
    p.stats.lastPeriod ?? p.series.reduce((m, s) => (lastEnd(s) > m ? lastEnd(s) : m), "");
  if (!last) return "";
  return new Date(Date.parse(`${last.slice(0, 10)}T00:00:00Z`) - CURRENT_DAYS * DAY)
    .toISOString()
    .slice(0, 10);
}

/**
 * The rows a section shows: under "Current series" lines last printed before `cut` are left out (a total
 * stays while one of its parts is current), headings without a line under them and doubled spacers go.
 * Returns the rows and how many lines were left out.
 */
export function visibleRows(
  sec: Statement,
  byKey: Map<string, PayloadSeries>,
  opts: {
    cut?: string;
    has?: (s: PayloadSeries) => boolean;
    match?: (s: PayloadSeries, row: LineRow) => boolean;
  },
): { rows: StatementRow[]; hidden: number } {
  const lineRows = sec.rows.filter(
    (r): r is Extract<StatementRow, { kind: "line" }> => r.kind === "line",
  );
  const rowOf = new Map<string, string>();
  for (const r of lineRows) for (const k of r.ks) rowOf.set(k, r.k);
  const keepK = new Set<string>();
  let hidden = 0;
  for (const r of lineRows) {
    const ss = r.ks.map((k) => byKey.get(k)).filter((x): x is PayloadSeries => !!x);
    const current = !opts.cut || ss.some((s) => lastEnd(s) >= opts.cut!);
    if (!current) hidden++;
    if (current && (!opts.has || ss.some(opts.has)) && (!opts.match || ss.some((s) => opts.match!(s, r))))
      keepK.add(r.k);
  }
  // A total stays when one of its parts is shown.
  for (const k of [...keepK]) {
    let s = byKey.get(k);
    for (let i = 0; s?.parent && i < 6; i++) {
      const p = rowOf.get(s.parent);
      if (p && (!opts.has || opts.has(byKey.get(s.parent)!))) keepK.add(p);
      s = byKey.get(s.parent);
    }
  }
  const lines = sec.rows.filter((r) => r.kind !== "line" || keepK.has(r.k));
  // A heading stays only when a line follows it before the next spacer; spacers never lead, trail or double.
  const out: StatementRow[] = [];
  for (let i = 0; i < lines.length; i++) {
    const r = lines[i];
    if (r.kind === "head") {
      // Of headings printed one under another with nothing between them, the last names the lines.
      if (lines[i + 1]?.kind !== "line") continue;
    }
    if (r.kind === "gap" && (!out.length || out.at(-1)!.kind === "gap")) continue;
    out.push(r);
  }
  while (out.length && out.at(-1)!.kind !== "line") out.pop();
  const clean = out;
  return { rows: clean, hidden };
}

/** Whether a line prints any figure (shown or held) in the given columns. */
export function printsIn(s: PayloadSeries, cols: string[], freq: IrPeriodKind) {
  const c = cellsFor(s, freq);
  const h = heldFor(s, freq);
  return cols.some((e) => c[e] || h[e]);
}

/** Decimals the line's figures are printed with (most common among its printed cells). */
export function printedDecimals(s: PayloadSeries): number {
  const ds: number[] = [];
  for (const c of cellsOf(s)) {
    const m = c.x?.match(/\d\.(\d+)/);
    if (c.x && /\d/.test(c.x)) ds.push(m ? m[1].length : 0);
  }
  return mode(ds) ?? (s.unit === "pct" || s.unit === "usdPerShare" || s.unit === "ratio" ? 2 : 0);
}

/** What a printed cell carries after its number ("%", "x", " bps"), most common across the line; "" when nothing. */
export function printedSuffix(s: PayloadSeries): string {
  const xs: string[] = [];
  for (const c of cellsOf(s)) {
    if (!c.x) continue;
    const m = c.x.match(/\d\)?\s*(%|x|×|bps|bp)\s*$/i);
    xs.push(
      m ? (m[1] === "%" ? "%" : m[1].toLowerCase() === "x" || m[1] === "×" ? "×" : " bps") : "",
    );
  }
  const s0 = mode(xs) ?? "";
  if (!s0 && s.unit === "pct") return "%";
  if (!s0 && s.unit === "bps") return " bps";
  if (!s0 && s.unit === "ratio") return "×";
  return s0;
}

const fmtN = (n: number, dec: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });

/**
 * A figure as the document prints it: in the line's printed scale, with its printed decimals and mark,
 * negatives in parentheses ("(1,234)", "(0.4)%").
 */
export function printedFigure(v: number, div: number, dec: number, suffix: string): string {
  const x = Math.abs(v) / div;
  const body = fmtN(x, dec);
  if (body === fmtN(0, dec)) return `${body}${suffix}`;
  return v < 0 ? `(${body})${suffix}` : `${body}${suffix}`;
}

/** The scale a line is printed at when it differs from its section's ("in billions"), for a quiet note at the label. */
export function scaleNote(lineDivisor: number, s: PayloadSeries, sectionDiv: number): string {
  if (s.unit === "usd")
    return lineDivisor !== sectionDiv ? SCALE_WORD[lineDivisor] || "in dollars" : "";
  if (s.unit === "count") return lineDivisor > 1 ? SCALE_WORD[lineDivisor] : "";
  if (s.unit === "usdPerUnit") return "$ per unit";
  if (s.unit === "pp") return "percentage points";
  return ["usdPerShare", "pct", "bps", "ratio", "other"].includes(s.unit) ? "" : s.unit;
}

/**
 * The payload with the printed captions of its section tables: `captionsOf(doc index)` gives the captions
 * of one stored document (table-captions.ts), or nothing when the document can't be read. Only anchor
 * tables are kept, so the payload grows by a few kilobytes. Pure; the build reads the documents.
 */
export async function withCaptions(
  p: IrPayload,
  captionsOf: (d: number) => Promise<TableCaption[] | null | undefined>,
): Promise<IrPayload> {
  const anchors = statementAnchors(p);
  const docs = [...new Set(anchors.map((a) => a.d))];
  const tables: Record<string, PayloadTable> = {};
  for (const d of docs) {
    const caps = await captionsOf(d);
    if (!caps) continue;
    const byT = new Map(caps.map((c) => [c.t, c]));
    for (const a of anchors) {
      if (a.d !== d) continue;
      const c = byT.get(a.t);
      if (!c) continue;
      const { t: _t, ...rest } = c;
      if (rest.title || rest.unit || rest.heads?.length || rest.blank?.length)
        tables[`${a.d}:${a.t}`] = rest;
    }
  }
  return Object.keys(tables).length ? { ...p, tables } : p;
}
