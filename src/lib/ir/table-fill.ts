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
import { projectedMeasure } from "./reported-scope";
import type { IrFact } from "@/lib/ir/kpis";
import { normLabel } from "@/lib/ir/kpis";
import { parseNumber } from "@/lib/ir/tables";
import { stockKind } from "@/lib/ir/stock";
import { healTitle, sentenceCase } from "@/lib/ir/table-captions";
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
  /**
   * The table's printed figure columns whose period is settled, one per period: [grid column, months (0 for
   * balances), period end, printed head]. A table printing six- or nine-month columns and no three-month one
   * is a year-to-date table (`ytdBasis`, statements.ts).
   */
  cols?: [number, number, string, string][];
}

export interface DocFill {
  facts: IrFact[];
  tables: TableFill[];
  conflicts: FillConflict[];
  /**
   * Stored facts corrected for what the document prints at their own position, same id: a negative printed
   * across two cells ("(32.5" then ")") stored positive (`locator.sign = "printed"`), a figure stored under
   * another column's period (`locator.moved` = the stored period end), or money figures stored at another scale
   * than the one their table's printed scale line names (`locator.scale = "printed"`).
   */
  fixes: IrFact[];
  /** every statement table the document prints (title or heads name a statement, at least 5 numeric rows) */
  statements: PrintedStatement[];
}

export interface FillInput {
  /** stored document id (facts' document_id) */
  doc: string;
  /** the stored text; "" when `grid` is given */
  html: string;
  /** the document's parsed grid when read from its reduced copy (table-fill-cache.ts), else parsed from `html` */
  grid?: GridTable[];
  /** the document's dash convention with `grid` */
  zeroDash?: boolean;
  /** the stored facts of this document */
  facts: IrFact[];
  /** printed title and scale line per table index ("(in millions, except per share data)"), from table-captions */
  captions?: Map<number, { title?: string; unit?: string }>;
  /** table indexes to fill; default every table with at least two fact rows */
  only?: Set<number>;
  /** filing date of the document (no printed period ends after it) */
  filed?: string | null;
  /** the company's fiscal quarter ends ("MM-DD", `quarterEnds`): heads may then name periods no fact uses yet */
  calendar?: string[];
  /** a document no stored fact points into: only its statement tables are read */
  statementsOnly?: boolean;
  /** period ends known to the day (the company's 10-Q and 10-K report dates), see `KnownPeriods.exact` */
  exact?: string[];
  /** document fields for filled facts when the document has no stored fact to copy them from */
  meta?: { filed: string | null; kind: string | null; accn?: string | null; doc?: string | null };
}

/** A statement table the document prints: index, title, numeric rows. */
export interface PrintedStatement {
  t: number;
  title: string;
  rows: number;
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
/**
 * A statement line that names a rate and is an amount: "Effect of exchange rate changes on cash and cash
 * equivalents" (Entegris' statement of cash flows lost the line, read as a rate with no percent sign),
 * "Interest rate swap settlements".
 */
const AMOUNT_OF_RATE = /\beffects? of\b.*\b(exchange|currency)\b.*\brates?\b|\b(exchange|interest)\s+rate\s+(changes?|swaps?|locks?|caps?|contracts?|hedges?|derivatives?|fluctuations?)\b/i;
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
/** Whether at least half of a table's figure rows (three or more) print a decimal figure. */
function mostlyDecimals(table: GridTable, first: number): boolean {
  let rows = 0;
  let decimal = 0;
  for (let r = first; r < table.rows.length; r++) {
    const row = table.rows[r];
    if (row.hidden) continue;
    const figures = row.cells.filter((c) => c.col > 0 && numberOf(c.text) != null);
    if (!figures.length) continue;
    rows++;
    if (figures.some((c) => /\.\d/.test(c.text))) decimal++;
  }
  return rows >= 3 && decimal * 2 >= rows;
}

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

/** Comparison headings apply to the following group, including spacer columns some SEC tables
 * insert between the heading and its dated subcolumns. A later heading on the same row starts
 * a new group. An isolated percent sign can also be the unit of an actual level. */
const COMPARISON_GROUP = /%\s*change\b|\bchanges?\s+(?:from|vs\.?|versus)\b|^(?:changes?|variances?|versus|vs\.?)$|\b(?:o\s*\/\s*\(?u\)?|over\s*\/\s*\(?under\)?)/i;

interface HeaderLayout {
  first: number;
  comparisons: Set<number>;
  ranges: Map<GridCell, [number, number]>;
}
const headerLayouts = new WeakMap<GridTable, HeaderLayout>();

/** SEC comparative groups repeat prior dates. Restarting the descending date sequence marks the
 * next group when each printed parent has one such sequence. This resolves misaligned colspans. */
function datedGroupStarts(row: GridRow | undefined, count: number): number[] | null {
  if (!row || count < 2) return null;
  let previous = "";
  const starts: number[] = [];
  for (const cell of row.cells) {
    if (!cell.col) continue;
    const date = headDate(cell.text)?.end;
    if (!date) continue;
    if (!previous || date >= previous) starts.push(cell.col);
    previous = date;
  }
  return starts.length === count ? starts : null;
}

function headerLayout(table: GridTable, first: number): HeaderLayout {
  const cached = headerLayouts.get(table);
  if (cached?.first === first) return cached;
  const comparisons = new Set<number>();
  const ranges = new Map<GridCell, [number, number]>();
  const width = table.rows.reduce((max, row) => {
    const last = row.cells.at(-1);
    return last ? Math.max(max, last.col + last.span) : max;
  }, 0);
  const rows = table.rows.slice(0, first).filter((row) => !row.hidden);
  for (const [index, row] of rows.entries()) {
    const headings = row.cells.filter((c) => c.col > 0 && c.text.trim());
    if (!headings.some((c) => COMPARISON_GROUP.test(c.text))) continue;
    const starts = datedGroupStarts(rows[index + 1], headings.length);
    for (const [i, cell] of headings.entries()) {
      const compare = COMPARISON_GROUP.test(cell.text);
      if (!compare && !starts) continue;
      const start = starts?.[i] ?? cell.col;
      const end = starts?.[i + 1] ?? headings[i + 1]?.col ?? width;
      ranges.set(cell, [start, end]);
      if (compare) for (let col = start; col < end; col++) comparisons.add(col);
    }
  }
  const layout = { first, comparisons, ranges };
  headerLayouts.set(table, layout);
  return layout;
}

export function comparisonColumns(table: GridTable, first = firstFigureRow(table)): Set<number> {
  return headerLayout(table, first).comparisons;
}

export function isComparisonPosition(grid: GridTable[], locator: { t?: number; r?: number; c?: number } | null): boolean {
  if (locator?.t == null || locator.r == null || locator.c == null) return false;
  const table = grid[locator.t];
  const cell = table?.rows[locator.r]?.cells[locator.c];
  if (!cell) return false;
  const cols = comparisonColumns(table);
  return cols.has(cell.col) || cols.has(cell.col + cell.span - 1);
}

/** Header key per grid column: text of the header cells over it, label column left out. */
function headerKeys(table: GridTable, first: number): Map<number, string> {
  const parts = new Map<number, string[]>();
  const layout = headerLayout(table, first);
  for (const row of table.rows.slice(0, first)) {
    if (row.hidden) continue;
    for (const c of row.cells) {
      if (!c.text || c.col === 0) continue;
      const [start, end] = layout.ranges.get(c) ?? [c.col, c.col + c.span];
      for (let g = start; g < end; g++) parts.set(g, [...(parts.get(g) ?? []), c.text]);
    }
  }
  for (const g of layout.comparisons) parts.set(g, [...(parts.get(g) ?? []), "comparison change"]);
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

export interface KnownPeriods {
  /** "<end>/<months>" → period start, for every flow period the document's facts use */
  flows: Map<string, string | null>;
  /** every period end the document's facts use */
  ends: Set<string>;
  /**
   * The company's fiscal quarter ends as "MM-DD" (from its stored facts and its 10-Q and 10-K report dates,
   * each stepped by three months). With `filed`, a printed head may name a period the document's facts do
   * not use yet, when its date lies within 7 days of one of these; without them, never.
   */
  calendar?: string[];
  /** filing date of the document: no printed period ends after it */
  filed?: string | null;
  /**
   * Period ends known to the day ("YYYY-MM-DD"): the company's 10-Q and 10-K report dates and the ends its
   * stored facts use. A head that prints a month and a year without a day ("September 2026") takes its day
   * from one of these.
   */
  exact?: string[];
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
  [/\b(three|3)[- ]months?\b|\bquarters? ended\b/i, 3],
  [/\b(six|6)[- ]months?\b/i, 6],
  [/\b(nine|9)[- ]months?\b/i, 9],
  [/\b(twelve|12)[- ]months?\b|\byears? ended\b|\bfiscal years?\b/i, 12],
];
const WEEK_WORDS: Record<string, number> = {
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  "twenty-four": 24,
  "twenty-five": 25,
  "twenty-six": 26,
  "twenty-seven": 27,
  "twenty-eight": 28,
  "thirty-six": 36,
  "thirty-seven": 37,
  "thirty-eight": 38,
  "thirty-nine": 39,
  forty: 40,
  "fifty-two": 52,
  "fifty-three": 53,
};
/** Months of a length printed in weeks: 12 to 14 weeks a quarter, 24 to 28 a half, 36 to 40 nine months, 52 or 53 a year. */
export function weeksToMonths(weeks: number): number | null {
  if (weeks >= 12 && weeks <= 14) return 3;
  if (weeks >= 24 && weeks <= 28) return 6;
  if (weeks >= 36 && weeks <= 40) return 9;
  if (weeks >= 52 && weeks <= 53) return 12;
  return null;
}
/** The distinct lengths (months) a text prints; a week count outside the mapped ranges is a length of its own (-1). */
function lengthsIn(text: string): Set<number> {
  const out = new Set<number>();
  for (const [re, m] of LENGTH) if (re.test(text)) out.add(m);
  // "Year to date" names no length of its own (it depends on the quarter): never a period from the head.
  if (/\byear[- ]to[- ]date\b|\bytd\b/i.test(text)) out.add(-1);
  for (const w of text.matchAll(/\b(\d{1,2}|[a-z]+(?:[- ][a-z]+)?)[- ]weeks?\b/gi)) {
    const word = w[1].toLowerCase().replace(" ", "-");
    const n = /^\d+$/.test(word)
      ? Number(word)
      : (WEEK_WORDS[word] ?? WEEK_WORDS[word.split("-").at(-1)!]);
    if (n == null) continue;
    out.add(weeksToMonths(n) ?? -1);
  }
  return out;
}

/** Heads of change, percent and comparison columns. */
const NOT_PERIOD_HEAD = /\bchange\b|%|\bvs\.?(?=\s|$)|\bvariance\b|\bbps\b|\bbasis points\b/i;
/** Names of opening balances. */
const OPENING = /\bbeginning\b|\bopening\b|\bstart of\b/i;
const BALANCE_TITLE = /\bbalance sheets?\b|\bfinancial (position|condition)\b/i;
/** Day of the year of "MM-DD" (non-leap). */
const dayOfYear = (md: string) => {
  const [m, d] = md.split("-").map(Number);
  return [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334][m - 1] + d;
};
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/**
 * The four quarter ends of each fiscal calendar point ("MM-DD"), stepped by three months; a day at or past
 * the 28th stays at its month's end.
 */
export function quarterEnds(points: string[]): string[] {
  const out = new Set<string>();
  for (const md of points) {
    const [m, d] = md.split("-").map(Number);
    if (!m || !d) continue;
    for (const k of [0, 3, 6, 9]) {
      const mm = ((m - 1 + k) % 12) + 1;
      const dd =
        d >= 28 && d >= MONTH_DAYS[m - 1] - 3
          ? MONTH_DAYS[mm - 1]
          : Math.min(d, MONTH_DAYS[mm - 1]);
      out.add(`${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`);
    }
  }
  return [...out].sort();
}
/** Whether a date lies within 7 days of a quarter end of the calendar. */
export function nearQuarterEnd(date: string, calendar: string[]): boolean {
  const x = dayOfYear(date.slice(5));
  return calendar.some((md) => {
    const dist = Math.abs(dayOfYear(md) - x);
    return Math.min(dist, 365 - dist) <= 7;
  });
}

/** A period read from a printed head; `fresh` when no fact of the document uses it. */
interface HeadPeriod extends Period {
  fresh?: boolean;
}

const NAMED_DATE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+((?:19|20)\d{2})\b/gi;
const NUMERIC_DATE = /(?<![\d/.-])(\d{1,2})\/(\d{1,2})\/((?:19|20)\d{2}|\d{2})(?![\d/])/g;
const MONTH_YEAR = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+((?:19|20)\d{2})\b/gi;
const MONTH_DAY = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b(?!\s*(?:months?|weeks?|days?|years?|quarters?)\b)/gi;
const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const lastDay = (y: number, m: number) => (m === 2 && y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : MONTH_DAYS[m - 1]);
const dayNumber = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;

/**
 * The full dates a text prints, in order, each once: "September 26, 2026", "Sept. 26, 2026", and the numeric
 * form US filers use, month first ("9/26/2026", "9/26/26"; Dorman, Bio-Techne and Centerspace head their
 * statements so). A numeric date whose month or day cannot be one is not a date.
 */
export function fullDates(text: string): string[] {
  const at: [number, string][] = [];
  for (const m of text.matchAll(NAMED_DATE)) {
    const mon = MONTHS[m[1].toLowerCase().slice(0, 3)];
    const day = Number(m[2]);
    if (day >= 1 && day <= lastDay(Number(m[3]), mon)) at.push([m.index!, iso(Number(m[3]), mon, day)]);
  }
  for (const m of text.matchAll(NUMERIC_DATE)) {
    const mon = Number(m[1]);
    const day = Number(m[2]);
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    if (mon >= 1 && mon <= 12 && day >= 1 && day <= lastDay(year, mon)) at.push([m.index!, iso(year, mon, day)]);
  }
  return [...new Set(at.sort((a, b) => a[0] - b[0]).map((x) => x[1]))];
}

/** Words that make a year in a head something other than a plain period ("Fiscal 2027", "Q3 2026", "2026 Guidance"). */
const NOT_PLAIN_YEAR =
  /\bq[1-4]\b|\b[1-4]q\b|\bquarters?\b(?!\s+ended)|\bqtr\b|\bytd\b|\bfiscal\b|\bfy\b|\bguidance\b|\boutlook\b|\bforecast\b|\bestimate|\bpro forma\b|\badjusted\b|\bnon-?gaap\b|\bbudget\b|\bplan\b|\btarget\b|\bactual\b|\bhigh\b|\blow\b/i;

/**
 * The one date a column head stands for, or null. In order:
 * - a full date in the head itself (`fullDates`);
 * - a month and a year without a day ("September 2026", "Three Months Ended September | 2026"): the period end
 *   known to the day (`known.exact`, the document's own fact ends) that falls in that month or within a week
 *   of it (Kontoor Brands' "September 2026" is its quarter ended October 3, 2026); with none known, the last
 *   day of the month when every quarter of the fiscal calendar ends on a month's last day; otherwise none;
 * - a year alone ("2026" under "Three Months Ended") when the table's title lines (`words`) print the date:
 *   the one full date of that year they print, else the one month and day they print with that year (Wendy's
 *   "Periods Ended September 28, 2025 and September 27, 2026" over "2025 | 2026"; Sensient's "Nine Months
 *   Ended September 30," in the label column over "2026 | 2025").
 * A head printing two dates, or a year beside words that make it something else (`NOT_PLAIN_YEAR`), gives none.
 */
export function headEnd(head: string, words: string, known: Pick<KnownPeriods, "exact" | "ends" | "calendar">): string | null {
  const full = fullDates(head);
  if (full.length) return full.length === 1 ? full[0] : null;
  const my = [...head.matchAll(MONTH_YEAR)];
  if (my.length > 1) return null;
  if (my.length === 1) {
    const mon = MONTHS[my[0][1].toLowerCase().slice(0, 3)];
    const year = Number(my[0][2]);
    const from = dayNumber(iso(year, mon, 1)) - 7;
    const to = dayNumber(iso(year, mon, lastDay(year, mon))) + 7;
    const hits = [...new Set([...(known.exact ?? []), ...(known.ends ?? [])])].filter((d) => {
      const n = dayNumber(d);
      return n >= from && n <= to;
    });
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) return null;
    const monthEnds = !!known.calendar?.length && known.calendar.every((md) => Number(md.slice(3)) === MONTH_DAYS[Number(md.slice(0, 2)) - 1]);
    return monthEnds ? iso(year, mon, lastDay(year, mon)) : null;
  }
  const years = [...head.matchAll(/\b((?:19|20)\d{2})\b/g)].map((m) => Number(m[1]));
  if (years.length !== 1 || NOT_PLAIN_YEAR.test(head)) return null;
  // The head prints nothing but its year and, at most, its length ("three months ended|2026").
  const rest = head.replace(/\b(?:19|20)\d{2}\b/, " ").replace(/\b(for the|three|six|nine|twelve|3|6|9|12|months?|quarters?|years?|weeks?|periods?|ended|ending|as of|at|unaudited|audited)\b|[^a-z0-9]/gi, " ");
  if (/[a-z0-9]/i.test(rest)) return null;
  const year = years[0];
  const dated = [...new Set(fullDates(words).filter((d) => Number(d.slice(0, 4)) === year))];
  if (dated.length === 1) return dated[0];
  if (dated.length > 1) return null;
  const days = new Set([...words.matchAll(MONTH_DAY)].map((m) => `${MONTHS[m[1].toLowerCase().slice(0, 3)]}-${Number(m[2])}`));
  if (days.size !== 1) return null;
  const [mon, day] = [...days][0].split("-").map(Number);
  return day >= 1 && day <= lastDay(year, mon) ? iso(year, mon, day) : null;
}

/**
 * A column's period from its printed head alone, strictly: one full date ("September 26, 2026", "Sep 30, | 2026")
 * and exactly one length (own head first, else the table's title lines). A period the document's facts use is
 * accepted as before: a flow end and length the facts use, a balance (no length, or "as of") at a fact period
 * end. Any other period only with `known.calendar` and `known.filed` and only for a statement table (`fresh`):
 * its date not after the filing date and within 7 days of a fiscal quarter end; a balance column then also
 * needs "as of" in its head or a balance sheet title. Anything else is refused (null).
 */
export function printedHead(
  key: string,
  title: string,
  known: KnownPeriods,
  statement = false,
  dateWords = "",
): HeadPeriod | null {
  const head = key.replace(/\|/g, " ");
  if (NOT_PERIOD_HEAD.test(head)) return null;
  const words = `${title} ${dateWords}`;
  const end = headEnd(head, words, known);
  if (!end) return null;
  // A date the head does not print in full was completed from the title lines or the fiscal calendar.
  const completed = fullDates(head).length === 0;
  const asOf = /\bas of\b/i.test(head) || (completed && /\bas of\b|\bas at\b/i.test(dateWords) && !lengthsIn(head).size);
  const own = lengthsIn(head);
  if (own.size > 1) return null;
  let months = [...own][0];
  if (months == null && !asOf) {
    const wide = lengthsIn(title);
    if (wide.size > 1) return null;
    months = [...wide][0];
    // The length a statement prints under its name ("Three Months Ended March 31, 2020 and 2019").
    if (months == null && !BALANCE_TITLE.test(title)) {
      const under = lengthsIn(dateWords);
      if (under.size > 1) return null;
      months = [...under][0];
    }
  }
  if (months === -1) return null;
  const balance = months == null || asOf;
  if (balance && known.ends.has(end)) return { end, start: null, months: 0, point: true };
  if (!balance && known.flows.has(`${end}/${months}`))
    return { end, start: known.flows.get(`${end}/${months}`) ?? null, months, point: false };
  // A period no fact of the document uses: statement tables only, by the filing date and the fiscal calendar.
  if (!statement || !known.calendar?.length || !known.filed) return null;
  if (end > known.filed || !nearQuarterEnd(end, known.calendar)) return null;
  if (balance)
    return asOf || BALANCE_TITLE.test(title)
      ? { end, start: null, months: 0, point: true, fresh: true }
      : null;
  return { end, start: null, months, point: false, fresh: true };
}

/**
 * The one full date a column head prints, with its own length (months; -1 a length that maps to none), or null
 * when the head prints no full date, two dates, or a change or percent head.
 */
export function headDate(key: string): { end: string; months?: number } | null {
  const head = key.replace(/\|/g, " ");
  if (NOT_PERIOD_HEAD.test(head)) return null;
  const dates = fullDates(head);
  if (dates.length !== 1) return null;
  const end = dates[0];
  const own = lengthsIn(head);
  if (own.size > 1) return { end, months: -1 };
  return own.size ? { end, months: [...own][0] } : { end };
}

/**
 * The newest full date printed in the column heads of a table (the rows above its first figure row), or null:
 * the period a statement table reports, read from the table alone.
 */
export function newestHeadDate(table: GridTable): string | null {
  let newest: string | null = null;
  for (const row of table.rows.slice(0, firstFigureRow(table)))
    for (const cell of row.cells) {
      const d = headDate(cell.text);
      if (d && (!newest || d.end > newest)) newest = d.end;
    }
  return newest;
}

/** Six months before a date ("YYYY-MM-DD"). */
const sixMonthsBefore = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  const mm = m - 6 <= 0 ? m + 6 : m - 6;
  const yy = m - 6 <= 0 ? y - 1 : y;
  return `${yy}-${String(mm).padStart(2, "0")}-${String(Math.min(day, 28)).padStart(2, "0")}`;
};

/**
 * Periods of one table's column heads (`keys`: grid column → head text) by head text. Over `printedHead`, for the
 * periods no fact of the document uses: the newest dated column of the table is at most 6 months before the
 * filing date; two different heads never get the same period (both left out); the columns of one length run
 * in one order of dates (all newer to older or all older to newer). A head that fails is left out (null).
 */
export function tableHeads(
  keys: Map<number, string>,
  title: string,
  known: KnownPeriods,
  statement = false,
  dateWords = "",
): Map<string, HeadPeriod | null> {
  const out = new Map<string, HeadPeriod | null>();
  const firstCol = new Map<string, number>();
  for (const [g, k] of [...keys].sort((a, b) => a[0] - b[0])) {
    if (!/\d/.test(k) || out.has(k)) continue;
    out.set(k, printedHead(k, title, known, statement, dateWords));
    firstCol.set(k, g);
  }
  const got = [...out].filter((x): x is [string, HeadPeriod] => !!x[1]);
  if (!got.some(([, p]) => p.fresh)) return out;
  const refuse = (k: string) => out.get(k)?.fresh && out.set(k, null);
  const newest = got.reduce((m, [, p]) => (p.end > m ? p.end : m), "");
  if (known.filed && newest < sixMonthsBefore(known.filed)) for (const [k] of got) refuse(k);
  const byId = new Map<string, string[]>();
  for (const [k, p] of got) byId.set(periodId(p), [...(byId.get(periodId(p)) ?? []), k]);
  // One printed column group spans grid columns whose heads extend one another ("... 2026" and "... 2026|amount");
  // heads that do not are two printed columns of one period.
  const parts = (k: string) => k.split("|");
  const extends_ = (a: string, b: string) => {
    const [x, y] = parts(a).length <= parts(b).length ? [parts(a), parts(b)] : [parts(b), parts(a)];
    return x.every((p, i) => p === y[i]);
  };
  for (const ks of byId.values())
    if (ks.some((a) => ks.some((b) => !extends_(a, b)))) for (const k of ks) refuse(k);
  const byLength = new Map<number, [string, HeadPeriod][]>();
  for (const [k, p] of got) byLength.set(p.months, [...(byLength.get(p.months) ?? []), [k, p]]);
  for (const xs of byLength.values()) {
    // Heads of one printed column group (grid columns side by side) give one date.
    const ends = xs
      .sort((a, b) => firstCol.get(a[0])! - firstCol.get(b[0])!)
      .map(([, p]) => p.end)
      .filter((e, i, all) => i === 0 || e !== all[i - 1]);
    const down = ends.every((e, i) => i === 0 || e < ends[i - 1]);
    const up = ends.every((e, i) => i === 0 || e > ends[i - 1]);
    if (!down && !up && !yearAgoThenPrior(ends, xs[0][1].months === 0)) for (const [k] of xs) refuse(k);
  }
  return out;
}

/**
 * Three columns of one length printed as: this period, the same period a year earlier, the period just before
 * this one ("March 28, 2015 | March 29, 2014 | December 31, 2014", how Entegris and many others print their
 * quarter). The dates say so themselves: the second about a year before the first, the third about a quarter.
 */
function yearAgoThenPrior(ends: string[], balance = false): boolean {
  if (ends.length !== 3) return false;
  const days = (a: string, b: string) => (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
  const year = days(ends[0], ends[1]);
  const quarter = days(ends[0], ends[2]);
  // A balance sheet's third column is the last year-end, one to three quarters back ("September 30, 2026 |
  // September 30, 2025 | December 31, 2025", how FirstCash, Enova and Simpson print theirs).
  return year >= 355 && year <= 378 && quarter >= 80 && quarter <= (balance ? 290 : 100);
}

const STATEMENT_TITLE =
  /\bstatements?\s+of\s+(?:[a-z]+\s+){0,3}?(?:income|operations|earnings|cash\s+flows?|financial\s+(?:position|condition))\b|\b(?:income\s+statements?|balance\s+sheets?|cash\s+flows?\s+statements?)\b/i;
const NOT_STATEMENT = /\breconcil|\bnon-?gaap\b|\bsegments?\b|\badjusted\b/i;
/**
 * The name filled lines of a table carry, from its printed title alone: a statement by its kind ("Income statement",
 * "Balance sheet", "Cash flow statement", "Comprehensive income", "Changes in equity"), so the same statement
 * printed as "Condensed consolidated statements of operations" in one release and "Consolidated statements of
 * income" in the next is one table; any other title in sentence case without "condensed", "consolidated",
 * "(unaudited)" and footnote marks. Null when nothing is printed.
 */
export function printedTableName(title: string): string | null {
  const t = title.replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (statementTitle(t)) {
    if (/comprehensive/i.test(t)) return "Comprehensive income";
    if (/balance sheets?|financial (position|condition)/i.test(t))
      return /average/i.test(t) ? "Average balance sheet" : "Balance sheet";
    if (/cash flows?/i.test(t)) return "Cash flow statement";
    if (/equity|deficit|retained/i.test(t) && !/income|operations|earnings/i.test(t))
      return "Changes in equity";
    return "Income statement";
  }
  const core = t
    .replace(
      /\((?:unaudited|continued|cont\.?)\)|\b(condensed|consolidated|unaudited|continued)\b/gi,
      " ",
    )
    .replace(/(\s*(\(\w{1,2}\)|[*†‡§¹²³⁴⁵⁶⁷⁸⁹⁰]+|\s\d{1,2}))+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return core ? sentenceCase(core) : null;
}

/** A printed figure at its scale, without the binary noise of the product (8.2 × 1,000,000 is 8,200,000, not 8,199,999.999999999). */
const scaled = (v: number, scale: number) => (scale === 1 ? v : Number((v * scale).toPrecision(15)));

/** A line of a flow statement whose name says a point in time. */
const POINT_NAME =
  /\b(?:at|as of)\s+(?:the\s+)?(?:beginning|end|start|close)\b|\b(?:beginning|end|start|close)\s+of\s+(?:the\s+)?(?:period|year|quarter)\b|\b(?:beginning|ending|opening|closing)\s+(?:balance|cash)\b|\bperiod[- ]end\b|\boutstanding\b|\bbalance\b/i;

/** A scale word without "in" ("(Millions)", "(Millions of dollars)", "(Dollars in millions)"). */
const BARE_SCALE = /\b(thousands|millions|billions)\b/i;
/**
 * A scale line printed in parentheses in the last 160 characters before a table's figures ("(Millions except per
 * share amounts)", "(In millions)"): the groups naming exactly one scale word, when they agree; else "".
 */
export function printedScaleLine(text: string): string {
  const tail = text.replace(/\s+/g, " ").slice(-160);
  const groups = [...tail.matchAll(/\(([^()]*)\)/g)]
    .map((m) => m[1])
    .filter((g) => (g.match(/\b(thousands|millions|billions)\b/gi) ?? []).length === 1);
  const words = new Set(groups.map((g) => g.match(BARE_SCALE)![1].toLowerCase()));
  return words.size === 1 ? `(${groups[0]})` : "";
}

/** Whether a table's title or the text printed above its first figures names a financial statement. */
export function statementTitle(title: string, headText = ""): boolean {
  // A printed title decides; the heads only speak for a table printing none.
  const x = healTitle(title.trim() ? title : headText);
  return STATEMENT_TITLE.test(x) && !NOT_STATEMENT.test(x);
}
const LEAD_TITLE =
  /(?:(?:condensed|consolidated|combined)\s+)*(?:statements?\s+of\s+(?:[a-z]+\s+){0,3}?(?:income|operations|earnings|cash\s+flows?|financial\s+(?:position|condition))|income\s+statements?|balance\s+sheets?|cash\s+flows?\s+statements?)\b/gi;
/**
 * A statement's title printed just before its table when the captions found none ("Walmart Inc. Condensed
 * Consolidated Statements of Income (Unaudited)" → "Condensed Consolidated Statements of Income"): the last
 * statement name in the last 200 characters of the lead text (a statement prints its periods and its scale
 * under its name: "... Statements of Operations Three and Nine Month Periods Ended September 28, 2025 and
 * September 27, 2026 (In Thousands Except Per Share Amounts) (Unaudited)").
 */
const LEAD_REACH = 200;
/**
 * What a statement prints under its name before its table: the lead text after the last statement name, where
 * its periods are dated ("As of March 31, 2020, and December 31, 2019"). Empty when the lead names none.
 */
export function leadDates(lead: string | undefined): string {
  const tail = healTitle((lead ?? "").replace(/\s+/g, " ").trim()).slice(-LEAD_REACH);
  const last = [...tail.matchAll(LEAD_TITLE)].at(-1);
  return last ? tail.slice(last.index! + last[0].length).trim() : "";
}
export function leadTitle(lead: string | undefined): string {
  const tail = healTitle((lead ?? "").replace(/\s+/g, " ").trim()).slice(-LEAD_REACH);
  const hits = [...tail.matchAll(LEAD_TITLE)];
  const last = hits.at(-1)?.[0]?.trim() ?? "";
  if (!last || NOT_STATEMENT.test(tail.slice(Math.max(0, tail.lastIndexOf(last) - 40)))) return "";
  // Under its name a statement prints its periods, its scale and "(Unaudited)": running text after the name
  // ("... Statements of Operations. Revenue by product line was as follows:") leads another table.
  const after = tail.slice(tail.lastIndexOf(last) + last.length);
  return /[.:;]\s+[A-Z][a-z]|\b(following|below|follows|tables?|see|summar\w+|includ\w+|compared)\b/i.test(after) ? "" : last;
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

/** Respect the basis printed above an equity reconciliation, including indented adjustments.
 * Both an average for a reporting duration and a carrying value at period end can say "Goodwill". */
function printedEquityBasis(table: GridTable, first: number): "average" | "point" | null {
  const headings = table.rows.slice(0, first).filter(r => !r.hidden)
    .map(row => row.cells.filter(c => c.text.trim()))
    .filter(cells => cells.length === 1 && cells[0].col === 0)
    .map(cells => cells[0].text.trim());
  if (headings.some(h => /^return on average (?:tangible )?(?:common |shareholders.? )?equity\b/i.test(h))) return "average";
  if (headings.some(h => /^(?:tangible )?book value per (?:common )?share\b/i.test(h))) return "point";
  return null;
}

const EQUITY_CARRYING_AMOUNT = /^(?:(?:common|preferred) stock\b.{0,100}\bpar value\b|unearned (?:ESOP|employee stock ownership plan(?: \(ESOP\))?) shares\b)/i;

const EQUITY_BALANCE = /^(?:(?:total|(?:tangible )?common(?: stockholders[’'s]*)?) equity)$/i;

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
  const grid = input.grid ?? parseGrid(input.html);
  const zeroDash = input.zeroDash ?? dashMeansZero(input.html);
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
      // Figures the reader took from a change or percent column never give that column a period.
      if (
        NOT_PERIOD_HEAD.test(keys.get(g.s) ?? "") ||
        NOT_PERIOD_HEAD.test(keys.get(g.e - 1) ?? "")
      )
        continue;
      let p = got.p;
      let wrong = got.outliers;
      // The column's own printed head names one full date other than the stored one: the print wins (every stored
      // figure of the column is moved to it), unless the head prints another length than the stored figures.
      const k0 = keys.get(g.s);
      const hd = k0 && k0 === keys.get(g.e - 1) ? headDate(k0) : null;
      if (hd && hd.end !== p.end) {
        if (hd.months != null && (hd.months < 0 || (p.months > 0 && hd.months !== p.months)))
          continue;
        p = { ...p, end: hd.end, start: null };
        wrong = g.fs.filter((f) => f.period_end !== hd.end);
      }
      // A stored figure in this column under another column's period: the column's period is the printed one.
      for (const f of wrong)
        if (
          (f.months === 0 || f.months === p.months) &&
          // An opening balance is dated before its column (the day before the period starts): never a slip.
          !OPENING.test(f.label) &&
          !(f.months === 0 && f.period_end < p.end)
        )
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
  const any: Partial<IrFact> | undefined =
    input.facts[0] ??
    (input.meta
      ? {
          accn: input.meta.accn ?? null,
          doc: input.meta.doc ?? null,
          filed: input.meta.filed,
          document_kind: input.meta.kind,
        }
      : undefined);
  // Periods the document's facts already use: a printed head may only name one of these.
  const known: KnownPeriods = {
    flows: new Map(),
    ends: new Set(),
    calendar: input.calendar,
    filed: input.filed ?? input.facts.find((f) => f.filed)?.filed ?? input.meta?.filed ?? null,
    exact: input.exact,
  };
  for (const f of input.facts) {
    known.ends.add(f.period_end);
    if (f.months > 0) known.flows.set(`${f.period_end}/${f.months}`, f.period_start ?? null);
  }
  // Tables the facts cover in part, and tables no fact sits in whose column heads the document settles.
  // A length phrase printed over the whole table (its title, or a head in the label column).
  const lengthWordsOf = (table: GridTable, first: number, title: string) =>
    [
      title,
      ...table.rows
        .slice(0, first)
        .flatMap((r) => r.cells.filter((c) => c.col === 0).map((c) => c.text)),
    ].join(" ");
  // Statement tables of the document, and each table's printed heads by head text.
  const statements: PrintedStatement[] = [];
  const isStatement = new Set<number>();
  const headsOf = new Map<number, Map<string, HeadPeriod | null>>();
  /** The title each table is read under: its caption's, else the statement name printed just before it. */
  const titleOf = new Map<number, string>();
  /** The joined column heads of each table, to recognise a statement carried on in the next table. */
  const headLine = new Map<number, string>();
  for (const table of grid) {
    const first = firstFigureRow(table);
    if (first < 0) continue;
    const keys = headerKeys(table, first);
    headLine.set(table.index, [...keys].sort((a, b) => a[0] - b[0]).map((x) => x[1]).join("¦"));
    let title = input.captions?.get(table.index)?.title || leadTitle(table.lead);
    const headText = table.rows
      .slice(0, first)
      .flatMap((r) => r.cells.map((c) => c.text))
      .join(" ");
    // A statement carried on in a second table: no title of its own, nothing printed between the two, and the
    // same column heads (HA Sustainable prints its financing cash flows so, Redwire its investing ones).
    const prev = table.index - 1;
    if (!title && !(table.lead ?? "").trim() && isStatement.has(prev) && /\d/.test(headLine.get(table.index)!) && headLine.get(prev) === headLine.get(table.index))
      title = titleOf.get(prev) ?? "";
    titleOf.set(table.index, title);
    const rows = table.rows.filter((r, i) => i >= first && !r.hidden && hasFigure(r)).length;
    if (rows >= 5 && statementTitle(title, headText)) {
      statements.push({ t: table.index, title: title || cleanLabel(headText).slice(0, 80), rows });
      isStatement.add(table.index);
    }
    headsOf.set(
      table.index,
      tableHeads(
        keys,
        lengthWordsOf(table, first, title),
        known,
        isStatement.has(table.index),
        // What the statement prints under its name, where its columns are dated when the heads print years only.
        isStatement.has(table.index) ? leadDates(table.lead) : "",
      ),
    );
  }
  // Tables the facts cover in part, and tables no fact sits in whose column heads the document settles; in a
  // document no fact points into, its statement tables only.
  const want = (t: number) => {
    if (input.only && !input.only.has(t)) return false;
    if (input.statementsOnly && !isStatement.has(t)) return false;
    const xs = byTable.get(t) ?? [];
    const rows = new Set(xs.map((x) => x.r)).size;
    if (rows >= 2) return true;
    if (rows) return false;
    const table = grid[t];
    const first = firstFigureRow(table);
    if (first < 0) return false;
    const keys = headerKeys(table, first);
    const heads = headsOf.get(t);
    const settled = new Set(
      [...keys.values()].filter(
        (k) => /\d/.test(k) && !NOT_PERIOD_HEAD.test(k) && (dict.get(k) || heads?.get(k)),
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
    const heads = headsOf.get(t);
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
    const resolvePeriod = (c: GridCell): Period | null => {
      const hits = own.filter((g) => overlaps(c, g.s, g.e));
      if (hits.length === 1) return hits[0].p;
      if (hits.length > 1) return null;
      // A column no fact of this table sits in: only by its head, and only when no own column shares that head.
      const k = keyOver(keys, c);
      if (!k) return null;
      // A change or percent column never takes a period, even where the reader put one under the same head elsewhere.
      if (NOT_PERIOD_HEAD.test(k)) return null;
      const p = dict.get(k) ?? heads?.get(k);
      if (!p) return null;
      if (own.some((g) => g.p.end === p.end && g.p.months === p.months)) return null;
      return p;
    };

    const equityBasis = printedEquityBasis(table, first);
    const periodOf = (c: GridCell): Period | null => {
      const p = resolvePeriod(c);
      if (!p || !equityBasis) return p;
      if (equityBasis === "point") return { ...p, months: 0, point: true, start: null };
      const h = headDate(keyOver(keys, c) ?? "");
      if (h?.end !== p.end || !h.months || h.months < 1) return p;
      return { end: h.end, months: h.months, start: known.flows.get(periodId({ end: h.end, months: h.months })) ?? null, point: false };
    };

    // The periods the table's figure columns print (its first forty figure rows say them all).
    const printedCols = new Map<string, [number, number, string, string]>();
    for (let r = first, seen = 0; r < table.rows.length && seen < 40; r++) {
      const row = table.rows[r];
      if (row.hidden) continue;
      let any = false;
      for (const c of row.cells) {
        if (c.col === 0 || numberOf(c.text) == null) continue;
        any = true;
        const p = periodOf(c);
        if (!p) continue;
        const months = p.months > 0 ? p.months : 0;
        const id = `${months}:${p.end}`;
        if (!printedCols.has(id)) printedCols.set(id, [c.col, months, p.end, keyOver(keys, c) ?? ""]);
      }
      if (any) seen++;
    }
    if (printedCols.size) report.cols = [...printedCols.values()].sort((a, b) => a[0] - b[0]);

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
    // The scale line: the caption's, else one printed in parentheses just above the table or in its heads.
    const unitLine =
      cap?.unit ||
      printedScaleLine(
        `${table.lead ?? ""} ${table.rows
          .slice(0, first)
          .flatMap((r) => r.cells.filter((c) => c.col === 0).map((c) => c.text))
          .join(" ")}`,
      );
    const capWord = (unitLine.match(SCALE_WORD) ?? unitLine.match(BARE_SCALE))?.[1]?.toLowerCase();
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
    const capText = unitLine;
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
    const oneScaleWordLine =
      (unitLine.match(/\b(thousands|millions|billions)\b/gi) ?? []).length === 1;
    // The printed scale line, when it names one scale, is the table's money scale (rows printing their own scale in
    // their name, "(in billions of dollars)", keep theirs).
    if (oneScaleWordLine && capScale != null) moneyScale = capScale;
    // Stored money figures all read at another scale than the table's printed scale line, which names one scale
    // only ("(in thousands, except per share amounts)"): every one of at least three, none with cents, at one
    // scale. The printed scale wins, for them and for the fill.
    const wholeDollars = xs.filter(
      (x) => x.f.unit === "usd" && Math.abs(numberOf(x.cell.text) ?? 0) >= 1,
    );
    const storedScales = new Set(wholeDollars.map((x) => unitScale(x.f, x.cell.text)));
    const storedScale = storedScales.size === 1 ? [...storedScales][0] : null;
    const oneScaleWord = oneScaleWordLine;
    if (
      capScale != null &&
      oneScaleWord &&
      storedScale != null &&
      storedScale !== capScale &&
      wholeDollars.length >= 3 &&
      wholeDollars.every((x) => !/\.\d/.test(x.cell.text))
    ) {
      for (const x of wholeDollars) {
        const f: IrFact = {
          ...x.f,
          value: (x.f.value / storedScale) * capScale,
          locator: { ...(x.f.locator as object), scale: "printed" } as unknown as IrFact["locator"],
        };
        fixes.push(f);
        // The rest of this table's reading (neighbour scales, part-read rows) sees the scaled figure.
        x.f = f;
      }
      moneyScale = capScale;
      for (let i = 0; i < usdScales.length; i++) usdScales[i] = capScale;
    }
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
    // An equity reconciliation reports adjustments on its printed basis. On a money-scale table
    // "unearned ESOP shares" and the par-value stock account are carrying amounts.
    for (const x of xs) {
      const p = equityBasis ? periodOf(x.cell) : null;
      const usd = moneyScale != null && ((x.f.unit === "count" && EQUITY_CARRYING_AMOUNT.test(x.f.label)) ||
        (x.f.unit === "usdPerShare" && capScale != null && EQUITY_BALANCE.test(x.f.label)));
      const numeric = usd ? cellValue(table.rows[x.r], x.c) : null;
      const basisChanges = p && p.end === x.f.period_end && p.months !== x.f.months;
      if (!basisChanges && numeric == null) continue;
      x.f = { ...x.f, ...(basisChanges ? { months: p.months, period_start: p.start } : {}),
        ...(numeric != null ? { unit: "usd", value: scaled(numeric, moneyScale!) } : {}) };
      fixes.push(x.f);
    }
    // Whether the table's money prints whole numbers. From its stored money facts where it has some; a table no
    // reader stored a money fact for (a statement read from the document alone) says so itself: decimals in most
    // of its figure rows are how its money is printed (Skyworks prints "943.7" in millions under "in millions,
    // except per share amounts"), never a per-share sign. Before this every row of such a table was read as a
    // per-share figure.
    const usdCells = xs.filter((x) => x.f.unit === "usd");
    const intOnly = usdCells.length
      ? usdCells.every((x) => !/\.\d/.test(x.cell.text))
      : !mostlyDecimals(table, first);
    // Table name of the filled lines: the readers' own name for the table, else its printed title.
    // Table name of the filled lines, from what the document prints (never the reader's own name for the table,
    // which drifts between releases): the statement kind, else the printed title, else the reader's name.
    const bd =
      printedTableName(titleOf.get(t) || cap?.title || statements.find((x) => x.t === t)?.title || "") ??
      mode(xs.map((x) => x.f.breakdown).filter((b): b is string => !!b)) ??
      null;
    /** The table is a statement of flows: its lines are flows unless named as a point in time. */
    const flowStatement = bd === "Income statement" || bd === "Cash flow statement" || bd === "Comprehensive income";
    /** The table is a financial statement: a line about a rate is an amount ("Effect of exchange rate changes on cash"). */
    const statementTable = flowStatement || bd === "Balance sheet";
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
    // Heading of the block the last numeric row read sat under.
    let prevHeading = "";
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
      if (projectedMeasure(label) || projectedMeasure(heading) || projectedMeasure(bd)) continue;
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
            // A row of stored balances never takes a flow column's figure (a rollforward's builds) and the reverse.
            if (own.every((f) => f.months === 0) && u.p.months > 0 && !u.p.point) continue;
            const months = own.every((f) => f.months === 0) ? 0 : u.p.months;
            if (months === 0 && !u.p.point && !own.every((f) => f.months === 0)) continue;
            if (have.has(periodId({ end: u.p.end, months }))) continue;
            const v = cellValue(row, u.c) ?? (zeroDash && DASH.test(u.cell.text.trim()) ? 0 : null);
            if (v == null) continue;
            facts.push(made(tmpl, input.doc, t, r, u.c, u.cell.text, scaled(v, scale), u.p, months));
            report.cells++;
          }
        }
        report.style.push([r, levelOf(lab.cell?.indent ?? 0), flags, names.get(r) ?? ""]);
        prevUnit = unitOfRow(r);
        prevHeading = heading;
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
      if (moneyScale != null && (EQUITY_CARRYING_AMOUNT.test(label) || (capScale != null && EQUITY_BALANCE.test(label)))) {
        unit = "usd";
        scale = moneyScale;
      } else if (lead && prevUnit && prevScale != null) {
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
      } else if (dollar && decimals && moneyScale != null && moneyScale > 1 && intOnly &&
        (PER_SHARE.test(unitLine) || PER_SHARE.test(heading) || adjacent.includes("usdPerShare"))) {
        // Decimal currency may also be billions. Require a printed per-share basis or per-share neighbours.
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
      } else if (RATIO.test(label) && pctLike && !(statementTable && AMOUNT_OF_RATE.test(label))) {
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
      } else if (prevUnit === "pct" && heading === prevHeading && !dollar) {
        // Under a block whose rows print percentages, a row without its own sign is not certain: left out.
        unit = null;
      } else if (
        moneyScale != null &&
        !(decimals && moneyScale > 1 && intOnly && usdScales.length)
      ) {
        unit = "usd";
        // The table's scale line, when it names one scale, outranks the stored neighbours' scale.
        scale = oneScaleWord && capScale != null ? capScale : (nbScale("usd") ?? moneyScale);
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
        const opening = OPENING.test(name);
        // An opening balance printed under a column of n months belongs to the period's start, not its end: left out.
        if (opening && u.p.months > 0) continue;
        const kind = opening
          ? null
          : stockKind({ category: FILL_CATEGORY, metric: "other", label: name });
        if (equityBasis) months = u.p.months;
        else if (kind === "point") months = 0;
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
            scaled(v, unit === "usd" || unit === "count" ? scale : 1),
            u.p,
            months,
          ),
        );
      }
      // A row printing the same nonzero figure for a quarter and the year to date that ends with it is a balance
      // (market capitalization, shares at period end): every figure of the row is a point in time. Not when
      // another pair of its columns differs (a flow that all fell into one quarter repeats there and nowhere
      // else: Entegris' "Proceeds from government incentives" printed 8.2 for the quarter and the nine months of
      // 2025, a dash and 5.4 for 2026, and read as a balance its nine months stood as the quarter). And in a
      // statement of income or cash flows a line is a flow unless its name says a point in time (cash at the
      // beginning or end of the period): an acquisition paid in the quarter repeats in both columns too.
      const pairs = rowOut.flatMap((a) =>
        rowOut
          .filter((b) => a !== b && a.period_end === b.period_end && a.months === 3 && b.months > 3)
          .map((b) => [a, b] as const),
      );
      const repeats =
        pairs.some(([a, b]) => a.value === b.value && a.value !== 0) &&
        pairs.every(([a, b]) => a.value === b.value) &&
        (!flowStatement || POINT_NAME.test(label));
      if (repeats && equityBasis !== "average") for (const f of rowOut) Object.assign(f, { months: 0, period_start: null });
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
      prevHeading = heading;
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
            value:
              (f.locator as { scale?: string }).scale || (had.locator as { scale?: string }).scale
                ? Math.abs(Math.abs(f.value) > Math.abs(had.value) ? f.value : had.value) *
                  (Math.sign(f.value) < 0 || Math.sign(had.value) < 0 ? -1 : 1)
                : Math.sign(f.value) < 0
                  ? f.value
                  : had.value,
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
  return { facts, tables, conflicts, fixes: [...byId.values()], statements };
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
