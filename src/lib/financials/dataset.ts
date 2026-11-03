// Compact on-disk form of a CompanyDataset. The ingest script writes statements
// without the KPI statement (rebuilt here from the sourced lines) and without
// SourceRef values that equal the cell value. `hydrateDataset` restores both, so
// every consumer sees the full shape. Pure: shared by the app, ingest and tests.
import { buildKpis } from "./build";
import type { Cell, CompanyDataset, Row, Statement, StatementKey } from "./types";

const BANK_INDUSTRY = /bank|brokerage|consumer finance/i;
export const isBankIndustry = (industry: string | undefined) => BANK_INDUSTRY.test(industry ?? "");

type Freq = "annual" | "quarterly";
type StoredStatements = Record<Freq, Partial<Record<StatementKey, Statement>>>;

const mapCells = (rows: Row[], fn: (c: Cell) => Cell): Row[] =>
  rows.map((r) => ({ ...r, cells: r.cells.map((c) => (c ? fn(c) : null)) }));

function slimCell(c: Cell): Cell {
  if (!c.src || c.src.value !== c.v) return c;
  const { value: _drop, ...src } = c.src;
  return { ...c, src: src as Cell["src"] };
}

function fullCell(c: Cell): Cell {
  if (!c.src || c.src.value != null) return c;
  return { ...c, src: { ...c.src, value: c.v } };
}

/** Strip derivable data before writing a dataset to disk. */
export function slimDataset(d: CompanyDataset): CompanyDataset {
  const statements = {} as StoredStatements;
  for (const freq of ["annual", "quarterly"] as const) {
    const s = d.statements[freq];
    statements[freq] = {
      income: { ...s.income, rows: mapCells(s.income.rows, slimCell) },
      balance: { ...s.balance, rows: mapCells(s.balance.rows, slimCell) },
      cashflow: { ...s.cashflow, rows: mapCells(s.cashflow.rows, slimCell) },
    };
  }
  return { ...d, statements: statements as CompanyDataset["statements"] };
}

/** Restore SourceRef values and rebuild the KPI statement from the sourced lines. */
export function hydrateDataset(d: CompanyDataset): CompanyDataset {
  const bank = isBankIndustry(d.profile?.industry);
  const stored = d.statements as unknown as StoredStatements;
  const out = {} as CompanyDataset["statements"];
  for (const freq of ["annual", "quarterly"] as const) {
    const s = stored[freq];
    const fix = (st: Statement | undefined): Statement =>
      st ? { ...st, rows: mapCells(st.rows, fullCell) } : { periods: s.income?.periods ?? [], rows: [] };
    const income = fix(s.income);
    const balance = fix(s.balance);
    const cashflow = fix(s.cashflow);
    const kpis: Statement = s.kpis
      ? fix(s.kpis)
      : { periods: income.periods, rows: buildKpis(income.rows, balance.rows, cashflow.rows, income.periods, freq, { bank }) };
    out[freq] = { income, balance, cashflow, kpis };
  }
  return { ...d, statements: out };
}
