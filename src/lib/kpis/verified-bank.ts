import type { Database } from "@/integrations/supabase/types";

export type VerifiedBankPoint = Database["public"]["Tables"]["verified_bank_kpi_points"]["Row"];
/** Period end, normalized amount, period label, source id, page, quote, sheet, cell, formula, printed amount. */
export type StdPoint = [
  string,
  number,
  string,
  string | null,
  number | null,
  string | null,
  string | null,
  string | null,
  string | null,
  number | null,
];
interface StdSeries {
  kpi_id: string;
  name: string;
  unit: string | null;
  Q: StdPoint[];
  A: StdPoint[];
  alts: unknown[];
  current: boolean;
}
export interface StdCompany {
  ticker: string;
  sector: string | null;
  industry: string | null;
  series: Record<string, StdSeries>;
  docs: Record<string, (string | null)[]>;
}
export type LatestPoint = [string, number, string, number | null] | null;
export interface StandardLatest {
  generated: string;
  kpis: Record<
    string,
    Record<
      string,
      {
        q: LatestPoint;
        a: LatestPoint;
        ind: string;
        sec: string;
        kpi_id: string;
        verified?: VerifiedBankPoint;
      }
    >
  >;
}

// These partner series mix segment, income, or mis-scaled amounts with consolidated balances.
// A missing or inaccessible source receipt must never restore them to the matrix or peer ranks.
const quarantined: Record<string, readonly string[]> = {
  // Quarterly segment totals or other income-statement line items.
  ALLY: ["total_revenue"],
  COLB: ["loans"],
  FHN: ["total_revenue"],
  FITB: ["total_revenue"],
  ONB: ["total_revenue"],
  HBAN: ["loans", "total_revenue"],
  HOMB: ["loans"],
  RF: ["total_revenue"],
  WAL: ["loans"],
  // Balance-sheet mix, loan yield and energy portfolio exposure.
  STT: ["loans"],
  UBSI: ["loans"],
  ZION: ["loans"],
  // Retail or asset-management segment, loan interest, period averages or taxable-equivalent basis.
  KEY: ["avg_deposits", "avg_loans", "loans", "total_revenue"],
  PNC: ["avg_deposits", "avg_loans", "loans", "total_revenue"],
};

/** Preserve million-dollar distinctions in the compact filing column; the source retains the full integer amount. */
export function compactBankAmount(usd: number) {
  const scale = Math.abs(usd) >= 1e9 ? 1e9 : Math.abs(usd) >= 1e6 ? 1e6 : 1;
  const number = (usd / scale).toLocaleString("en-US", { maximumFractionDigits: 3 });
  return `$${number}${scale === 1e9 ? "B" : scale === 1e6 ? "M" : ""}`;
}

export const filingBankTaxonomy = [
  ["avg_deposits", "Average deposits", "Banks", "Average deposits in the period."],
  ["avg_loans", "Average loans", "Banks", "Average loans outstanding in the period."],
  ["loans", "Total loans", "Banks", "Loans outstanding at period end."],
  ["total_revenue", "Total revenue", "Financial", "Total revenue or net sales for the period."],
].map(([id, name, family, definition]) => ({
  id,
  name,
  family,
  definition,
  uclass: "usd",
  unit: "USD",
  higher_is_better: true,
}));

export function isReviewedBank(ticker: string) {
  return Object.hasOwn(quarantined, ticker);
}

export function standaloneBankCompany(ticker: string, points: readonly VerifiedBankPoint[]) {
  if (!isReviewedBank(ticker) || !points.some((p) => p.ticker === ticker)) return undefined;
  return reviewedBankCompany(
    { ticker, sector: "Financials", industry: "Banks", series: {}, docs: {} },
    points,
  );
}

function verifiedSeries(points: readonly VerifiedBankPoint[], ticker: string, metric: string) {
  return points
    .filter((p) => p.ticker === ticker && p.metric === metric && Number.isFinite(p.amount_usd))
    .sort((a, b) => a.period_end.localeCompare(b.period_end));
}

export function reviewedBankCompany(
  raw: StdCompany,
  points: readonly VerifiedBankPoint[],
): StdCompany {
  const held = quarantined[raw.ticker];
  if (!held) return raw;
  const series = { ...raw.series };
  const docs = { ...raw.docs };
  for (const metric of held) {
    delete series[metric];
    const rows = verifiedSeries(points, raw.ticker, metric);
    const last = rows.at(-1);
    if (!last) continue;
    series[metric] = {
      kpi_id: `filing:${raw.ticker}:${metric}`,
      name: `${last.issuer_label} · consolidated`,
      unit: "USD",
      current: true,
      alts: [],
      A: [],
      Q: rows.map((p): StdPoint => {
        const doc = `filing:${raw.ticker}:${metric}:${p.period_end}`;
        docs[doc] = [`${p.source_section} · filed ${p.published_on}`, null, ".htm", p.filing_url];
        return [
          p.period_end,
          p.amount_usd,
          p.period_label,
          doc,
          null,
          p.source_quote,
          null,
          null,
          null,
          null,
        ];
      }),
    };
  }
  return { ...raw, series, docs };
}

export function reviewedBankLatest(
  raw: StandardLatest,
  points: readonly VerifiedBankPoint[],
): StandardLatest {
  const kpis = { ...raw.kpis };
  const copied = new Set<string>();
  for (const [ticker, metrics] of Object.entries(quarantined)) {
    for (const metric of metrics) {
      if (!copied.has(metric)) {
        kpis[metric] = { ...kpis[metric] };
        copied.add(metric);
      }
      const column = kpis[metric];
      const previous = column[ticker];
      delete column[ticker];
      const rows = verifiedSeries(points, ticker, metric);
      const last = rows.at(-1);
      if (!last) continue;
      const priorEnd = new Date(last.period_end);
      priorEnd.setUTCFullYear(priorEnd.getUTCFullYear() - 1);
      const prior = rows.find((p) => p.period_end === priorEnd.toISOString().slice(0, 10));
      const yoy =
        prior && prior.amount_usd !== 0
          ? (last.amount_usd - prior.amount_usd) / Math.abs(prior.amount_usd)
          : null;
      column[ticker] = {
        ind: previous?.ind ?? "Banks",
        sec: previous?.sec ?? "Financials",
        kpi_id: `filing:${ticker}:${metric}`,
        q: [last.period_end, last.amount_usd, last.period_label, yoy],
        a: null,
        verified: last,
      };
    }
  }
  return { ...raw, kpis };
}
