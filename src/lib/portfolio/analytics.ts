// Portfolio analytics over the covered universe. Pure functions: positions in, measures out, each measure keeping
// the evidence (filing quote, accession) or the inputs it was computed from. No composite scores.
import { normText, simulateShock, type RiskLink, type ShockImpact } from "@/lib/supply/core";
import type { Holding } from "./parse";

export interface PositionMeta {
  name: string;
  sector: string;
  industry: string;
  mcap: number | null;
}

export interface Position {
  ticker: string;
  name: string;
  sector: string;
  industry: string;
  shares: number | null;
  price: number | null;
  value: number | null;
  weight: number;
  cost: number | null;
  mcap: number | null;
}

export type WeightBasis = "value" | "weights" | "mixed" | "equal";

/**
 * Weights: market value when every holding has shares and a price; the given weights when every holding has
 * one; otherwise given weights first and the rest split evenly by value share (stated as "mixed").
 */
export function buildPositions(
  holdings: Holding[],
  prices: Map<string, number | null | undefined>,
  meta: Map<string, PositionMeta>,
): { positions: Position[]; basis: WeightBasis; total: number | null } {
  const base = holdings.map((h) => {
    const m = meta.get(h.ticker);
    const price = prices.get(h.ticker) ?? null;
    const value = h.shares != null && price != null ? h.shares * price : null;
    return { h, m, price, value };
  });
  const allValue = base.length > 0 && base.every((b) => b.value != null && b.value > 0);
  const allWeight = base.length > 0 && base.every((b) => b.h.weight != null);
  const total = base.reduce((s, b) => s + (b.value ?? 0), 0) || null;
  let weights: number[];
  let basis: WeightBasis;
  if (allValue) {
    weights = base.map((b) => b.value! / total!);
    basis = "value";
  } else if (allWeight) {
    const s = base.reduce((a, b) => a + (b.h.weight ?? 0), 0) || 1;
    weights = base.map((b) => (b.h.weight ?? 0) / s);
    basis = "weights";
  } else if (base.some((b) => b.h.weight != null || b.value != null)) {
    const given = base.reduce((a, b) => a + (b.h.weight ?? 0), 0);
    const rest = Math.max(0, 1 - given);
    const valued = base.filter((b) => b.h.weight == null && b.value != null);
    const vsum = valued.reduce((a, b) => a + b.value!, 0);
    const bare = base.filter((b) => b.h.weight == null && b.value == null).length;
    weights = base.map((b) => {
      if (b.h.weight != null) return b.h.weight;
      if (b.value != null && vsum > 0) return (rest * (bare ? 0.5 : 1) * b.value) / vsum;
      return bare ? (rest * (valued.length ? 0.5 : 1)) / bare : 0;
    });
    const s = weights.reduce((a, b) => a + b, 0) || 1;
    weights = weights.map((w) => w / s);
    basis = "mixed";
  } else {
    weights = base.map(() => 1 / base.length);
    basis = "equal";
  }
  const positions = base.map((b, i) => ({
    ticker: b.h.ticker,
    name: b.m?.name ?? b.h.ticker,
    sector: b.m?.sector || "Unclassified",
    industry: b.m?.industry || "Unclassified",
    shares: b.h.shares,
    price: b.price,
    value: b.value,
    weight: weights[i],
    cost: b.h.cost,
    mcap: b.m?.mcap ?? null,
  }));
  positions.sort((a, b) => b.weight - a.weight);
  return { positions, basis, total };
}

export interface Bucket {
  key: string;
  weight: number;
  count: number;
  tickers: string[];
}

export function exposureBy(positions: Position[], key: "sector" | "industry"): Bucket[] {
  const m = new Map<string, Bucket>();
  for (const p of positions) {
    const k = p[key];
    const b = m.get(k) ?? { key: k, weight: 0, count: 0, tickers: [] };
    b.weight += p.weight;
    b.count += 1;
    b.tickers.push(p.ticker);
    m.set(k, b);
  }
  return [...m.values()].sort((a, b) => b.weight - a.weight);
}

export interface Concentration {
  hhi: number;
  /** 1 / HHI: the number of equal-weight positions with the same concentration */
  effectiveN: number;
  top1: number;
  top5: number;
  top10: number;
  count: number;
}

export function concentration(positions: Position[]): Concentration {
  const w = positions.map((p) => p.weight).sort((a, b) => b - a);
  const hhi = w.reduce((s, x) => s + x * x, 0);
  const top = (n: number) => w.slice(0, n).reduce((s, x) => s + x, 0);
  return { hhi, effectiveN: hhi > 0 ? 1 / hhi : 0, top1: w[0] ?? 0, top5: top(5), top10: top(10), count: w.length };
}

export interface FactorRow {
  id: string;
  label: string;
  unit: "ratio" | "pct" | "corr";
  /** weighted average over the positions that have the measure, re-weighted to their combined weight */
  value: number | null;
  /** combined weight of positions that have the measure */
  coverage: number;
  contributors: { ticker: string; weight: number; x: number; share: number }[];
  source: string;
}

export interface FactorDef {
  id: string;
  label: string;
  unit: FactorRow["unit"];
  source: string;
}

/** Book-level average of per-company measures, with the largest contributors to the weighted sum. */
export function factorExposure(
  positions: Position[],
  values: Map<string, Record<string, number | null | undefined>>,
  defs: FactorDef[],
): FactorRow[] {
  return defs.map((d) => {
    const have = positions
      .map((p) => ({ p, x: values.get(p.ticker)?.[d.id] }))
      .filter((r): r is { p: Position; x: number } => typeof r.x === "number" && Number.isFinite(r.x));
    const cov = have.reduce((s, r) => s + r.p.weight, 0);
    if (!have.length || cov <= 0) return { ...d, value: null, coverage: 0, contributors: [] };
    const sum = have.reduce((s, r) => s + r.p.weight * r.x, 0);
    const absSum = have.reduce((s, r) => s + Math.abs(r.p.weight * r.x), 0) || 1;
    const contributors = have
      .map((r) => ({ ticker: r.p.ticker, weight: r.p.weight, x: r.x, share: (r.p.weight * r.x) / absSum }))
      .sort((a, b) => Math.abs(b.share) - Math.abs(a.share))
      .slice(0, 5);
    return { ...d, value: sum / cov, coverage: cov, contributors };
  });
}

// ---------------------------------------------------------------- hidden overlap (supply chain)

export const GOV_RX =
  /\b(u\.?\s?s\.?\s+(federal\s+)?government|united states( federal)? government|federal government|department of (defense|energy|veterans|health)|\bdod\b|u\.?s\.? (army|navy|air force|space force|marine)|navy|army|air force|nasa|medicare|medicaid|centers for medicare|\bcms\b|government agencies)\b/i;

export interface OverlapEvidence {
  ticker: string;
  weight: number;
  quote: string;
  accn: string;
  doc: string;
  form: string;
  filed: string;
  share: number | null;
}

export interface OverlapGroup {
  key: string;
  counterparty: string;
  counterpartyTicker: string | null;
  kind: "single-source supplier" | "major customer";
  weight: number;
  holdings: OverlapEvidence[];
}

const cpKey = (l: RiskLink) => l.counterparty_ticker ?? normText(l.counterparty).replace(/[,.]|\b(inc|corp|corporation|co|ltd|llc|plc|limited|company)\b/g, "").trim();

function evidence(l: RiskLink, p: Position): OverlapEvidence {
  return { ticker: p.ticker, weight: p.weight, quote: l.quote, accn: l.accn, doc: l.doc, form: l.form, filed: l.filed, share: l.share_pct ?? null };
}

/**
 * Counterparties that several holdings depend on: single-source suppliers named in the holdings' filings, and
 * customers that are 10%+ of a holding's revenue (by the filer's own disclosure). Groups need 2+ holdings.
 */
export function hiddenOverlap(positions: Position[], links: RiskLink[], minHoldings = 2): OverlapGroup[] {
  const pos = new Map(positions.map((p) => [p.ticker, p]));
  const groups = new Map<string, OverlapGroup>();
  for (const l of links) {
    const p = pos.get(l.ticker);
    if (!p) continue;
    let kind: OverlapGroup["kind"] | null = null;
    if (l.relation === "supplier" && l.single_source) kind = "single-source supplier";
    else if (l.relation === "customer" && (l.share_pct ?? 0) >= 10 && !GOV_RX.test(l.counterparty)) kind = "major customer";
    if (!kind) continue;
    const key = `${kind}:${cpKey(l)}`;
    const g = groups.get(key) ?? { key, counterparty: l.counterparty, counterpartyTicker: l.counterparty_ticker, kind, weight: 0, holdings: [] };
    if (!g.holdings.some((h) => h.ticker === p.ticker)) {
      g.holdings.push(evidence(l, p));
      g.weight += p.weight;
    }
    groups.set(key, g);
  }
  return [...groups.values()].filter((g) => g.holdings.length >= minHoldings).sort((a, b) => b.weight - a.weight || b.holdings.length - a.holdings.length);
}

export interface GovExposure {
  /** weighted share of book revenue from government customers, over holdings that disclose it */
  weighted: number;
  /** combined weight of holdings with a disclosed government customer share */
  coverage: number;
  rows: (OverlapEvidence & { name: string; counterparty: string })[];
}

/** Disclosed government customer shares (U.S. government, DoD branches, Medicare/Medicaid), weighted by position. */
export function governmentExposure(positions: Position[], links: RiskLink[]): GovExposure {
  const pos = new Map(positions.map((p) => [p.ticker, p]));
  const best = new Map<string, { l: RiskLink; p: Position }>();
  for (const l of links) {
    const p = pos.get(l.ticker);
    if (!p || l.relation !== "customer" || l.share_pct == null || !GOV_RX.test(l.counterparty)) continue;
    const prev = best.get(p.ticker);
    if (!prev || (l.share_pct ?? 0) > (prev.l.share_pct ?? 0) || (l.share_pct === prev.l.share_pct && l.filed > prev.l.filed)) best.set(p.ticker, { l, p });
  }
  const rows = [...best.values()].map(({ l, p }) => ({ ...evidence(l, p), name: p.name, counterparty: l.counterparty }));
  rows.sort((a, b) => b.weight * (b.share ?? 0) - a.weight * (a.share ?? 0));
  const weighted = rows.reduce((s, r) => s + r.weight * Math.min(100, r.share ?? 0) / 100, 0);
  return { weighted, coverage: rows.reduce((s, r) => s + r.weight, 0), rows };
}

// ---------------------------------------------------------------- supply shock on the book

export interface BookShockRow {
  ticker: string;
  name: string;
  weight: number;
  hop: number;
  channel: ShockImpact["channel"];
  severity: ShockImpact["severity"];
  /** fraction of this holding's revenue at risk, when the filings quantify it */
  revenuePct: number | null;
  /** weight × revenuePct: the hit to book-weighted revenue */
  bookPct: number | null;
  path: string[];
  link: RiskLink;
}

export interface BookShock {
  source: string;
  shock: number;
  rows: BookShockRow[];
  /** sum of quantified book-weighted revenue at risk */
  quantified: number;
  /** combined weight of holdings exposed without a disclosed share */
  unquantifiedWeight: number;
  /** the shocked company itself, when held */
  direct: number;
}

export function shockBook(
  source: string,
  shock: number,
  positions: Position[],
  links: RiskLink[],
  names: Record<string, string>,
  revenue: Record<string, number | undefined>,
): BookShock {
  const src = source.toUpperCase();
  const pos = new Map(positions.map((p) => [p.ticker, p]));
  const impacts = simulateShock(src, shock, links, names, revenue, 2);
  const rows: BookShockRow[] = [];
  for (const i of impacts) {
    const p = i.ticker ? pos.get(i.ticker) : undefined;
    if (!p) continue;
    rows.push({
      ticker: p.ticker,
      name: p.name,
      weight: p.weight,
      hop: i.hop,
      channel: i.channel,
      severity: i.severity,
      revenuePct: i.revenuePct,
      bookPct: i.revenuePct != null ? i.revenuePct * p.weight : null,
      path: i.path,
      link: i.link,
    });
  }
  rows.sort((a, b) => (b.bookPct ?? -1) - (a.bookPct ?? -1) || a.hop - b.hop || b.weight - a.weight);
  return {
    source: src,
    shock,
    rows,
    quantified: rows.reduce((s, r) => s + (r.bookPct ?? 0), 0),
    unquantifiedWeight: rows.filter((r) => r.bookPct == null).reduce((s, r) => s + r.weight, 0),
    direct: pos.get(src)?.weight ?? 0,
  };
}

/** Counterparties most often linked to the holdings: candidates for the shock source picker. */
export function shockCandidates(positions: Position[], links: RiskLink[], limit = 12): { ticker: string; name: string; holdings: number }[] {
  const pos = new Set(positions.map((p) => p.ticker));
  const m = new Map<string, { ticker: string; name: string; set: Set<string> }>();
  for (const l of links) {
    if (!pos.has(l.ticker) || !l.counterparty_ticker || (l.relation !== "supplier" && l.relation !== "customer")) continue;
    const e = m.get(l.counterparty_ticker) ?? { ticker: l.counterparty_ticker, name: l.counterparty, set: new Set<string>() };
    e.set.add(l.ticker);
    m.set(l.counterparty_ticker, e);
  }
  return [...m.values()]
    .map((e) => ({ ticker: e.ticker, name: e.name, holdings: e.set.size }))
    .sort((a, b) => b.holdings - a.holdings)
    .slice(0, limit);
}

// ---------------------------------------------------------------- liquidity

export interface LiquidityRow {
  ticker: string;
  weight: number;
  value: number | null;
  /** average daily dollar volume over the last 20 sessions */
  adv: number | null;
  /** sessions to exit trading at `participation` of ADV */
  days: number | null;
  /** position value as a share of market cap */
  ofMcap: number | null;
}

/** Average daily dollar volume from compact bars [date, open, high, low, close, adjClose, volume]. */
export function averageDollarVolume(bars: [string, number, number, number, number, number, number][] | undefined, n = 20): number | null {
  if (!bars?.length) return null;
  const last = bars.slice(-n).filter((b) => b[4] > 0 && b[6] > 0);
  if (!last.length) return null;
  return last.reduce((s, b) => s + b[4] * b[6], 0) / last.length;
}

export function liquidity(positions: Position[], adv: Map<string, number | null>, participation = 0.2): LiquidityRow[] {
  return positions
    .map((p) => {
      const a = adv.get(p.ticker) ?? null;
      return {
        ticker: p.ticker,
        weight: p.weight,
        value: p.value,
        adv: a,
        days: p.value != null && a ? p.value / (a * participation) : null,
        ofMcap: p.value != null && p.mcap ? p.value / p.mcap : null,
      };
    })
    .sort((a, b) => (b.days ?? -1) - (a.days ?? -1) || b.weight - a.weight);
}
