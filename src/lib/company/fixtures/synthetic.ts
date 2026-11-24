// A small synthetic company for tests: a few statement lines over quarters and fiscal years, every cell carrying a
// source reference the way a real dataset does. Used to pin how the analysis and the read handle gaps, missing lines
// and thresholds; nothing here is real data.
import type { Cell, CompanyDataset, Period, Row, Statement, Unit } from "@/lib/financials/types";

export const period = (fy: number, fq?: number): Period => {
  const end = fq ? `${fy}-${String(fq * 3).padStart(2, "0")}-${fq === 1 || fq === 4 ? "31" : "30"}` : `${fy}-12-31`;
  return fq ? { key: `FY${fy}Q${fq}`, label: `Q${fq} FY${String(fy).slice(2)}`, fy, fq, end } : { key: `FY${fy}`, label: `FY${fy}`, fy, end };
};
const cell = (v: number, key: string, p: Period): Cell => ({ v, src: { accn: `0000000000-${String(p.fy).slice(2)}-00000${p.fq ?? 0}`, concept: `us-gaap:${key}`, end: p.end, value: v } });
export type Lines = Record<string, (number | null)[]>;
function statement(periods: Period[], lines: Lines, unit: Unit = "usd"): Statement {
  const rows: Row[] = Object.entries(lines).map(([key, values]) => ({ key, label: key, unit, cells: periods.map((p, i) => (values[i] == null ? null : cell(values[i]!, key, p))) }));
  return { periods, rows };
}
type Side = { income?: Lines; balance?: Lines; cashflow?: Lines };
export interface Spec {
  quarters?: Period[];
  years?: Period[];
  q?: Side;
  a?: Side;
  industry?: string;
}
export function company(spec: Spec): CompanyDataset {
  const side = (ps: Period[], s?: Side) => ({
    income: statement(ps, s?.income ?? {}),
    balance: statement(ps, s?.balance ?? {}),
    cashflow: statement(ps, s?.cashflow ?? {}),
    kpis: statement(ps, {}),
  });
  return {
    generatedAt: "2026-01-01T00:00:00Z",
    profile: { ticker: "TEST", name: "Test Co", industry: spec.industry ?? "Software" },
    filings: [],
    statements: { annual: side(spec.years ?? [], spec.a), quarterly: side(spec.quarters ?? [], spec.q) },
    segments: [],
    insiders: [],
    earningsReleases: [],
  } as unknown as CompanyDataset;
}
/** Q1 FY24 to Q4 FY25. */
export const eightQuarters = [1, 2, 3, 4].map((q) => period(2024, q)).concat([1, 2, 3, 4].map((q) => period(2025, q)));
export const fill = (v: number, n = 8): number[] => Array.from({ length: n }, () => v);
/** Eight quarters where the first four hold one value and the last four another: last year against this year. */
export const step = (before: number, after: number): number[] => [...fill(before, 4), ...fill(after, 4)];
