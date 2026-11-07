// Sector roll-ups from the covered companies' SEC fundamentals. Aggregates are
// "index-style" (sum of numerators ÷ sum of denominators), so large companies weigh
// more, like a cap-weighted sector ETF. Pure: shared by the app and tests.
import type { UniverseEntry } from "./types";
import { isBankIndustry } from "./dataset";

export interface CompanyMetrics {
  ticker: string;
  name: string;
  sector: string;
  industry: string;
  bank: boolean;
  mcap: number | null;
  revenue: number | null;
  netIncome: number | null;
  operatingIncome: number | null;
  fcf: number | null;
  ebitda: number | null;
  netDebt: number | null;
  growth: number | null;
  cagr3y: number | null;
  pe: number | null;
  fcfYield: number | null;
  opMargin: number | null;
}

/**
 * Share count for market cap: the latest quarter's diluted weighted shares, unless it disagrees with the
 * cover-page count by more than 3x (a scale error in the filing's XBRL), then the cover-page count.
 */
export function sharesFor(u: Pick<UniverseEntry, "sharesOutstanding" | "f">): number | null {
  const d = u.f?.dilutedShares ?? null,
    c = u.sharesOutstanding ?? null;
  if (d && c) return d / c > 3 || d / c < 1 / 3 ? c : d;
  return d ?? c;
}

export function companyMetrics(u: UniverseEntry, price: number | null | undefined): CompanyMetrics {
  const f = u.f;
  const bank = isBankIndustry(u.industry);
  const shares = sharesFor(u);
  const mcap = price && shares ? price * shares : null;
  const revenue = f?.ttm.revenue ?? u.revenueTTM ?? null;
  const netIncome = f?.ttm.netIncome ?? u.netIncomeTTM ?? null;
  // Filers without an operating-income subtotal (integrated oils) fall back to EBIT = EBITDA − D&A.
  const ebit =
    f?.ttm.ebitda != null && f.ttm.dna != null ? f.ttm.ebitda - Math.abs(f.ttm.dna) : null;
  const operatingIncome = f?.ttm.operatingIncome ?? (bank ? null : ebit);
  const fcf = bank ? null : (f?.ttm.fcf ?? u.fcfTTM ?? null);
  return {
    ticker: u.ticker,
    name: u.name,
    sector: u.sector,
    industry: u.industry,
    bank,
    mcap,
    revenue,
    netIncome,
    operatingIncome,
    fcf,
    ebitda: bank ? null : (f?.ttm.ebitda ?? null),
    netDebt: bank ? null : (f?.bs.netDebt ?? null),
    growth: u.revenueGrowthYoY,
    cagr3y: f?.revenueCagr3y ?? null,
    pe: mcap && netIncome && netIncome > 0 ? mcap / netIncome : null,
    fcfYield: mcap && fcf != null ? fcf / mcap : null,
    opMargin: revenue && operatingIncome != null ? operatingIncome / revenue : null,
  };
}

export interface SectorAggregate {
  sector: string;
  count: number;
  mcap: number;
  revenue: number;
  netMargin: number | null;
  opMargin: number | null;
  fcfMargin: number | null;
  /** Σ market cap ÷ Σ net income over profitable members */
  pe: number | null;
  fcfYield: number | null;
  netDebtToEbitda: number | null;
  medianGrowth: number | null;
  medianCagr3y: number | null;
  members: CompanyMetrics[];
}

const median = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
};

const ratio = (
  rows: CompanyMetrics[],
  num: (r: CompanyMetrics) => number | null,
  den: (r: CompanyMetrics) => number | null,
) => {
  let n = 0;
  let d = 0;
  for (const r of rows) {
    const a = num(r);
    const b = den(r);
    if (a == null || b == null) continue;
    n += a;
    d += b;
  }
  return d > 0 ? n / d : null;
};

export function aggregateSectors(rows: CompanyMetrics[]): SectorAggregate[] {
  const by = new Map<string, CompanyMetrics[]>();
  for (const r of rows) by.set(r.sector, [...(by.get(r.sector) ?? []), r]);
  return [...by.entries()]
    .map(([sector, members]) => {
      const profitable = members.filter((m) => (m.netIncome ?? 0) > 0);
      return {
        sector,
        count: members.length,
        mcap: members.reduce((s, m) => s + (m.mcap ?? 0), 0),
        revenue: members.reduce((s, m) => s + (m.revenue ?? 0), 0),
        netMargin: ratio(
          members,
          (m) => m.netIncome,
          (m) => m.revenue,
        ),
        opMargin: ratio(
          members.filter((m) => m.operatingIncome != null),
          (m) => m.operatingIncome,
          (m) => m.revenue,
        ),
        fcfMargin: ratio(
          members.filter((m) => !m.bank),
          (m) => m.fcf,
          (m) => m.revenue,
        ),
        pe: ratio(
          profitable,
          (m) => m.mcap,
          (m) => (m.mcap != null ? m.netIncome : null),
        ),
        fcfYield: ratio(
          members.filter((m) => !m.bank),
          (m) => m.fcf,
          (m) => m.mcap,
        ),
        netDebtToEbitda: ratio(
          members.filter((m) => !m.bank && m.ebitda != null && m.ebitda > 0),
          (m) => m.netDebt,
          (m) => m.ebitda,
        ),
        medianGrowth: median(members.map((m) => m.growth)),
        medianCagr3y: median(members.map((m) => m.cagr3y)),
        members: [...members].sort((a, b) => (b.mcap ?? 0) - (a.mcap ?? 0)),
      };
    })
    .sort((a, b) => b.mcap - a.mcap);
}
