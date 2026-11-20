// Pure checks on the unit scale of figures read from IR tables. The model chooses a scale per row
// ("in millions" → 1e6); these rules use evidence printed in the table itself to correct a scale the
// table contradicts, and mark a figure suspect (never "fix" it) when the evidence can't settle it.
//   1. Scale words printed in the table ("in millions", "$000s") beat a different scale the model chose.
//   2. Cells already in full units (spreadsheets whose display format hides six zeros) are not scaled again.
//   3. A figure is marked suspect at storage when it is larger than any company reports, larger than
//      its own printed total by 900× or more, or when its table's scale disagrees with another table of
//      the same document printing the same line and period.
import { parseNumber, type ParsedTable } from "@/lib/ir/tables";

/** Figures of $10 trillion or more: no company reports revenue, costs or a balance sheet this large. */
export const MAX_USD = 1e13;
/** Assets under custody/administration and payment volumes can pass $10 trillion; they stop at $1 quadrillion. */
export const MAX_USD_CUSTODY = 1e15;
/** Assets held for clients, notional amounts and payment volumes: the lines that can legitimately pass $10 trillion. */
export const CUSTODY = /\b(custody|custodial|under administration|administered|assets under|aum|auc|aua|client assets|client balances|notional|payments? volume|purchase volume|processed|gross dollar volume|gdv|tpv|total volume|transaction volume|volume)\b/i;
/** Steps of 900× and more are unit slips (thousands read as millions and the like), not growth. */
export const SLIP = 900;

const SCALE_WORDS: [RegExp, number][] = [
  [/\b(in|amounts? in|dollars in|\$ in|usd in)\s+thousands\b|\(\s*thousands\s*\)|\$\s*\(?\s*'?000'?s?\b|\b000'?s omitted\b|\bin\s+\$\s*000s?\b|\(\s*\$?\s*000s?\s*\)/i, 1e3],
  [/\b(in|amounts? in|dollars in|\$ in|usd in)\s+millions\b|\(\s*millions\s*\)|\$\s*\(?\s*(mm|mil|millions?)\b|\b000,000'?s omitted\b|\(\s*\$\s*m\s*\)|\bin\s+\$\s*m(illions?)?\b/i, 1e6],
  [/\b(in|amounts? in|dollars in|\$ in|usd in)\s+billions\b|\(\s*billions\s*\)|\$\s*\(?\s*(bn|billions?)\b|\(\s*\$\s*b\s*\)|\bin\s+\$\s*b(illions?)?\b/i, 1e9],
];

/** The one money scale a table prints in its own words, or null when it prints none or several. */
export function printedScale(t: ParsedTable): number | null {
  const found = new Set<number>();
  for (const row of t.rows)
    for (const cell of row) {
      if (!cell || parseNumber(cell) != null) continue;
      for (const [re, s] of SCALE_WORDS) if (re.test(cell)) found.add(s);
    }
  return found.size === 1 ? [...found][0] : null;
}

/**
 * Cells that already hold full dollar amounts. Spreadsheets keep the full value in the cell and show
 * it "in millions" through the display format, so "1483000000" read as millions becomes $1.5 quadrillion.
 * The evidence is in the cells: at least three whole numbers, nine in ten ending in 000, and a typical
 * value that would be $100 billion or more once scaled. A thousands table of round debt amounts
 * ("500,000") stays scaled: its typical value scaled is far below that.
 */
export function inFullUnits(texts: string[], scale: number): boolean {
  if (scale <= 1) return false;
  const ints = texts
    .map((x) => ({ x, n: parseNumber(x) }))
    .filter((c): c is { x: string; n: number } => c.n != null && Number.isInteger(c.n) && Math.abs(c.n) >= 1000 && !/\.\d/.test(c.x));
  if (ints.length < 3) return false;
  const round = ints.filter((c) => /000\D*$/.test(c.x)).length;
  if (round < ints.length * 0.9) return false;
  const mags = ints.map((c) => Math.abs(c.n)).sort((a, b) => a - b);
  return mags[Math.floor(mags.length / 2)] * scale >= 1e11;
}

/** Minimal shape `screenRows` needs: a stored fact row of the table reader. */
export interface ScreenRow {
  label: string;
  parent: string | null;
  is_total: boolean;
  period_end: string;
  months: number;
  value: number;
  unit: string;
  locator: { t: number; r: number; c: number; text: string; suspect?: string };
}

const norm = (s: string | null) =>
  (s ?? "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** The scale the reader applied: stored value over the number printed in the cell. */
export function appliedScale(r: Pick<ScreenRow, "value" | "locator">): number | null {
  const n = parseNumber(r.locator.text);
  if (!n) return null;
  const s = Math.abs(r.value / n);
  return [1, 1e3, 1e6, 1e9].find((x) => Math.abs(s / x - 1) < 1e-6) ?? null;
}

export const fmtTimes = (r: number) => (r >= 1e6 ? `${Math.round(r / 1e6).toLocaleString("en-US")} million` : Math.round(r).toLocaleString("en-US"));
const usdWords = (v: number) => {
  const a = Math.abs(v);
  return a >= 1e12 ? `$${(a / 1e12).toLocaleString("en-US", { maximumFractionDigits: 1 })} trillion` : a >= 1e9 ? `$${(a / 1e9).toLocaleString("en-US", { maximumFractionDigits: 1 })} billion` : `$${(a / 1e6).toLocaleString("en-US", { maximumFractionDigits: 1 })} million`;
};

/**
 * Marks figures whose scale the document itself contradicts (`locator.suspect` holds the reason) and
 * returns new rows; the stored value is never changed. Run over all rows read from one document.
 */
export function screenRows<R extends ScreenRow>(rows: R[]): R[] {
  const why = new Map<R, string>();
  const mark = (r: R, reason: string) => {
    if (!why.has(r) && !r.locator.suspect) why.set(r, reason);
  };
  const usd = rows.filter((r) => r.unit === "usd" && r.value !== 0);
  // 1. Larger than any company reports.
  for (const r of usd) {
    const custody = CUSTODY.test(`${r.label} ${r.parent ?? ""}`);
    if (Math.abs(r.value) >= (custody ? MAX_USD_CUSTODY : MAX_USD)) mark(r, `Reads as ${usdWords(r.value)}, more than any company reports: the table's unit was probably applied twice`);
  }
  // 2. A line 900× or more its own printed total in the same table and period.
  const totals = new Map<string, R>();
  for (const r of rows) if (r.is_total) totals.set(`${r.locator.t}|${r.unit}|${norm(r.label)}|${r.period_end}|${r.months}`, r);
  for (const r of rows) {
    if (!r.parent || r.unit === "pct" || r.unit === "ratio" || r.unit === "bps") continue;
    const tot = totals.get(`${r.locator.t}|${r.unit}|${norm(r.parent)}|${r.period_end}|${r.months}`);
    if (!tot || tot === r || tot.value === 0) continue;
    const ratio = Math.abs(r.value / tot.value);
    if (ratio >= SLIP) mark(r, `About ${fmtTimes(ratio)}× its own total (${tot.label})`);
  }
  // 3. Two tables print the same line for the same period 900× apart: the table whose scale differs
  //    from the document's usual scale is the suspect one (both when neither matches it).
  const scaleOf = new Map<R, number | null>(usd.map((r) => [r, appliedScale(r)]));
  const votes = new Map<number, number>();
  for (const s of scaleOf.values()) if (s != null) votes.set(s, (votes.get(s) ?? 0) + 1);
  const usual = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const tableScale = new Map<number, number | null>();
  for (const r of usd) {
    const s = scaleOf.get(r) ?? null;
    if (!tableScale.has(r.locator.t)) tableScale.set(r.locator.t, s);
    else if (tableScale.get(r.locator.t) !== s) tableScale.set(r.locator.t, null);
  }
  const byLine = new Map<string, R[]>();
  for (const r of usd) {
    const k = `${norm(r.label)}|${r.period_end}|${r.months}`;
    byLine.set(k, [...(byLine.get(k) ?? []), r]);
  }
  const oddTables = new Map<number, string>();
  const note = (other: R) =>
    `Its table's unit disagrees with another table of the same document, which prints ${other.label} ${other.months ? `for the ${other.months} months to` : "at"} ${other.period_end} as ${usdWords(other.value)}`;
  const set = (t: number, n: string) => {
    if (!oddTables.has(t)) oddTables.set(t, n);
  };
  for (const list of byLine.values())
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const [big, small] = Math.abs(list[i].value) >= Math.abs(list[j].value) ? [list[i], list[j]] : [list[j], list[i]];
        if (big.locator.t === small.locator.t || Math.abs(big.value) < Math.abs(small.value) * SLIP) continue;
        const sBig = tableScale.get(big.locator.t);
        const sSmall = tableScale.get(small.locator.t);
        if (sBig !== usual && sSmall === usual) set(big.locator.t, note(small));
        else if (sSmall !== usual && sBig === usual) set(small.locator.t, note(big));
        else {
          set(big.locator.t, note(small));
          set(small.locator.t, note(big));
        }
      }
  for (const r of usd) {
    const n = oddTables.get(r.locator.t);
    if (n) mark(r, n);
  }
  if (!why.size) return rows;
  return rows.map((r) => (why.has(r) ? { ...r, locator: { ...r.locator, suspect: why.get(r)! } } : r));
}
