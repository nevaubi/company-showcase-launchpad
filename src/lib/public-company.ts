// Public sample company pages: a small, sourced snapshot built from the stored SEC dataset.
// Pure (no Node/browser APIs) so the server function, the page and tests share it.
import type { CompanyDataset, Statement, StatementKey } from "@/lib/financials/types";
import { COVERAGE } from "@/lib/coverage";

/** Every covered company has a public, indexable snapshot page. */
export const PUBLIC_COMPANIES = COVERAGE.map((c) => ({
  ticker: c.ticker,
  name: c.shortName,
  sector: c.sector,
  industry: c.industry,
}));
export const PUBLIC_TICKERS = PUBLIC_COMPANIES.map((c) => c.ticker);
const NAMES = new Map(PUBLIC_COMPANIES.map((c) => [c.ticker, c.name]));
const BY_T = new Map(PUBLIC_COMPANIES.map((c) => [c.ticker, c]));
/** Same-industry companies for internal links between public pages. */
export function publicPeers(ticker: string, n = 8) {
  const me = BY_T.get(ticker.toUpperCase());
  if (!me) return [];
  return PUBLIC_COMPANIES.filter((c) => c.ticker !== me.ticker && c.industry === me.industry).slice(
    0,
    n,
  );
}
/** Featured on the index and as quick links. */
export const FEATURED_TICKERS = ["NVDA", "AAPL", "BAC"];

export function isPublicTicker(t: string): boolean {
  return NAMES.has(t.toUpperCase());
}

export interface PublicSource {
  form: string;
  filed: string | null;
  accn: string;
  concept: string;
  url: string;
}
export interface PublicLine {
  key: string;
  label: string;
  unit: string;
  values: { period: string; value: number; source: PublicSource | null; derived: string | null }[];
}
export interface PublicFiling {
  form: string;
  filed: string;
  desc: string | null;
  url: string;
}
export interface PublicSnapshot {
  ticker: string;
  name: string;
  exchange: string;
  sector: string;
  industry: string;
  city: string | null;
  website: string | null;
  investorRelations: string | null;
  description: string | null;
  logo: string | null;
  periods: string[];
  lines: PublicLine[];
  filings: PublicFiling[];
}

const LINES: [StatementKey, string][] = [
  ["income", "revenue"],
  ["income", "netIncome"],
  ["income", "epsDiluted"],
  ["cashflow", "cfo"],
  ["cashflow", "fcf"],
  ["balance", "totalAssets"],
];

export function secDocUrl(cik: string, accn: string, doc?: string): string {
  const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accn.replace(/-/g, "")}`;
  return doc ? `${base}/${doc}` : `${base}/`;
}

/**
 * `details` are the server-only coverage details: a profile of the generated list carries no description until the
 * partner's next build, so the page takes it from there. Sector and industry come from the coverage list, the
 * same source as the app's own pages, never from a stale profile.
 */
export function buildPublicSnapshot(
  d: CompanyDataset,
  years = 5,
  details?: { description?: string },
): PublicSnapshot {
  const p = d.profile;
  const listed = BY_T.get(p.ticker);
  const byAccn = new Map(d.filings.map((f) => [f.accn, f]));
  const annual = d.statements.annual as Record<StatementKey, Statement>;
  const periods = annual.income.periods.slice(-years);
  const lines: PublicLine[] = [];
  for (const [st, key] of LINES) {
    const s = annual[st];
    const row = s?.rows.find((r) => r.key === key);
    if (!row) continue;
    const values = periods.flatMap((per) => {
      const i = s.periods.findIndex((x) => x.key === per.key);
      const c = i >= 0 ? row.cells[i] : null;
      if (!c || !Number.isFinite(c.v)) return [];
      const f = c.src ? byAccn.get(c.src.accn) : undefined;
      const source = c.src
        ? {
            form: f?.form ?? "10-K",
            filed: f?.filed ?? null,
            accn: c.src.accn,
            concept: c.src.concept,
            url: secDocUrl(p.cik, c.src.accn, c.src.doc ?? f?.doc),
          }
        : null;
      return [{ period: per.label, value: c.v, source, derived: c.derived?.formula ?? null }];
    });
    // Only show values that trace back to a filing.
    const sourced = values.filter((v) => v.source || v.derived);
    if (sourced.length) lines.push({ key, label: row.label, unit: row.unit, values: sourced });
  }
  const filings = d.filings
    .filter((f) => ["10-K", "10-Q", "8-K", "DEF 14A"].includes(f.form))
    .sort((a, b) => (a.filed < b.filed ? 1 : -1))
    .slice(0, 6)
    .map((f) => ({
      form: f.form,
      filed: f.filed,
      desc: f.desc ?? null,
      url: secDocUrl(p.cik, f.accn, f.doc),
    }));
  const addr = (p as { address?: { city?: string; state?: string } }).address;
  return {
    ticker: p.ticker,
    name: NAMES.get(p.ticker) ?? p.name,
    exchange: p.exchange,
    sector: listed?.sector ?? p.sector,
    industry: listed?.industry ?? p.industry,
    website: p.website || null,
    investorRelations: p.investorRelations || null,
    city: addr?.city ? `${addr.city}${addr.state ? `, ${addr.state}` : ""}` : null,
    description:
      (p as { description?: string }).description?.trim() || details?.description?.trim() || null,
    logo: (p as { logo?: string }).logo ?? null,
    periods: periods.map((x) => x.label),
    lines,
    filings,
  };
}
