// Point-in-time ("as known on") views of a company dataset. A value counts as known on a date when the filing that
// reported it (or another filing that reported the identical value) was filed on or before that date. Pure.
import type { Bar, Cell, CompanyDataset, Filing, InsiderTrade, Statement } from "@/lib/financials/types";

export type FiledOf = (accn: string | undefined) => string | null;

export function filedIndex(filings: Filing[]): FiledOf {
  const m = new Map(filings.map((f) => [f.accn, f.filed]));
  return (accn) => (accn ? (m.get(accn) ?? null) : null);
}

/** Earliest date a cell's value was on file: its source filing or any filing that reported the same value. */
export function knownSince(c: Cell, filedOf: FiledOf): string | null {
  const dates: string[] = [];
  const a = filedOf(c.src?.accn);
  if (a) dates.push(a);
  for (const alt of c.alts ?? []) {
    const d = filedOf(alt);
    if (d) dates.push(d);
  }
  if (!dates.length && c.derived?.parts?.length) {
    // a derived value is known once every input is known
    const parts = c.derived.parts.map((p) => filedOf(p.accn));
    if (parts.every((p): p is string => !!p)) return parts.sort().at(-1)!;
    return null;
  }
  return dates.length ? dates.sort()[0] : null;
}

export interface AsOfStatement {
  statement: Statement;
  /** cells dropped because they were filed after the date */
  dropped: number;
  /** cells dropped because their filing is not in the dataset's filing list */
  unverifiable: number;
}

/** Keep only cells on file by `asof`; drop periods with nothing known. */
export function statementAsOf(st: Statement, filedOf: FiledOf, asof: string): AsOfStatement {
  let dropped = 0;
  let unverifiable = 0;
  const rows = st.rows.map((r) => ({
    ...r,
    cells: r.cells.map((c) => {
      if (!c) return null;
      const since = knownSince(c, filedOf);
      if (!since) {
        unverifiable++;
        return null;
      }
      if (since > asof) {
        dropped++;
        return null;
      }
      return c;
    }),
  }));
  const keep = st.periods.map((_, i) => rows.some((r) => r.cells[i] != null));
  return {
    statement: {
      periods: st.periods.filter((_, i) => keep[i]),
      rows: rows.map((r) => ({ ...r, cells: r.cells.filter((_, i) => keep[i]) })).filter((r) => r.cells.some((c) => c != null)),
    },
    dropped,
    unverifiable,
  };
}

export const filingsAsOf = (filings: Filing[], asof: string) => filings.filter((f) => f.filed <= asof);
export const insidersAsOf = (trades: InsiderTrade[], asof: string) => trades.filter((t) => t.filed <= asof);

/** Close on or before `asof` from compact bars [date, open, high, low, close, adjClose, volume]. */
export function priceAt(bars: Bar[] | undefined, asof: string): { date: string; close: number } | null {
  if (!bars?.length) return null;
  let hit: Bar | null = null;
  for (const b of bars) {
    if (b[0].slice(0, 10) <= asof) hit = b;
    else break;
  }
  return hit ? { date: hit[0].slice(0, 10), close: hit[4] } : null;
}

/** Sum of the last four known quarters of a row (e.g. diluted EPS) in an as-of quarterly statement. */
export function ttmOf(st: Statement, key: string): { value: number; periods: string[] } | null {
  const row = st.rows.find((r) => r.key === key);
  if (!row) return null;
  const idx: number[] = [];
  for (let i = row.cells.length - 1; i >= 0 && idx.length < 4; i--) if (row.cells[i]) idx.push(i);
  if (idx.length < 4) return null;
  // the four must be consecutive quarters
  if (idx[0] - idx[3] !== 3) return null;
  return { value: idx.reduce((s, i) => s + row.cells[i]!.v, 0), periods: idx.map((i) => st.periods[i].label).reverse() };
}

export interface AsOfSnapshot {
  asof: string;
  quarterly: AsOfStatement;
  annual: AsOfStatement;
  filings: Filing[];
  insiders: InsiderTrade[];
  latestFiling: Filing | null;
}

export function snapshot(d: CompanyDataset, asof: string): AsOfSnapshot {
  const filedOf = filedIndex(d.filings);
  const filings = filingsAsOf(d.filings, asof).sort((a, b) => b.filed.localeCompare(a.filed));
  return {
    asof,
    quarterly: statementAsOf(d.statements.quarterly.income, filedOf, asof),
    annual: statementAsOf(d.statements.annual.income, filedOf, asof),
    filings,
    insiders: insidersAsOf(d.insiders, asof),
    latestFiling: filings.find((f) => ["10-K", "10-Q", "20-F", "40-F"].includes(f.form)) ?? null,
  };
}

/** What a point-in-time view can and cannot rewind, for the on-page label. */
export const ASOF_COVERAGE = {
  rewound: [
    "Reported financials (only periods filed by the date; values shown as currently reported)",
    "SEC filings list",
    "Insider transactions (by filing date)",
    "Share price and P/E on the date",
  ],
  notRewound: [
    "Restatements made after the date (today's figure is shown for each period)",
    "Analyst estimates and price targets (only the current snapshot is stored)",
    "IR KPIs and segment data (not versioned by filing date)",
    "Supply-chain links and alt data",
  ],
};
