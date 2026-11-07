// Holdings import: CSV (with or without a header) or pasted lines such as "AAPL 120", "MSFT, 12%", "NVDA".
// Pure: shared by the import dialog and tests.

export interface Holding {
  ticker: string;
  /** share count, when given */
  shares: number | null;
  /** portfolio weight as a fraction (0.12 = 12%), when given */
  weight: number | null;
  /** cost basis per share, when given */
  cost: number | null;
}

export interface ParseResult {
  holdings: Holding[];
  /** lines that could not be read, with the reason */
  errors: string[];
  /** tickers not in the covered universe (kept out of `holdings` when a universe is supplied) */
  unknown: string[];
}

const TICKER_COLS = ["ticker", "symbol", "code", "security", "instrument"];
const SHARE_COLS = ["shares", "quantity", "qty", "units", "position", "holding", "amount"];
const WEIGHT_COLS = ["weight", "allocation", "pct", "percent", "%", "portfolio %", "weight %", "% of portfolio"];
const COST_COLS = ["cost", "cost basis", "basis", "avg cost", "average cost", "price paid", "cost/share", "unit cost"];

/** "brk.b" / "BRK/B" / "brk b" -> "BRK-B"; strips exchange prefixes like "NASDAQ:". */
export function normTicker(raw: string): string {
  let t = raw.trim().toUpperCase().replace(/^\$/, "");
  t = t.replace(/^(NASDAQ|NYSE|NYSEARCA|AMEX|BATS|ARCA|US):/, "");
  t = t.replace(/[./ ]/g, "-");
  return t.replace(/[^A-Z0-9-]/g, "");
}

function splitLine(line: string): string[] {
  // CSV with quotes, else tabs/semicolons/commas, else whitespace
  if (line.includes('"')) {
    const out: string[] = [];
    let cur = "";
    let q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (!q && (ch === "," || ch === "\t" || ch === ";")) {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  }
  if (/[\t;,]/.test(line)) return line.split(/[\t;,]/).map((s) => s.trim());
  return line.trim().split(/\s+/);
}

/** "1,234.5" -> 1234.5, "12%" -> {pct}, "$45.10" -> 45.1 */
function num(s: string | undefined): { v: number; pct: boolean } | null {
  if (s == null) return null;
  const t = s.trim();
  if (!t) return null;
  const pct = t.endsWith("%");
  const v = Number(t.replace(/[$,%\s]/g, "").replace(/^\((.*)\)$/, "-$1"));
  return Number.isFinite(v) ? { v, pct } : null;
}

function findCol(header: string[], names: string[]): number {
  const h = header.map((x) => x.trim().toLowerCase());
  for (const n of names) {
    const i = h.indexOf(n);
    if (i >= 0) return i;
  }
  for (const n of names) {
    const i = h.findIndex((x) => x.includes(n));
    if (i >= 0) return i;
  }
  return -1;
}

const looksLikeTicker = (s: string) => /^[$A-Za-z][A-Za-z0-9.\-/:]{0,14}$/.test(s.trim());

export function parseHoldings(text: string, universe?: Set<string>): ParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  const errors: string[] = [];
  const unknown = new Set<string>();
  const merged = new Map<string, Holding>();
  if (!lines.length) return { holdings: [], errors, unknown: [] };

  const first = splitLine(lines[0]);
  const hasHeader = findCol(first, TICKER_COLS) >= 0 && !first.some((c) => num(c));
  let cols = { t: 0, s: -1, w: -1, c: -1 };
  if (hasHeader) {
    cols = { t: findCol(first, TICKER_COLS), s: findCol(first, SHARE_COLS), w: findCol(first, WEIGHT_COLS), c: findCol(first, COST_COLS) };
  }
  const body = hasHeader ? lines.slice(1) : lines;

  body.forEach((line, i) => {
    const cells = splitLine(line);
    const n = i + (hasHeader ? 2 : 1);
    let ticker = "";
    let shares: number | null = null;
    let weight: number | null = null;
    let cost: number | null = null;
    if (hasHeader) {
      ticker = cells[cols.t] ?? "";
      const s = cols.s >= 0 ? num(cells[cols.s]) : null;
      const w = cols.w >= 0 ? num(cells[cols.w]) : null;
      const c = cols.c >= 0 ? num(cells[cols.c]) : null;
      if (s) shares = s.v;
      if (w) weight = w.pct || w.v > 1 ? w.v / 100 : w.v;
      if (c) cost = c.v;
    } else {
      ticker = cells.find(looksLikeTicker) ?? "";
      const rest = cells.filter((c) => c !== ticker);
      const nums = rest.map(num).filter((x): x is { v: number; pct: boolean } => !!x);
      const pct = nums.find((x) => x.pct);
      if (pct) weight = pct.v / 100;
      const plain = nums.filter((x) => !x.pct);
      if (plain[0]) shares = plain[0].v;
      if (plain[1]) cost = plain[1].v;
    }
    const t = normTicker(ticker);
    if (!t || !looksLikeTicker(t)) {
      errors.push(`Line ${n}: no ticker found in "${line.slice(0, 60)}"`);
      return;
    }
    if (shares != null && shares < 0) {
      errors.push(`Line ${n}: ${t} has a negative share count (short positions are not supported yet)`);
      return;
    }
    if (weight != null && (weight < 0 || weight > 1)) {
      errors.push(`Line ${n}: ${t} weight ${(weight * 100).toFixed(1)}% is outside 0-100%`);
      return;
    }
    if (universe && !universe.has(t)) {
      unknown.add(t);
      return;
    }
    const prev = merged.get(t);
    if (prev) {
      merged.set(t, {
        ticker: t,
        shares: prev.shares != null || shares != null ? (prev.shares ?? 0) + (shares ?? 0) : null,
        weight: prev.weight != null || weight != null ? (prev.weight ?? 0) + (weight ?? 0) : null,
        cost: prev.cost ?? cost,
      });
    } else merged.set(t, { ticker: t, shares, weight, cost });
  });
  return { holdings: [...merged.values()], errors, unknown: [...unknown] };
}

/** Holdings back to CSV (for export and editing). */
export function holdingsToCsv(h: Holding[]): string {
  const rows = h.map((x) => [x.ticker, x.shares ?? "", x.weight != null ? `${(x.weight * 100).toFixed(4)}%` : "", x.cost ?? ""].join(","));
  return ["ticker,shares,weight,cost", ...rows].join("\n");
}
