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
import { CATEGORY_LABEL, shownLabel } from "@/lib/ir/display";
import type { IrPayload, PayloadCell, PayloadSeries, PayloadTable, PrintedAt, PrintedExtra } from "@/lib/ir/payload";
import { cellsFor, heldFor, type IrPeriodKind } from "@/lib/ir/periods";
import { parseNumber } from "@/lib/ir/tables";
import { capitalWords, sentenceCase, type TableCaption } from "@/lib/ir/table-captions";

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
    }
  | { kind: "head"; text: string; depth: number }
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
  /** newest and oldest period end any of its lines carries */
  last: string;
  first: string;
  /** most common line category (for the category filter) */
  cat: string;
  /** the newest document that prints it, index into payload.docs */
  doc: number;
}

interface Table {
  id: string;
  d: number;
  t: string;
  /** line key → printed row (first printing within the table) */
  rows: Map<string, number>;
  /** further printings of a line in the same table (a total that closes two blocks), as [key, row] */
  again: [string, number][];
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

function* cellsOf(s: PayloadSeries): Generator<PayloadCell> {
  for (const m of [s.q, s.y, s.mo ?? {}, s.held?.q ?? {}, s.held?.y ?? {}, s.held?.mo ?? {}])
    for (const c of Object.values(m)) yield c;
}

/** Every printed table of the payload with the lines it prints (from shown, held and alternative printings). */
function tablesOf(p: IrPayload): Table[] {
  const by = new Map<string, Table>();
  const add = (k: string, c: { d?: number; l?: PayloadCell["l"] }) => {
    const at = placeOf(c);
    if (!at) return;
    let t = by.get(at.id);
    if (!t) by.set(at.id, (t = { id: at.id, d: at.d, t: at.t, rows: new Map(), again: [] }));
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
    for (const c of cellsOf(s)) {
      add(s.k, c);
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
  for (const t of tables) {
    const rows = [...t.rows.entries()].sort((a, b) => a[1] - b[1]).map(([k]) => k);
    // The section sharing most lines with this table, among those with no copy from this document yet.
    const shared = new Map<Draft, number>();
    for (const k of rows)
      for (const s of index.get(k) ?? [])
        if (!s.docs.has(t.d)) shared.set(s, (shared.get(s) ?? 0) + 1);
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
    }
    // The anchor's second printings of a line, at their own place in its row order.
    if (isAnchor)
      for (const [k, r] of [...t.again].sort((a, b) => a[1] - b[1])) {
        const slot = `${k}${REPEAT}${r}`;
        // One row per printed row: another line already standing for this row keeps it.
        if ([...best.slotR.entries()].some(([x, rx]) => rx === r && best!.order.includes(x)))
          continue;
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
export function sameRows(
  keys: string[],
  byKey: Map<string, PayloadSeries>,
  places: Map<string, Set<string>>,
): string[][] {
  const groups: { ks: string[]; at: Set<string> }[] = [];
  const pl = (s: PayloadSeries) => {
    const par = s.parent ? byKey.get(s.parent) : undefined;
    return norm(par ? lineLabel(par) : "");
  };
  // The same name, unit and role, under the same total; or in the same named table when one lost its total.
  const same = (a: PayloadSeries, b: PayloadSeries) =>
    norm(a.label) === norm(b.label) &&
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
        (g) => [...at].some((x) => g.at.has(x)) && g.ks.every((o) => agree(byKey.get(o)!, s)),
      ) ??
      // By name only across documents: two rows of one document are two printed rows.
      groups.find(
        (g) =>
          same(byKey.get(g.ks[0])!, s) &&
          ![...docsIn(g.at)].some((d) => mine.has(d)) &&
          g.ks.every((o) => agree(byKey.get(o)!, s)),
      );
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
  r: { k: string; ks: string[]; at?: [number, number, number] },
  byKey: Map<string, PayloadSeries>,
): string {
  const s = byKey.get(r.k)!;
  if (r.at)
    for (const k of r.ks) {
      const hit = byKey
        .get(k)
        ?.at?.find((x) => x[0] === r.at![0] && x[1] === r.at![1] && x[2] === r.at![2]);
      if (!hit) continue;
      const n = (hit[3] as PrintedExtra | undefined)?.n;
      return n ? shownLabel(n.replace(/:\s*second breakdown$/i, "")) : lineLabel(byKey.get(k)!);
    }
  return lineLabel(s);
}

/** Statement sections of a payload, in the company's order, arranged into groups (`arrange`). */
export function assembleStatements(p: IrPayload): Statement[] {
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
    const grouped = sameRows([...keys, ...extra], byKey, dr.places);
    const groupOf = new Map(grouped.filter((g) => set.has(g[0])).map((g) => [g[0], g]));
    const gone = grouped.filter((g) => !set.has(g[0]));
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
    const heads = new Map(cap?.heads ?? []);
    const blank = new Set(cap?.blank ?? []);
    const onTable = !dr.anchor.t.startsWith("p");
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
          if (h) between.push({ kind: "head", text: sentenceCase(h, keep), depth: 0 });
          else if (blank.has(i) || !cap) gap = true;
        }
        if (between.length) {
          if (gap || rows.at(-1)?.kind === "line") rows.push({ kind: "gap" });
          for (const h of between)
            rows.push({ ...h, depth: Math.max(0, depth - 1) } as StatementRow);
        } else if (gap) rows.push({ kind: "gap" });
      } else if (r != null && prevR == null && cap) {
        const before = [...heads.entries()].filter(([i]) => i < r && i >= r - 2);
        for (const [, h] of before)
          rows.push({ kind: "head", text: sentenceCase(h, keep), depth: Math.max(0, depth - 1) });
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
      });
    }
    const lines = keys.map((k) => byKey.get(k)!);
    const money = lines.filter((s) => s.unit === "usd");
    const div = mode(money.map(lineDiv)) ?? 1;
    const bds = lines.map((s) => s.bd).filter((x): x is string => !!x);
    const printed = cap?.title ? sentenceCase(cap.title, keep) : "";
    const bd = mode(bds);
    const cat = mode(lines.map((s) => s.cat)) ?? "kpi";
    const unitText = cap?.unit?.replace(/^\(|\)$/g, "").trim();
    const sec: Statement = {
      id: dr.anchor.id,
      title: printed || bd || CATEGORY_LABEL[cat] || cat,
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
      last: lines.reduce((m, s) => (lastEnd(s) > m ? lastEnd(s) : m), ""),
      first: lines.reduce((m, s) => (firstEnd(s) < m ? firstEnd(s) : m), "9999"),
      cat,
      doc: dr.anchor.d,
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
  const rankKind = (d: number) =>
    p.docs[d]?.kind === "supplement" ? 0 : p.docs[d]?.kind === "press-release" ? 1 : 2;
  const docs = [...lines.keys()];
  const newest = docs.reduce((m, d) => ((p.docs[d]?.filed ?? "") > m ? (p.docs[d]?.filed ?? "") : m), "");
  const lastDay = Date.parse(`${newest || "1970-01-01"}T00:00:00Z`);
  const recent = (d: number) => {
    const f = p.docs[d]?.filed;
    return !newest || (!!f && lastDay - Date.parse(`${f}T00:00:00Z`) <= RELEASE_DAYS * DAY_MS);
  };
  const main = docs
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
    for (const r of s.rows) if (r.kind === "line") rows.push({ ...r, depth: 0, total: false });
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
  const lead = byKey.get(ks[0]);
  const rowDiv = lead ? knownDiv(lead) : null;
  const fits = (c: PayloadCell) => {
    if (rowDiv == null) return true;
    const d = printedDiv(c);
    return d == null || d === rowDiv;
  };
  for (const [i, k] of ks.entries()) {
    const s = byKey.get(k);
    if (!s) continue;
    for (const [e, c] of Object.entries(cellsFor(s, freq)))
      if (!cells[e] && !held[e] && (i === 0 || fits(c))) {
        cells[e] = c;
        from[e] = k;
      }
    for (const [e, c] of Object.entries(heldFor(s, freq)))
      if (!cells[e] && !held[e] && (i === 0 || fits(c))) {
        held[e] = c;
        from[e] = k;
      }
  }
  if (at && (freq === "q" || freq === "y"))
    for (const k of ks) {
      const own = byKey
        .get(k)
        ?.at?.find((x) => x[0] === at[0] && x[1] === at[1] && x[2] === at[2] && x.length > 3);
      const v = (own?.[3] as PrintedExtra | undefined)?.v;
      if (!v) continue;
      for (const [key, [val, col, text]] of Object.entries(v)) {
        const [kind, e] = key.split(":");
        if (kind !== freq) continue;
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
    match?: (s: PayloadSeries) => boolean;
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
    if (current && (!opts.has || ss.some(opts.has)) && (!opts.match || ss.some(opts.match)))
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
  return "";
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
