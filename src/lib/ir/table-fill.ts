// Pure: table fill. The table reader stores only the rows a model picked (its prompt skips per-share
// data, tax, interest and consolidated lines outside a breakdown), so a printed statement can lack its
// interest income, provision, pretax income, tax, net income and per-share rows. Table fill reads those
// rows back from the stored document itself, with no model: every printed numeric row of a table the
// facts already cover in part, its name from the row's own label cells (a name wrapped over two printed
// rows joined), each figure from the period column the extracted facts of the same table (or, for a
// table with none, of the same column head elsewhere in the document) already sit in.
//
// Safety rules:
// - a column gets a period only when every fact in it agrees on one period end and length (a quarter
//   column may hold period-end balances beside flows, which take the length of the nearest rows);
//   two printed columns of the same period are both left out (restated pairs);
// - a cell is read only when it parses as one number in the table's convention (parentheses negative,
//   a dash zero only where the document says so, footnote letters and "NM" never), at most one cell per
//   period per row;
// - the unit and scale come from the row (a printed %, a per-share name), the rows printed around it
//   and the table's money scale (its facts, else its printed scale line); a row whose unit is not
//   certain is left out with its reason;
// - a position a fact already holds is never written; where the stored fact and the document disagree
//   at that position the fact stays and a conflict is recorded;
// - filled facts carry method "printed" and an id "printed:<doc>:<t>:<r>:<c>".
import type { IrFact } from "@/lib/ir/kpis";
import { normLabel } from "@/lib/ir/kpis";
import { parseNumber } from "@/lib/ir/tables";
import { stockKind } from "@/lib/ir/stock";
import { sentenceCase } from "@/lib/ir/table-captions";
import { parseGrid, type GridCell, type GridRow, type GridTable } from "@/lib/ir/table-grid";

export const FILL_METHOD = "printed";
/** Category of a filled row that no fact of its printed row names (kept apart from model-read lines). */
export const FILL_CATEGORY = "statement";

/** Why a printed numeric row is still not shown after the fill. */
export type MissReason =
  /** no column of the row's figures has a certain period */
  | "period"
  /** the row's unit or scale could not be told from the row, its neighbours or the table */
  | "unit"
  /** no label printed for the row */
  | "label"
  /** the same name twice in the table under the same heading */
  | "duplicate";

export interface FillConflict {
  doc: string;
  t: number;
  r: number;
  c: number;
  /** what the document prints at the position */
  printed: string;
  /** what the stored fact says it read there */
  stored: string;
  value: number;
  fact?: string;
}

export interface TableFill {
  doc: string;
  t: number;
  /** numeric rows the table prints (rows with a figure after its label, header rows excluded) */
  printed: number;
  /** of those, rows at least one stored fact covers */
  covered: number;
  /** rows added from the document */
  filled: number;
  /** cells added: in filled rows and in covered rows the reader left part-read */
  cells: number;
  /** printed numeric rows still without a figure, by reason */
  missing: Partial<Record<MissReason, number>>;
  /** those rows: [row, reason] */
  misses: [number, MissReason][];
  /**
   * Printed layout of each numeric and heading row: [row, indent level, flags (1 bold, 2 rule above, 4 filled),
   * printed name] (the row's own label cells, a wrapped name joined, footnote marks taken off).
   */
  style: [number, number, number, string][];
  /** label-only rows that are the first line of the next row's wrapped name (not headings) */
  wraps: number[];
}

export interface DocFill {
  facts: IrFact[];
  tables: TableFill[];
  conflicts: FillConflict[];
  /**
   * Stored facts corrected for what the document prints at their own position, same id: a negative printed
   * across two cells ("(32.5" then ")") stored positive (`locator.sign = "printed"`), or a figure stored under
   * another column's period (`locator.moved` = the stored period end).
   */
  fixes: IrFact[];
}

export interface FillInput {
  /** stored document id (facts' document_id) */
  doc: string;
  html: string;
  /** the stored facts of this document */
  facts: IrFact[];
  /** printed title and scale line per table index ("(in millions, except per share data)"), from table-captions */
  captions?: Map<number, { title?: string; unit?: string }>;
  /** table indexes to fill; default every table with at least two fact rows */
  only?: Set<number>;
}

interface Period {
  end: string;
  start: string | null;
  /** flow length of the column (3, 6, 9, 12) or 0 when it holds balances only */
  months: number;
  /** the column also holds period-end balances */
  point: boolean;
}

const SCALES = [1, 1e3, 1e6, 1e9];
const DASH = /^[—–-]+$/;
const FOOTNOTE = /(\s*(\((?:[a-z]{1,2}|\d{1,2}|[ivx]{1,4})\)|[*†‡§¹²³⁴⁵⁶⁷⁸⁹⁰]+))+\s*$/i;
const CURRENCY = /^[$€£¥%)(]+$/;
const PER_SHARE =
  /\bper (common |diluted |basic |ordinary |class [a-z] )?(share|unit|ads)\b|\beps\b|earnings per\b/i;
const SHARES = /\bshares\b|\bshare count\b/i;
const RATIO =
  /\bratios?\b|\brate\b|\breturn on\b|\bmargin\b|\byields?\b|\bpercent(age)?\b|%|\bcoverage\b|\befficiency\b|\bpayout\b/i;
const BPS = /\bbps\b|\bbasis points?\b/i;
const HEADCOUNT = /\bheadcount\b|\bemployees\b|\bbranches\b|\batms?\b|\bnumber of\b/i;
const SCALE_WORD = /\b(?:in|amounts in|dollars in|\$ in)\s+(thousands|millions|billions)\b/i;
const DANGLING =
  /(?:\s(?:or|and|of|to|for|the|in|on|by|with|from|at|a|an|nor|than|as|under|including|excluding|net)|[,&/-])$/i;

const cleanLabel = (s: string) =>
  s
    .replace(FOOTNOTE, "")
    .replace(/\s*:\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
/** A block heading as a name prefix: sentence case, words in parentheses kept (line keys drop parentheses). */
const blockName = (h: string) =>
  sentenceCase(
    h
      .replace(/\s*\(([^)]*)\)/g, " $1")
      .replace(/\s+/g, " ")
      .trim(),
  );
const squash = (s: string) => s.replace(/\s+/g, "");

/** Whether the text is a figure cell: one number, or a dash. */
const numberOf = (text: string): number | null => {
  const t = text.trim();
  if (!t || /^(19|20)\d{2}$/.test(t)) return null;
  // A lone footnote marker "(1)" next to a label is not a figure; a figure in parentheses carries a separator or more digits.
  return parseNumber(t);
};
/**
 * A figure cell's value in its row: a cell that opens a parenthesis around one number ("(32.5") and is closed
 * by a later cell (")", "%)", ")%") before the next figure is negative, whatever the cell alone reads as.
 */
export function cellValue(row: GridRow, c: number): number | null {
  const cell = row.cells[c];
  if (!cell) return null;
  const v = numberOf(cell.text);
  if (v == null) return null;
  if (openNegative(row, c)) return -Math.abs(v);
  return v;
}
const openNegative = (row: GridRow, c: number) => {
  const t = row.cells[c]?.text.trim() ?? "";
  if (!/^[$€£]?\s*\(\s*[$€£]?\s*\d[\d,]*(\.\d+)?\s*%?$/.test(t)) return false;
  for (const x of row.cells.slice(c + 1)) {
    const s = x.text.trim();
    if (!s) continue;
    return /^%?\)/.test(s);
  }
  return false;
};
const isFigure = (c: GridCell) => numberOf(c.text) != null || DASH.test(c.text.trim());
const overlaps = (a: GridCell, s: number, e: number) => a.col < e && a.col + a.span > s;

/** Label cells of a row: text before its first figure cell, currency marks left out. */
function labelOf(row: GridRow): { text: string; cell?: GridCell; firstFig: number } {
  const firstFig = row.cells.findIndex((c, i) => i > 0 && isFigure(c));
  const head = (firstFig < 0 ? row.cells : row.cells.slice(0, firstFig)).filter(
    (c) => c.text && !CURRENCY.test(c.text),
  );
  return {
    text: head
      .map((c) => c.plain)
      .join(" ")
      .trim(),
    cell: head[0],
    firstFig,
  };
}

const hasFigure = (row: GridRow) => labelOf(row).firstFig > 0;

/** Header key per grid column: text of the header cells over it, label column left out. */
function headerKeys(table: GridTable, first: number): Map<number, string> {
  const parts = new Map<number, string[]>();
  for (const row of table.rows.slice(0, first)) {
    if (row.hidden) continue;
    for (const c of row.cells) {
      if (!c.text || c.col === 0) continue;
      for (let g = c.col; g < c.col + c.span; g++) parts.set(g, [...(parts.get(g) ?? []), c.text]);
    }
  }
  return new Map([...parts].map(([g, xs]) => [g, xs.join("|").replace(/\s+/g, " ").toLowerCase()]));
}
const keyOver = (keys: Map<number, string>, c: GridCell): string | null => {
  const a = keys.get(c.col);
  const b = keys.get(c.col + c.span - 1);
  return a && a === b && /\d/.test(a) ? a : null;
};

const periodId = (p: { end: string; months: number }) => `${p.end}/${p.months}`;

/** The period a set of facts sitting in one column agrees on, or null when they disagree. */
/**
 * The period of one printed column from the facts in it: every fact agrees, or at least three rows and three
 * quarters of them agree and the others are the reader's slips (`outliers`, a row mapped to another column's period).
 */
function agreedMajority(fs: IrFact[]): { p: Period; outliers: IrFact[] } | null {
  const all = agreed(fs);
  if (all) return { p: all, outliers: [] };
  const byEnd = new Map<string, IrFact[]>();
  for (const f of fs) byEnd.set(f.period_end, [...(byEnd.get(f.period_end) ?? []), f]);
  const [end, main] = [...byEnd.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  const rows = new Set(main.map((f) => (f.locator as { r: number }).r));
  if (rows.size < 3 || main.length < 0.75 * fs.length) return null;
  const p = agreed(main);
  if (!p) return null;
  return { p: { ...p, end }, outliers: fs.filter((f) => f.period_end !== end) };
}

function agreed(fs: IrFact[]): Period | null {
  const ends = new Set(fs.map((f) => f.period_end));
  if (ends.size !== 1) return null;
  const flows = new Set(fs.filter((f) => f.months > 0).map((f) => f.months));
  if (flows.size > 1) return null;
  const months = [...flows][0] ?? 0;
  const start = fs.find((f) => f.months === months && f.period_start)?.period_start ?? null;
  return { end: [...ends][0], start, months, point: fs.some((f) => f.months === 0) };
}

interface KnownPeriods {
  /** "<end>/<months>" → period start, for every flow period the document's facts use */
  flows: Map<string, string | null>;
  /** every period end the document's facts use */
  ends: Set<string>;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};
const LENGTH: [RegExp, number][] = [
  [/\b(three|3)[- ]months?\b|\bquarters? ended\b|\bthirteen weeks\b|\b13 weeks\b/i, 3],
  [/\b(six|6)[- ]months?\b|\btwenty[- ]six weeks\b|\b26 weeks\b/i, 6],
  [/\b(nine|9)[- ]months?\b|\bthirty[- ]nine weeks\b|\b39 weeks\b/i, 9],
  [
    /\b(twelve|12)[- ]months?\b|\byears? ended\b|\bfiscal years?\b|\bfifty[- ]t(wo|hree) weeks\b|\b5[23] weeks\b/i,
    12,
  ],
];

/**
 * A column's period from its printed head alone, strictly: one full date ("September 26, 2026", "Sep 30, | 2026")
 * and at most one length phrase in the head or the table's title. A flow column is accepted only when its end
 * and length are a period the document's facts already use; a column with no length phrase (or "as of") is a
 * balance column, accepted only when its date is a period end the facts use. Anything else is refused (null).
 */
export function printedHead(key: string, title: string, known: KnownPeriods): Period | null {
  const head = key.replace(/\|/g, " ");
  if (/\bchange\b|%|\bvs\.?\b|\bvariance\b/i.test(head)) return null;
  const dates = [
    ...head.matchAll(
      /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+((?:19|20)\d{2})\b/gi,
    ),
  ];
  if (dates.length !== 1) return null;
  const [, mon, day, year] = dates[0];
  const end = `${year}-${String(MONTHS[mon.toLowerCase().slice(0, 3)]).padStart(2, "0")}-${day.padStart(2, "0")}`;
  const own = LENGTH.filter(([re]) => re.test(head)).map(([, m]) => m);
  if (own.length > 1) return null;
  let months = own[0];
  if (months == null && !/\bas of\b/i.test(head)) {
    const wide = LENGTH.filter(([re]) => re.test(title)).map(([, m]) => m);
    if (wide.length > 1) return null;
    months = wide[0];
  }
  if (months == null || /\bas of\b/i.test(head))
    return known.ends.has(end) ? { end, start: null, months: 0, point: true } : null;
  const id = `${end}/${months}`;
  if (!known.flows.has(id)) return null;
  return { end, start: known.flows.get(id) ?? null, months, point: false };
}

interface Located {
  f: IrFact;
  t: number;
  r: number;
  c: number;
  cell: GridCell;
}

/** First figure row of a table (header rows sit above it). */
const firstFigureRow = (t: GridTable) =>
  t.rows.findIndex((r) => !r.hidden && hasFigure(r) && labelOf(r).text.length > 0);

const unitScale = (f: IrFact, text: string): number | null => {
  const n = numberOf(text);
  if (n == null || n === 0) return null;
  const s = Math.abs(f.value / n);
  return SCALES.find((x) => Math.abs(s / x - 1) < 1e-6) ?? null;
};

const mode = <T>(xs: T[]): T | undefined => {
  const n = new Map<T, number>();
  for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1);
  let best: T | undefined;
  let k = 0;
  for (const [x, c] of n)
    if (c > k) {
      best = x;
      k = c;
    }
  return best;
};

/** Whether the document defines a dash as zero ("— Not applicable" defines it otherwise). */
export function dashMeansZero(html: string): boolean {
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/\s+/g, " ");
  return /(?:^|[\s(])(?:—|–|&mdash;|&#8212;|dash(?:es)?)\s*(?:=|represents?|indicates?|denotes?|means?|is used (?:to indicate|for))\s*(?:a )?(?:zero|nil|none|\$?0\b|amounts? (?:of|equal to) zero)/i.test(
    text,
  );
}

/** Fill one stored document's tables from its own markup. */
export function fillDocument(input: FillInput): DocFill {
  const grid = parseGrid(input.html);
  const zeroDash = dashMeansZero(input.html);
  const located: Located[] = [];
  for (const f of input.facts) {
    const l = f.locator as { t?: number; r?: number; c?: number };
    if (typeof l.t !== "number" || typeof l.r !== "number" || typeof l.c !== "number") continue;
    const cell = grid[l.t]?.rows[l.r]?.cells[l.c];
    if (cell) located.push({ f, t: l.t, r: l.r, c: l.c, cell });
  }
  const byTable = new Map<number, Located[]>();
  for (const x of located) byTable.set(x.t, [...(byTable.get(x.t) ?? []), x]);

  // Column heads → period, learned from every column a table's facts settle; a head two periods share is unusable.
  const dict = new Map<string, Period | null>();
  // Stored facts corrected for what the document prints at their own position (sign, column period).
  const fixes: IrFact[] = [];
  const colPeriods = new Map<number, { s: number; e: number; p: Period; n: number }[]>();
  for (const [t, xs] of byTable) {
    const table = grid[t];
    const first = firstFigureRow(table);
    const keys = headerKeys(table, Math.max(0, first));
    // Group facts by the grid columns they cover; a fact's cell spans one or more grid columns.
    const cols: { s: number; e: number; fs: IrFact[]; rows: Set<number> }[] = [];
    for (const x of [...xs].sort((a, b) => a.cell.col - b.cell.col)) {
      const s = x.cell.col;
      const e = x.cell.col + x.cell.span;
      const hit = cols.find((g) => g.s < e && g.e > s);
      if (hit) {
        hit.s = Math.min(hit.s, s);
        hit.e = Math.max(hit.e, e);
        hit.fs.push(x.f);
        hit.rows.add(x.r);
      } else cols.push({ s, e, fs: [x.f], rows: new Set([x.r]) });
    }
    const out: { s: number; e: number; p: Period; n: number }[] = [];
    for (const g of cols) {
      const got = agreedMajority(g.fs);
      if (!got || g.rows.size < 2) continue;
      const p = got.p;
      // A stored figure in this column under another column's period: the column's period is the printed one.
      for (const f of got.outliers)
        if (f.months === 0 || f.months === p.months)
          fixes.push({
            ...f,
            period_end: p.end,
            period_start: f.months > 0 ? p.start : null,
            locator: {
              ...(f.locator as object),
              moved: f.period_end,
            } as unknown as IrFact["locator"],
          });
      out.push({ s: g.s, e: g.e, p, n: g.rows.size });
      for (const x of xs.filter((y) => y.cell.col >= g.s && y.cell.col < g.e)) {
        const k = keyOver(keys, x.cell);
        if (!k) continue;
        const had = dict.get(k);
        if (had === undefined) dict.set(k, p);
        else if (had) {
          // One head over a quarter's flows in one table and its period-end balances in another is one column.
          if (had.end !== p.end || (had.months && p.months && had.months !== p.months))
            dict.set(k, null);
          else if (!had.months && p.months) dict.set(k, { ...p, point: true });
          else if (had.months && !p.months) dict.set(k, { ...had, point: true });
        }
      }
    }
    // Two printed columns of one period (as reported and restated): neither is read.
    const seen = new Map<string, number>();
    for (const c of out) seen.set(periodId(c.p), (seen.get(periodId(c.p)) ?? 0) + 1);
    colPeriods.set(
      t,
      out.filter((c) => seen.get(periodId(c.p)) === 1),
    );
  }

  // Money facts of the document by period end and printed text, with their scales (for tables printing no scale).
  const usdIndex = new Map<string, Set<number>>();
  for (const x of located) {
    if (x.f.unit !== "usd") continue;
    const sc = unitScale(x.f, x.cell.text);
    if (sc == null || Math.abs(numberOf(x.cell.text) ?? 0) < 100) continue;
    const k = `${x.f.period_end}|${squash(x.cell.text)}`;
    usdIndex.set(k, new Set([...(usdIndex.get(k) ?? []), sc]));
  }
  const facts: IrFact[] = [];
  const tables: TableFill[] = [];
  const conflicts: FillConflict[] = [];
  const any = input.facts[0];
  // Periods the document's facts already use: a printed head may only name one of these.
  const known: KnownPeriods = { flows: new Map(), ends: new Set() };
  for (const f of input.facts) {
    known.ends.add(f.period_end);
    if (f.months > 0) known.flows.set(`${f.period_end}/${f.months}`, f.period_start ?? null);
  }
  // Tables the facts cover in part, and tables no fact sits in whose column heads the document settles.
  const want = (t: number) => {
    if (input.only && !input.only.has(t)) return false;
    const xs = byTable.get(t) ?? [];
    const rows = new Set(xs.map((x) => x.r)).size;
    if (rows >= 2) return true;
    if (rows) return false;
    const table = grid[t];
    const first = firstFigureRow(table);
    if (first < 0) return false;
    const keys = headerKeys(table, first);
    const words = input.captions?.get(t)?.title ?? "";
    const settled = new Set(
      [...keys.values()].filter(
        (k) => /\d/.test(k) && (dict.get(k) || printedHead(k, words, known)),
      ),
    );
    return settled.size >= 2;
  };

  for (const table of grid) {
    const t = table.index;
    if (!want(t)) continue;
    const xs = byTable.get(t) ?? [];
    const first = firstFigureRow(table);
    if (first < 0) continue;
    const keys = headerKeys(table, first);
    const own = colPeriods.get(t) ?? [];
    const cap0 = input.captions?.get(t);
    // A length phrase printed over the whole table (its title, or a head in the label column).
    const lengthWords = [
      cap0?.title ?? "",
      ...table.rows
        .slice(0, first)
        .flatMap((r) => r.cells.filter((c) => c.col === 0).map((c) => c.text)),
    ].join(" ");
    const factAt = new Map(xs.map((x) => [`${x.r}:${x.c}`, x]));
    const rowsWithFacts = new Set(xs.map((x) => x.r));
    const report: TableFill = {
      doc: input.doc,
      t,
      printed: 0,
      covered: 0,
      filled: 0,
      cells: 0,
      missing: {},
      misses: [],
      style: [],
      wraps: [],
    };
    let cur = -1;
    const miss = (why: MissReason, row = cur) => {
      report.missing[why] = (report.missing[why] ?? 0) + 1;
      report.misses.push([row, why]);
    };

    // The period of a figure cell: the table's own fact column, else a column head the document settles.
    const periodOf = (c: GridCell): Period | null => {
      const hits = own.filter((g) => overlaps(c, g.s, g.e));
      if (hits.length === 1) return hits[0].p;
      if (hits.length > 1) return null;
      // A column no fact of this table sits in: only by its head, and only when no own column shares that head.
      const k = keyOver(keys, c);
      if (!k) return null;
      const p = dict.get(k) ?? printedHead(k, lengthWords, known);
      if (!p) return null;
      if (own.some((g) => g.p.end === p.end && g.p.months === p.months)) return null;
      return p;
    };

    // Conflicts: the stored text at each fact position against what the document prints there.
    for (const x of xs) {
      const stored = String((x.f.locator as { text?: string }).text ?? "");
      // A negative printed across two cells ("(32.5" then ")") stored as a positive of the same size: the print wins.
      const row = table.rows[x.r];
      if (openNegative(row, x.c) && x.f.value > 0 && squash(stored) === squash(x.cell.text)) {
        fixes.push({
          ...x.f,
          value: -x.f.value,
          locator: {
            ...(x.f.locator as object),
            text: x.cell.text,
            sign: "printed",
          } as unknown as IrFact["locator"],
        });
        continue;
      }
      if (
        squash(stored) !== squash(x.cell.text) ||
        (numberOf(x.cell.text) != null && unitScale(x.f, x.cell.text) == null && x.f.value !== 0)
      )
        conflicts.push({
          doc: input.doc,
          t,
          r: x.r,
          c: x.c,
          printed: x.cell.text,
          stored,
          value: x.f.value,
          fact: x.f.id,
        });
    }

    // The table's money scale: its usd facts, else its printed scale line.
    const usdScales = xs
      .filter((x) => x.f.unit === "usd")
      .map((x) => unitScale(x.f, x.cell.text))
      .filter((s): s is number => s != null);
    const cap = input.captions?.get(t);
    const capWord = cap?.unit?.match(SCALE_WORD)?.[1]?.toLowerCase();
    const capScale =
      capWord === "thousands"
        ? 1e3
        : capWord === "millions"
          ? 1e6
          : capWord === "billions"
            ? 1e9
            : null;
    // Share counts: the scale the scale line gives them ("number of shares, which are reflected in thousands"),
    // none when it sets them apart without one ("except shares"), else the table's scale.
    const capText = cap?.unit ?? "";
    const shareWord = capText
      .match(/(?<!per )\bshares?\b[^)]*?\b(thousands|millions|billions)\b/i)?.[1]
      ?.toLowerCase();
    const shareScale = shareWord
      ? shareWord === "thousands"
        ? 1e3
        : shareWord === "millions"
          ? 1e6
          : 1e9
      : /except[^)]*(?<!per )\bshares?\b/i.test(capText)
        ? null
        : capScale;
    let moneyScale = mode(usdScales) ?? capScale;
    // A table with no scale of its own (no money fact, no scale line found): the scale of the stored money facts
    // of this document that print the same figure for the same period, when at least two agree and none differ.
    if (moneyScale == null) {
      const seen = new Set<number>();
      let hits = 0;
      for (let r = first; r < table.rows.length; r++) {
        const row = table.rows[r];
        if (row.hidden) continue;
        for (const cell of row.cells) {
          if (cell.col === 0 || numberOf(cell.text) == null) continue;
          const p = periodOf(cell);
          if (!p) continue;
          const sc = usdIndex.get(`${p.end}|${squash(cell.text)}`);
          if (!sc) continue;
          hits++;
          for (const x of sc) seen.add(x);
        }
      }
      if (hits >= 2 && seen.size === 1) moneyScale = [...seen][0];
    }
    const intOnly = xs.filter((x) => x.f.unit === "usd").every((x) => !/\.\d/.test(x.cell.text));
    // Table name of the filled lines: the readers' own name for the table, else its printed title.
    const bd =
      mode(xs.map((x) => x.f.breakdown).filter((b): b is string => !!b)) ?? cap?.title ?? null;
    const rowFacts = new Map<number, IrFact[]>();
    for (const x of xs) rowFacts.set(x.r, [...(rowFacts.get(x.r) ?? []), x.f]);
    const factRows = [...rowFacts.keys()].sort((a, b) => a - b);
    const unitOfRow = (r: number) => mode((rowFacts.get(r) ?? []).map((f) => f.unit));

    // Indent levels: distinct label indents of the printed rows, smallest first.
    const indents = [
      ...new Set(
        table.rows
          .slice(first)
          .filter((r) => !r.hidden)
          .map((r) => labelOf(r).cell?.indent ?? 0),
      ),
    ].sort((a, b) => a - b);
    const levelOf = (x: number) => Math.max(0, indents.indexOf(x));
    const numericAt = table.rows
      .map((row, i) => (i >= first && !row.hidden && hasFigure(row) ? i : -1))
      .filter((i) => i >= 0);
    // The block heading printed just above the first figure row (between the column heads and the figures).
    let heading = "";
    for (let i = first - 1; i >= Math.max(0, first - 3); i--) {
      const row = table.rows[i];
      if (row.hidden) continue;
      const texts = row.cells.filter((c) => c.text && !CURRENCY.test(c.text));
      if (texts.length === 1 && texts[0].col === 0 && !/\d/.test(texts[0].text)) {
        heading = cleanLabel(texts[0].text);
        break;
      }
      if (texts.length) break;
    }
    // Label-only rows just above: one heading, or the first lines of a name wrapped over several printed rows.
    const names = new Map<number, string>();
    type LabelRun = { r: number; rows: number[]; text: string; before: string };
    let prevLabelOnly = null as LabelRun | null;
    const pending: {
      r: number;
      facts: IrFact[];
      name: string;
      heading: string;
      unit: string;
      style: [number, number, number, string];
    }[] = [];
    let prevRow: GridRow | null = null;
    // Unit of the last numeric row read (stored or filled): a percent printed on a block's first row only holds down the block.
    let prevUnit: string | undefined;
    let prevScale: number | null = null;
    let prevLabel = "";
    let prevR = -1;

    for (let r = first; r < table.rows.length; r++) {
      const row = table.rows[r];
      if (row.hidden) continue;
      const lab = labelOf(row);
      const figs = row.cells.filter(
        (c, i) => i > 0 && lab.firstFig > 0 && i >= lab.firstFig && isFigure(c),
      );
      const ruleAbove =
        figs.some((c) => c.ruleTop) ||
        (prevRow?.cells.some((c) => c.ruleBottom && isFigure(c)) ?? false);
      if (!figs.length) {
        const text = lab.text || row.cells.find((c) => c.text)?.text || "";
        if (text && !/\d/.test(text.replace(FOOTNOTE, ""))) {
          const line = cleanLabel(text);
          names.set(r, line);
          report.style.push([r, levelOf(lab.cell?.indent ?? 0), lab.cell?.bold ? 1 : 0, line]);
          if (
            prevLabelOnly &&
            prevLabelOnly.r === r - 1 &&
            (DANGLING.test(prevLabelOnly.text) || /^[a-z(]/.test(line))
          )
            prevLabelOnly = {
              ...prevLabelOnly,
              r,
              rows: [...prevLabelOnly.rows, r],
              text: `${prevLabelOnly.text} ${line}`,
            };
          else prevLabelOnly = { r, rows: [r], text: line, before: heading };
          heading = prevLabelOnly.text;
        } else if (!text) prevLabelOnly = null;
        prevRow = row;
        continue;
      }
      report.printed++;
      cur = r;
      // A name wrapped over two printed rows: the label-only row above ends mid-phrase, or this row's part starts in lower case or is empty.
      let label = cleanLabel(lab.text);
      if (
        prevLabelOnly &&
        prevLabelOnly.r === r - 1 &&
        (DANGLING.test(prevLabelOnly.text) || !label || /^[a-z(]/.test(label))
      ) {
        label = `${prevLabelOnly.text} ${label}`.trim();
        report.wraps.push(...prevLabelOnly.rows);
        heading = prevLabelOnly.before;
      }
      prevLabelOnly = null;
      prevRow = row;
      names.set(r, label);
      const covered = rowsWithFacts.has(r);
      const bold = !!lab.cell?.bold || figs.some((c) => c.bold);
      const flags = (bold ? 1 : 0) | (ruleAbove ? 2 : 0);

      // Cells of the row by period; two cells of one period leave that period out.
      const cells = new Map<string, { c: number; cell: GridCell; p: Period } | null>();
      row.cells.forEach((cell, c) => {
        if (lab.firstFig < 0 || c < lab.firstFig || !isFigure(cell)) return;
        const p = periodOf(cell);
        if (!p) return;
        const id = periodId(p);
        cells.set(id, cells.has(id) ? null : { c, cell, p });
      });
      const usable = [...cells.values()].filter(
        (x): x is { c: number; cell: GridCell; p: Period } => !!x,
      );
      // A percent sign printed with a figure of a period column (in its cell or the cell right after it), not a change column's.
      const pctPrinted = usable.some(
        (u) =>
          /\d\s*%$/.test(u.cell.text.trim()) ||
          row.cells
            .slice(u.c + 1)
            .find((c) => c.text.trim())
            ?.text.trim() === "%",
      );

      if (covered) {
        report.covered++;
        // Part-read rows: the reader's own fields, for the periods it left out.
        const own = rowFacts.get(r)!;
        const tmpl = own[0];
        const units = new Set(own.map((f) => f.unit));
        const scales = new Set(
          own.map((f) => unitScale(f, String((f.locator as { text?: string }).text ?? ""))),
        );
        const keysSame = new Set(
          own.map(
            (f) => `${f.category}|${f.metric}|${f.label}|${f.parent ?? ""}|${f.breakdown ?? ""}`,
          ),
        );
        if (units.size === 1 && scales.size === 1 && !scales.has(null) && keysSame.size === 1) {
          const scale = [...scales][0]!;
          const have = new Set(
            own.map((f) => periodId({ end: f.period_end, months: f.months > 0 ? f.months : 0 })),
          );
          const haveCells = new Set(own.map((f) => (f.locator as { c: number }).c));
          for (const u of usable) {
            if (haveCells.has(u.c) || factAt.has(`${r}:${u.c}`)) continue;
            const months = own.every((f) => f.months === 0) ? 0 : u.p.months;
            if (months === 0 && !u.p.point && !own.every((f) => f.months === 0)) continue;
            if (have.has(periodId({ end: u.p.end, months }))) continue;
            const v = cellValue(row, u.c) ?? (zeroDash && DASH.test(u.cell.text.trim()) ? 0 : null);
            if (v == null) continue;
            facts.push(made(tmpl, input.doc, t, r, u.c, u.cell.text, v * scale, u.p, months));
            report.cells++;
          }
        }
        report.style.push([r, levelOf(lab.cell?.indent ?? 0), flags, names.get(r) ?? ""]);
        prevUnit = unitOfRow(r);
        prevScale =
          mode(
            own
              .map((f) => unitScale(f, String((f.locator as { text?: string }).text ?? "")))
              .filter((v): v is number => v != null),
          ) ?? null;
        prevLabel = own[0].label;
        prevR = r;
        continue;
      }

      if (!label) {
        miss("label");
        report.style.push([r, levelOf(lab.cell?.indent ?? 0), flags, names.get(r) ?? ""]);
        continue;
      }
      if (!usable.length) {
        miss("period");
        report.style.push([r, levelOf(lab.cell?.indent ?? 0), flags, names.get(r) ?? ""]);
        continue;
      }
      // Unit and scale: the row itself, then the rows printed around it, then the table.
      const above = [...factRows].reverse().find((x) => x < r);
      const below = factRows.find((x) => x > r);
      const nb = [above, below].filter((x): x is number => x != null).map(unitOfRow);
      // Stored rows right next to this one (no other printed figure row between) set a block's convention.
      const numericRows = numericAt;
      const adjacent = [above, below]
        .filter(
          (x): x is number =>
            x != null && !numericRows.some((y) => y > Math.min(x, r) && y < Math.max(x, r)),
        )
        .map(unitOfRow);
      const nbScale = (unit: string) => {
        for (const x of [above, below]) {
          if (x == null || unitOfRow(x) !== unit) continue;
          const s = mode(
            (rowFacts.get(x) ?? [])
              .map((f) => unitScale(f, String((f.locator as { text?: string }).text ?? "")))
              .filter((v): v is number => v != null),
          );
          if (s != null) return s;
        }
        return null;
      };
      let unit: string | null = null;
      let scale: number | null = null;
      // "Average shares: Basic" then "Diluted": the second row is printed under the first one's lead-in.
      const lead =
        /^[^:]{3,60}:\s+\S/.test(prevLabel) &&
        !label.includes(":") &&
        label.split(" ").length <= 2 &&
        prevR === r - 1
          ? prevLabel.slice(0, prevLabel.indexOf(":") + 1)
          : "";
      const dollar = usable.some(
        (u) =>
          /^\$/.test(u.cell.text.trim()) ||
          row.cells
            .slice(0, u.c)
            .reverse()
            .find((c) => c.text.trim())
            ?.text.trim() === "$",
      );
      const decimals = usable.some((u) => /\.\d/.test(u.cell.text));
      // A percent never prints a thousands separator, nor a currency sign.
      const pctLike = !dollar && usable.every((u) => !/\d,\d{3}/.test(u.cell.text));
      const context = `${lead} ${label}`;
      // A short name ("Basic", "Diluted") reads with its block heading ("Shares used in computing earnings per share:").
      const short =
        /^(basic|diluted|basic and diluted|weighted[- ]average)$/i.test(label) && !lead
          ? heading
          : "";
      if (lead && prevUnit && prevScale != null) {
        unit = prevUnit;
        scale = prevScale;
      } else if (short && SHARES.test(short.replace(PER_SHARE, ""))) {
        if (shareScale != null) [unit, scale] = ["count", shareScale];
      } else if (short && PER_SHARE.test(short)) {
        unit = "usdPerShare";
        scale = 1;
      } else if (PER_SHARE.test(context) && !SHARES.test(label.replace(PER_SHARE, ""))) {
        unit = "usdPerShare";
        scale = 1;
      } else if (dollar && decimals && moneyScale != null && moneyScale > 1 && intOnly) {
        // A dollar figure with cents in a table of whole millions is a per-share figure.
        unit = "usdPerShare";
        scale = 1;

        unit = "usdPerShare";
        scale = 1;
      } else if (pctPrinted) {
        unit = "pct";
        scale = 1;
      } else if (BPS.test(label)) {
        if (nb.includes("bps")) [unit, scale] = ["bps", 1];
      } else if (SHARES.test(`${lead} ${label}`)) {
        if (nb.includes("count")) [unit, scale] = ["count", nbScale("count")];
        else if (shareScale != null) [unit, scale] = ["count", shareScale];
      } else if (HEADCOUNT.test(label)) {
        if (nb.includes("count")) [unit, scale] = ["count", nbScale("count")];
      } else if (
        !dollar &&
        decimals &&
        intOnly &&
        prevUnit === "usdPerShare" &&
        moneyScale != null &&
        moneyScale > 1
      ) {
        unit = "usdPerShare";
        scale = 1;
      } else if (
        pctLike &&
        row.cells.some((c) => /^bps$/i.test(c.text.trim())) &&
        usable.every((u) => Math.abs(numberOf(u.cell.text) ?? 0) < 1000)
      ) {
        // Change columns in basis points: the row's figures are percentages.
        unit = "pct";
        scale = 1;
      } else if (RATIO.test(label) && pctLike) {
        // A ratio row whose change columns print basis points, or one printing decimals in a table of whole
        // money figures, is a percentage.
        const bpsChange = row.cells.some((c) => /^bps$/i.test(c.text.trim()));
        const small = usable.every((u) => Math.abs(numberOf(u.cell.text) ?? 0) < 1000);
        if (pctLike && nb.includes("pct")) [unit, scale] = ["pct", 1];
        else if (pctLike && nb.includes("ratio")) [unit, scale] = ["ratio", 1];
        else if (pctLike && small && (bpsChange || (decimals && intOnly && usdScales.length > 0)))
          [unit, scale] = ["pct", 1];
      } else if (pctLike && adjacent.length && adjacent.every((u) => u === "pct")) {
        unit = "pct";
        scale = 1;
      } else if (pctLike && prevUnit === "pct" && decimals && intOnly && usdScales.length) {
        unit = "pct";
        scale = 1;
      } else if (
        moneyScale != null &&
        !(decimals && moneyScale > 1 && intOnly && usdScales.length)
      ) {
        unit = "usd";
        scale = nbScale("usd") ?? moneyScale;
      }
      // A scale printed in the row's own name ("Total payments transaction volume (in trillions)") wins for money and counts.
      const own = label
        .match(/\(\s*(?:\$\s*)?in\s+(thousands|millions|billions|trillions)\b[^)]*\)/i)?.[1]
        ?.toLowerCase();
      if (own && (unit === "usd" || unit === "count"))
        scale = { thousands: 1e3, millions: 1e6, billions: 1e9, trillions: 1e12 }[
          own as "thousands"
        ];
      if (!unit || scale == null) {
        miss("unit");
        report.style.push([r, levelOf(lab.cell?.indent ?? 0), flags, names.get(r) ?? ""]);
        continue;
      }
      // One series per printed name in a table: repeated names take their block headings after the pass.
      const name = lead ? `${lead} ${label}` : label;
      const rowOut: IrFact[] = [];
      for (const u of usable) {
        const v = cellValue(row, u.c) ?? (zeroDash && DASH.test(u.cell.text.trim()) ? 0 : null);
        if (v == null) continue;
        // A quarter column holding balances beside flows: the row takes the length of the rows printed around it.
        let months = u.p.months;
        // The shared balance rule on the row's own name (a table titled "... balance sheet items" also prints flows).
        // An opening balance belongs to its column's period, never to the period's end date.
        const opening = /\bbeginning\b|\bopening\b|\bstart of\b/i.test(name);
        const kind = opening
          ? null
          : stockKind({ category: FILL_CATEGORY, metric: "other", label: name });
        if (kind === "point") months = 0;
        else if (opening && u.p.point && u.p.months === 0) continue;
        else if (u.p.point && u.p.months > 0) {
          const near = [above, below]
            .filter((x): x is number => x != null)
            .map(
              (x) =>
                xs.find((y) => y.r === x && overlaps(y.cell, u.cell.col, u.cell.col + u.cell.span))
                  ?.f.months,
            )
            .filter((m): m is number => m != null);
          const ms = new Set(near);
          if (ms.size > 1) continue;
          // No row around it prints the period: the shared balance rule decides (stock.ts), as for every line.
          months = ms.size ? [...ms][0] : u.p.months;
        }
        const tmpl: IrFact = {
          category: FILL_CATEGORY,
          metric: "other",
          breakdown: bd,
          parent: null,
          label: name,
          is_total: false,
          period_start: null,
          period_end: u.p.end,
          months,
          value: 0,
          unit,
          accn: any?.accn ?? null,
          doc: any?.doc ?? null,
          filed: any?.filed ?? null,
          document_kind: any?.document_kind ?? null,
          locator: {},
        };
        rowOut.push(
          made(
            tmpl,
            input.doc,
            t,
            r,
            u.c,
            u.cell.text,
            v * (unit === "usd" || unit === "count" ? scale : 1),
            u.p,
            months,
          ),
        );
      }
      // A row printing the same nonzero figure for a quarter and the year to date that ends with it is a balance
      // (market capitalization, shares at period end): every figure of the row is a point in time.
      const repeats = rowOut.some((a) =>
        rowOut.some(
          (b) =>
            a !== b &&
            a.period_end === b.period_end &&
            a.months === 3 &&
            b.months > 3 &&
            a.value === b.value &&
            a.value !== 0,
        ),
      );
      if (repeats) for (const f of rowOut) Object.assign(f, { months: 0, period_start: null });
      // One figure per period: a balance printed in both the quarter and the year-to-date column is read once,
      // and a period printed twice with different figures is left out.
      const byPeriod = new Map<string, IrFact[]>();
      for (const f of rowOut) {
        const id = periodId({ end: f.period_end, months: f.months });
        byPeriod.set(id, [...(byPeriod.get(id) ?? []), f]);
      }
      // A balance read from a quarter column and a year-to-date column of the same end: the quarter column's own
      // figure stands (the other is the year's opening or a repeat); two quarter columns that disagree are both left out.
      const colMonths = new Map(usable.map((u) => [u.c, u.p.months]));
      rowOut.splice(
        0,
        rowOut.length,
        ...[...byPeriod.values()].flatMap((fs) => {
          if (fs.every((f) => f.value === fs[0].value)) return [fs[0]];
          const short = Math.min(
            ...fs.map((f) => colMonths.get((f.locator as { c: number }).c) ?? 99),
          );
          const own = fs.filter(
            (f) => (colMonths.get((f.locator as { c: number }).c) ?? 99) === short,
          );
          return own.length === 1 ? own : [];
        }),
      );
      if (!rowOut.length) {
        miss("period");
        report.style.push([r, levelOf(lab.cell?.indent ?? 0), flags, names.get(r) ?? ""]);
        continue;
      }
      prevUnit = unit;
      prevScale = scale;
      prevLabel = name;
      prevR = r;
      const st: [number, number, number, string] = [
        r,
        levelOf(lab.cell?.indent ?? 0),
        flags | 4,
        label,
      ];
      report.style.push(st);
      pending.push({ r, facts: rowOut, name, heading, unit, style: st });
    }
    // A name the table prints twice (the same adjustment under each block) is named with its block heading,
    // every time; names still repeated are left out.
    const keyOf = (n: string, u: string) => `${normLabel(n)}|${u}`;
    const count = new Map<string, number>();
    for (const p of pending)
      count.set(keyOf(p.name, p.unit), (count.get(keyOf(p.name, p.unit)) ?? 0) + 1);
    const parentOf = new Map<(typeof pending)[number], string>();
    for (const p of pending) {
      if ((count.get(keyOf(p.name, p.unit)) ?? 0) <= 1) continue;
      const same = pending.filter((o) => keyOf(o.name, o.unit) === keyOf(p.name, p.unit));
      // Names that differ only inside parentheses ("Loan-to-deposit ratio (period-end balances)" and
      // "(average balances)") keep their printed names; the words in parentheses tell the lines apart.
      const inner = (n: string) =>
        [...n.matchAll(/\(([^)]*)\)/g)].map((m) => m[1].trim()).join(" ");
      if (
        new Set(same.map((o) => normLabel(inner(o.name)))).size === same.length &&
        inner(p.name)
      ) {
        parentOf.set(p, inner(p.name));
        continue;
      }
      p.name = p.heading ? `${blockName(p.heading)} — ${p.name}` : "";
    }
    const keyOf2 = (p: (typeof pending)[number]) =>
      `${keyOf(p.name, p.unit)}|${normLabel(parentOf.get(p) ?? "")}`;
    const again = new Map<string, number>();
    for (const p of pending) if (p.name) again.set(keyOf2(p), (again.get(keyOf2(p)) ?? 0) + 1);
    for (const p of pending) {
      if (!p.name || (again.get(keyOf2(p)) ?? 0) > 1) {
        miss("duplicate", p.r);
        p.style[2] &= ~4;
        continue;
      }
      for (const f of p.facts) {
        f.label = p.name;
        // The words in parentheses ride as the line's parent name, which no line carries: it keys the line only.
        if (parentOf.has(p)) f.parent = parentOf.get(p)!;
      }
      facts.push(...p.facts);
      report.filled++;
      report.cells += p.facts.length;
    }
    tables.push(report);
  }
  // One correction per fact: a sign fix of a moved fact carries both.
  const byId = new Map<string, IrFact>();
  for (const f of fixes) {
    const had = f.id ? byId.get(f.id) : undefined;
    if (!f.id) continue;
    byId.set(
      f.id,
      had
        ? {
            ...had,
            value: Math.sign(f.value) < 0 ? f.value : had.value,
            period_end:
              had.period_end !== f.period_end && (f.locator as { moved?: string }).moved
                ? f.period_end
                : had.period_end,
            locator: {
              ...(had.locator as object),
              ...(f.locator as object),
            } as unknown as IrFact["locator"],
          }
        : f,
    );
  }
  return { facts, tables, conflicts, fixes: [...byId.values()] };
}

function made(
  tmpl: IrFact,
  doc: string,
  t: number,
  r: number,
  c: number,
  text: string,
  value: number,
  p: Period,
  months: number,
): IrFact {
  return {
    ...tmpl,
    id: `${FILL_METHOD}:${doc}:${t}:${r}:${c}`,
    document_id: doc,
    period_end: p.end,
    period_start: months > 0 && months === p.months ? p.start : months > 0 ? null : null,
    months,
    value,
    method: FILL_METHOD,
    locator: { t, r, c, text },
  };
}
