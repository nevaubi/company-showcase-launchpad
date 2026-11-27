/**
 * Printed structure of a filed statement (as-reported view), from the filing's own data, never its labels.
 *
 * SEC's statement data keep each line's order, tag and label but no indent level, so the structure is read
 * from what the lines carry:
 * - a line with no figure in the statement is a printed heading ("Current assets:", "Costs and expenses:");
 * - the lines after a heading sit one level under it, until a total closes it;
 * - a total is a line tagged as a statement total (the tag list in `isTotalTag`), or a line whose figures
 *   equal the sum of the lines of its block in every period where all of them have one (at the top level
 *   also the sum of the top-level totals since the last grand total: total net revenue after noninterest
 *   revenue and net interest income);
 * - a total that closes a heading takes the heading's level and counts as one line of the block above;
 * - a heading right after another heading nests under it; a heading after lines of an unclosed block
 *   replaces it; a heading after a closed nested block is its sibling;
 * - the closing lines of a statement (net income, total assets, total liabilities and equity, cash at the
 *   end of the period) are grand totals, by tag.
 */

export type StatementCode = "IS" | "BS" | "CF" | "EQ" | "CI" | "UN" | string;

export interface LineFacts {
  /** The line has at least one figure in this statement (without breakdowns). */
  hasFacts: boolean;
  /** The line's tag is a statement total. */
  totalTag: boolean;
  /** The line's tag closes the statement (see GRAND_TAGS). */
  grandTag: boolean;
  /** The line's figure per column as filed (unsigned by any negated label), null where none. */
  values: (number | null)[];
}

export interface LineShape {
  head: boolean;
  depth: number;
  total: "sub" | "grand" | null;
}

/** Tags of the lines that close each statement: printed with a double rule under them. */
export const GRAND_TAGS: Record<string, ReadonlySet<string>> = {
  IS: new Set(["NetIncomeLoss"]),
  BS: new Set(["Assets", "LiabilitiesAndStockholdersEquity"]),
  CF: new Set([
    "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
    "CashAndCashEquivalentsAtCarryingValue",
    "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsPeriodIncreaseDecreaseIncludingExchangeRateEffect",
  ]),
};

export const isGrandTag = (stmt: StatementCode, tag: string) => GRAND_TAGS[stmt]?.has(tag) ?? false;

/** Figures agree as filed when they differ by no more than the rounding of a printed total (0.05%). */
const agrees = (a: number, b: number) => Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * 5e-4;

/** A line whose figures equal the sum of `members` in every period where all of them have one (at least one). */
export function sumsTo(line: LineFacts, members: LineFacts[]): boolean {
  if (members.length < 2) return false;
  let checked = 0;
  for (let c = 0; c < line.values.length; c++) {
    const v = line.values[c];
    if (v == null) continue;
    let sum = 0;
    let all = true;
    for (const m of members) {
      const x = m.values[c];
      if (x == null) {
        all = false;
        break;
      }
      sum += x;
    }
    if (!all) continue;
    if (v === 0 && sum === 0) continue;
    if (!agrees(v, sum)) return false;
    checked++;
  }
  return checked > 0;
}

interface Frame {
  /** Indent level of the frame's lines; the root frame (no heading) is level 0 with depth -1 as heading. */
  head: number;
  members: LineFacts[];
  childHead: boolean;
}

/** Heading, level and total kind of every line, in order. */
export function shapeLines(lines: LineFacts[], maxDepth = 3): LineShape[] {
  const root: Frame = { head: -1, members: [], childHead: false };
  const stack: Frame[] = [root];
  /** Top-level totals since the last grand total. */
  const rootTotals: LineFacts[] = [];
  const top = () => stack[stack.length - 1];
  const level = () => Math.min(stack.length - 1, maxDepth);
  return lines.map((ln) => {
    if (!ln.hasFacts) {
      const t = top();
      if (t !== root && t.members.length > 0 && !t.childHead) stack.pop();
      const depth = level();
      top().childHead = true;
      stack.push({ head: depth, members: [], childHead: false });
      return { head: true, depth, total: null };
    }
    const t = top();
    const grand = ln.grandTag;
    const total = grand || ln.totalTag || sumsTo(ln, t.members) || (t === root && sumsTo(ln, rootTotals));
    if (!total) {
      t.members.push(ln);
      return { head: false, depth: level(), total: null };
    }
    if (t === root) {
      root.members = [];
      if (grand) rootTotals.length = 0;
      else rootTotals.push(ln);
      return { head: false, depth: 0, total: grand ? "grand" : "sub" };
    }
    stack.pop();
    const depth = Math.min(t.head, maxDepth);
    top().members.push(ln);
    return { head: false, depth, total: grand ? "grand" : "sub" };
  });
}

/**
 * Columns of a filed statement in the filing's order: shorter periods first (three months, then nine or
 * twelve), newest first within each; balance dates (instants) after the periods.
 */
export function orderColumns(keys: [string, number][]): [string, number][] {
  const dur = (q: number) => (q === 0 ? Number.POSITIVE_INFINITY : q);
  return [...keys].sort((a, b) => dur(a[1]) - dur(b[1]) || b[0].localeCompare(a[0]));
}
