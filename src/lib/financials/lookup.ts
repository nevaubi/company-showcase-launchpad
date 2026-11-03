import type { Cell, CompanyDataset, Row, Statement, StatementKey } from "./types";

export const STATEMENT_KEYS: StatementKey[] = ["income", "balance", "cashflow", "kpis"];

export interface Lookup {
  value: number;
  unit: Row["unit"];
  label: string;
  period: string;
  statement: StatementKey;
  freq: "annual" | "quarterly";
  cell: Cell | null;
  /** Indices of quarters summed for TTM */
  ttm?: number[];
}

/** Normalise "q2 fy27", "FY2027Q2", "fy25", "2025" into the dataset's period label/key forms. */
export function normalisePeriod(p: string): { freq: "annual" | "quarterly" | "ttm" | "latest"; label?: string; key?: string } {
  const s = p.trim().toUpperCase().replace(/\s+/g, " ");
  if (s === "TTM" || s === "LTM") return { freq: "ttm" };
  if (s === "LATEST" || s === "LAST" || s === "MRQ") return { freq: "latest" };
  let m = s.match(/^Q([1-4]) ?FY ?(\d{2}|\d{4})$/);
  if (m) {
    const yy = m[2].length === 2 ? `20${m[2]}` : m[2];
    return { freq: "quarterly", key: `FY${yy}Q${m[1]}` };
  }
  m = s.match(/^FY ?(\d{4})Q([1-4])$/);
  if (m) return { freq: "quarterly", key: `FY${m[1]}Q${m[2]}` };
  m = s.match(/^(?:FY ?)?(\d{2}|\d{4})$/);
  if (m) return { freq: "annual", key: `FY${m[1].length === 2 ? `20${m[1]}` : m[1]}` };
  return { freq: "annual", label: p.trim() };
}

function findRow(d: CompanyDataset, freq: "annual" | "quarterly", metric: string): { st: Statement; key: StatementKey; row: Row } | null {
  const want = metric.trim().toLowerCase();
  for (const key of STATEMENT_KEYS) {
    const st = d.statements[freq][key];
    const row = st.rows.find((r) => r.key.toLowerCase() === want) ?? st.rows.find((r) => r.label.toLowerCase() === want);
    if (row) return { st, key, row };
  }
  return null;
}

export function lookup(d: CompanyDataset, metric: string, period = "latest"): Lookup | { error: string } {
  const p = normalisePeriod(period);
  if (p.freq === "ttm" || p.freq === "latest") {
    const f = findRow(d, "quarterly", metric);
    if (!f) return { error: `Unknown metric "${metric}"` };
    let end = f.row.cells.length - 1;
    while (end >= 0 && !f.row.cells[end]) end--;
    if (end < 0) return { error: `No data for ${metric}` };
    if (p.freq === "latest" || f.row.unit === "pct" || f.row.unit === "ratio" || f.key === "balance") {
      return { value: f.row.cells[end]!.v, unit: f.row.unit, label: f.row.label, period: f.st.periods[end].label, statement: f.key, freq: "quarterly", cell: f.row.cells[end] };
    }
    const idx = [end - 3, end - 2, end - 1, end];
    if (idx[0] < 0 || idx.some((i) => !f.row.cells[i])) return { error: `Not enough quarters for TTM ${metric}` };
    return {
      value: idx.reduce((s, i) => s + f.row.cells[i]!.v, 0),
      unit: f.row.unit,
      label: f.row.label,
      period: `TTM ${f.st.periods[end].label}`,
      statement: f.key,
      freq: "quarterly",
      cell: null,
      ttm: idx,
    };
  }
  const f = findRow(d, p.freq, metric);
  if (!f) return { error: `Unknown metric "${metric}"` };
  const i = f.st.periods.findIndex((x) => (p.key ? x.key === p.key : x.label.toUpperCase() === p.label!.toUpperCase()));
  if (i < 0) return { error: `No ${p.freq} period ${period} for ${d.profile.ticker}` };
  const c = f.row.cells[i];
  if (!c) return { error: `${f.row.label} not reported for ${f.st.periods[i].label}` };
  return { value: c.v, unit: f.row.unit, label: f.row.label, period: f.st.periods[i].label, statement: f.key, freq: p.freq, cell: c };
}

export function metricCatalog(d: CompanyDataset) {
  return STATEMENT_KEYS.map((k) => ({ statement: k, metrics: d.statements.annual[k].rows.map((r) => `${r.key} (${r.label})`) }));
}
