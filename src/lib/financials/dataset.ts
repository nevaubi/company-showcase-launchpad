// Compact on-disk form of a CompanyDataset. The ingest script writes statements
// without the KPI statement (rebuilt here from the sourced lines) and without
// SourceRef values that equal the cell value. `hydrateDataset` restores both, so
// every consumer sees the full shape. Pure: shared by the app, ingest and tests.
import { buildKpis } from "./build";
import { rederiveQuarters, restateBalanceForSplits, restateIncomeForSplits, shareBasis, splitSteps } from "./splits";
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
  // Splits are read off the quarterly share counts, where a restated count sits within a couple of percent of
  // a round multiple. Those factors then confirm the looser year-over-year steps.
  const known = stored.quarterly?.income ? splitSteps(shareBasis(stored.quarterly.income)) : [];
  for (const freq of ["annual", "quarterly"] as const) {
    const s = stored[freq];
    const fix = (st: Statement | undefined): Statement =>
      st ? { ...st, rows: mapCells(st.rows, fullCell) } : { periods: s.income?.periods ?? [], rows: [] };
    // Per-share figures and share counts go onto today's share basis before anything is computed from them.
    const income = restateIncomeForSplits(fix(s.income), undefined, known);
    const balance = restateBalanceForSplits(fix(s.balance), undefined, known);
    const cashflow = fix(s.cashflow);
    const kpis: Statement = s.kpis
      ? fix(s.kpis)
      : { periods: income.periods, rows: buildKpis(income.rows, balance.rows, cashflow.rows, income.periods, freq, { bank }) };
    out[freq] = { income, balance, cashflow, kpis };
  }
  if (out.quarterly && out.annual) {
    const income = rederiveQuarters(out.quarterly.income, out.annual.income);
    if (income !== out.quarterly.income) {
      out.quarterly = {
        ...out.quarterly,
        income,
        kpis: stored.quarterly.kpis ? out.quarterly.kpis : { periods: income.periods, rows: buildKpis(income.rows, out.quarterly.balance.rows, out.quarterly.cashflow.rows, income.periods, "quarterly", { bank }) },
      };
    }
  }
  return { ...d, statements: out };
}
