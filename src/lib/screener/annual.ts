/**
 * Annual revenue across companies, aligned by the date each fiscal year ended.
 *
 * `revenueHistory` carries only the company's own label (`FY2026`), and companies close their years in
 * different months (NVDA in January, MSFT in June, AAPL in September). Each period's end date is the
 * label's year with the company's `fiscalYearEnd` (MMDD); columns are the calendar years those dates fall
 * in, so a value always sits under the year its period ended and a company with no period ending in a
 * column gets an explicit empty cell. Gapped histories (NEE has FY2011, FY2012, then FY2018 on) stay gapped.
 */

export interface AnnualCell {
  /** The company's own label, e.g. "FY2026". */
  label: string;
  /** ISO date the fiscal year ended. */
  end: string;
  value: number;
}

export interface AnnualRow {
  ticker: string;
  /** Month the company's fiscal year ends ("Jan"), or null when unknown. */
  yearEnd: string | null;
  /** One entry per column, null where the company has no period ending in that year. */
  cells: (AnnualCell | null)[];
  /** Compound annual growth from the first positive to the latest value, over the years between their end dates. */
  cagr: number | null;
}

export interface AnnualTable {
  /** Calendar years the periods ended in, oldest first. */
  years: number[];
  rows: AnnualRow[];
  /** Whether every company with a known year-end closes its year in the same month. */
  sameYearEnd: boolean;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseEnd(fye: string | null | undefined): { mm: string; dd: string } | null {
  const m = /^(\d{2})-?(\d{2})$/.exec((fye ?? "").trim());
  if (!m) return null;
  const mo = Number(m[1]);
  const d = Number(m[2]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? { mm: m[1], dd: m[2] } : null;
}

export function alignAnnual(
  companies: { ticker: string; fiscalYearEnd?: string | null; history: [string, number][] }[],
  maxYears = 10,
): AnnualTable {
  const parsed = companies.map((c) => {
    const fe = parseEnd(c.fiscalYearEnd);
    const byYear = new Map<number, AnnualCell>();
    for (const [label, value] of c.history) {
      const y = Number(/(\d{4})/.exec(label)?.[1]);
      if (!Number.isFinite(y) || !Number.isFinite(value)) continue;
      // Without a known year-end the label's year stands in for the end year (ends dated 31 Dec).
      const end = `${y}-${fe?.mm ?? "12"}-${fe?.dd ?? "31"}`;
      byYear.set(y, { label, end, value });
    }
    return { ticker: c.ticker, fe, byYear };
  });
  const all = [...new Set(parsed.flatMap((p) => [...p.byYear.keys()]))].sort((a, b) => a - b);
  const years = all.slice(-maxYears);
  const rows: AnnualRow[] = parsed.map(({ ticker, fe, byYear }) => {
    const cells = years.map((y) => byYear.get(y) ?? null);
    const own = [...byYear.entries()].filter(([y]) => years.includes(y)).sort((a, b) => a[0] - b[0]);
    const first = own.find(([, c]) => c.value > 0);
    const last = own.at(-1);
    const span = first && last ? last[0] - first[0] : 0;
    const cagr = first && last && span > 0 && last[1].value > 0 ? (last[1].value / first[1].value) ** (1 / span) - 1 : null;
    return { ticker, yearEnd: fe ? MONTHS[Number(fe.mm) - 1] : null, cells, cagr };
  });
  const ends = new Set(parsed.filter((p) => p.fe && p.byYear.size).map((p) => p.fe!.mm));
  return { years, rows, sameYearEnd: ends.size <= 1 };
}
