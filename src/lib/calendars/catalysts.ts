// One catalyst list across sources: earnings dates, dividend ex-dates, IPO lock-up expiries, clinical-trial primary
// completions, federal contract awards and award end dates, and economic releases. Pure; each event keeps its source.
import { addDays, dayDiff, releaseMeta, type MacroRelease } from "./data";
import { dividendEvents, earningsRows, type CalData } from "./rows";

export type CatalystKind = "earnings" | "dividend" | "lockup" | "trial" | "fda" | "award" | "award_end" | "macro";

export const CATALYST_LABEL: Record<CatalystKind, string> = {
  earnings: "Earnings",
  dividend: "Ex-dividend",
  lockup: "IPO lock-up",
  trial: "Trial readout",
  fda: "FDA action",
  award: "Federal award",
  award_end: "Award ends",
  macro: "Economic release",
};

export interface CatalystEvent {
  id: string;
  date: string;
  kind: CatalystKind;
  ticker: string | null;
  name: string;
  title: string;
  detail: string | null;
  /** the date is derived (projection or convention), not announced */
  estimated: boolean;
  basis: string | null;
  source: { label: string; url: string | null };
  weight: 1 | 2 | 3;
}

export interface AltEventRow {
  uid: string;
  ticker: string;
  dataset: string;
  date: string | null;
  title: string;
  value: number | null;
  meta: Record<string, unknown>;
  source: string;
  source_url: string | null;
}

const LOCKUP_DAYS = 180;

export function earningsCatalysts(d: CalData): CatalystEvent[] {
  return earningsRows(d)
    .filter((r) => r.kind === "upcoming" && r.date)
    .map((r) => ({
      id: `earn:${r.ticker}:${r.date}`,
      date: r.date!,
      kind: "earnings" as const,
      ticker: r.ticker,
      name: r.name,
      title: `${r.ticker} reports`,
      detail: r.eps != null ? `Consensus EPS ${r.eps.toFixed(2)}` : null,
      estimated: !!r.is_estimate,
      basis: r.is_estimate ? "Projected from the company's reporting cadence" : null,
      source: { label: r.provider ?? "Earnings calendar", url: r.url ?? null },
      weight: 3 as const,
    }));
}

export function dividendCatalysts(d: CalData): CatalystEvent[] {
  return dividendEvents(d).map((e) => ({
    id: `div:${e.ticker}:${e.date}:${e.kind}`,
    date: e.date,
    kind: "dividend" as const,
    ticker: e.ticker,
    name: e.name,
    title: `${e.ticker} ex-dividend $${e.amount.toFixed(e.amount < 1 ? 3 : 2)}`,
    detail: e.kind === "declared" ? (e.dec?.increase ? "Declared, increase" : "Declared") : "Projected from payment history",
    estimated: e.kind === "projected",
    basis: e.kind === "projected" ? "Projected from the dividend cadence" : null,
    source: { label: e.kind === "declared" ? "8-K dividend declaration" : "Dividend history", url: null },
    weight: 1 as const,
  }));
}

/** Typical 180-day lock-up after pricing; the prospectus states the actual term. */
export function lockupCatalysts(d: CalData): CatalystEvent[] {
  const out: CatalystEvent[] = [];
  for (const r of d.ipos?.rows ?? []) {
    if (!r.priced || r.status === "withdrawn") continue;
    const date = addDays(r.priced, LOCKUP_DAYS);
    const prosp = r.filings.find((f) => f.form.startsWith("424B")) ?? r.filings.at(-1);
    out.push({
      id: `lock:${r.cik}`,
      date,
      kind: "lockup",
      ticker: r.symbol,
      name: r.name,
      title: `${r.symbol ?? r.name} lock-up expiry (typical ${LOCKUP_DAYS} days)`,
      detail: `Priced ${r.priced}${r.shares ? ` · ${Math.round(r.shares.value).toLocaleString()} shares offered` : ""}`,
      estimated: true,
      basis: `${LOCKUP_DAYS} days after pricing; check the prospectus for the actual lock-up term`,
      source: { label: prosp ? `${prosp.form} prospectus` : "EDGAR registration", url: prosp?.url ?? null },
      weight: 2,
    });
  }
  return out;
}

export function macroCatalysts(releases: MacroRelease[] | undefined): CatalystEvent[] {
  return (releases ?? []).map((r) => {
    const m = releaseMeta(r.release);
    return {
      id: `macro:${r.release}:${r.release_date}`,
      date: r.release_date,
      kind: "macro" as const,
      ticker: null,
      name: r.provider,
      title: m.label,
      detail: r.release_time ?? null,
      estimated: false,
      basis: null,
      source: { label: r.provider, url: r.source_url },
      weight: m.weight,
    };
  });
}

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

/** Clinical trials (primary completion), FDA actions, federal awards and award end dates from the alt-data store. */
export function altCatalysts(rows: AltEventRow[], names: Map<string, string>): CatalystEvent[] {
  const out: CatalystEvent[] = [];
  for (const r of rows) {
    const name = names.get(r.ticker) ?? r.ticker;
    if (r.dataset === "trials") {
      const pc = str(r.meta.primary_completion);
      if (!pc || !/^\d{4}-\d{2}(-\d{2})?$/.test(pc)) continue;
      const date = pc.length === 7 ? `${pc}-28` : pc;
      const phase = str(r.meta.phase);
      out.push({
        id: `trial:${r.uid}`,
        date,
        kind: "trial",
        ticker: r.ticker,
        name,
        title: `${r.ticker} trial primary completion${phase ? ` (${phase})` : ""}`,
        detail: [str(r.meta.nct), r.title].filter(Boolean).join(" · ") || null,
        estimated: pc.length === 7 || str(r.meta.primary_completion_type) === "ESTIMATED" || str(r.meta.completion_type) === "Anticipated",
        basis: pc.length === 7 ? "Month only on ClinicalTrials.gov" : "Sponsor's anticipated date on ClinicalTrials.gov",
        source: { label: r.source || "ClinicalTrials.gov", url: r.source_url },
        weight: phase && /3/.test(phase) ? 3 : 2,
      });
    } else if (r.dataset === "fda" && r.date) {
      out.push({
        id: `fda:${r.uid}`,
        date: r.date.slice(0, 10),
        kind: "fda",
        ticker: r.ticker,
        name,
        title: `${r.ticker} ${r.title}`.slice(0, 140),
        detail: null,
        estimated: false,
        basis: null,
        source: { label: r.source || "openFDA", url: r.source_url },
        weight: 2,
      });
    } else if (r.dataset === "contracts") {
      const end = str(r.meta.end);
      const amount = typeof r.value === "number" ? r.value : null;
      const agency = str(r.meta.sub_agency) ?? str(r.meta.agency);
      if (r.date) {
        out.push({
          id: `award:${r.uid}`,
          date: r.date.slice(0, 10),
          kind: "award",
          ticker: r.ticker,
          name,
          title: `${r.ticker} federal award${amount ? ` $${(amount / 1e6).toFixed(amount >= 1e8 ? 0 : 1)}M` : ""}`,
          detail: [agency, str(r.meta.award_id)].filter(Boolean).join(" · ") || r.title,
          estimated: false,
          basis: null,
          source: { label: r.source || "USAspending.gov", url: r.source_url },
          weight: amount != null && amount >= 1e9 ? 3 : 2,
        });
      }
      if (end && /^\d{4}-\d{2}-\d{2}/.test(end)) {
        out.push({
          id: `awardend:${r.uid}`,
          date: end.slice(0, 10),
          kind: "award_end",
          ticker: r.ticker,
          name,
          title: `${r.ticker} award period ends${amount ? ` ($${(amount / 1e6).toFixed(0)}M)` : ""}`,
          detail: [agency, str(r.meta.award_id)].filter(Boolean).join(" · ") || null,
          estimated: false,
          basis: "Current period of performance end; options or modifications can extend it",
          source: { label: r.source || "USAspending.gov", url: r.source_url },
          weight: 1,
        });
      }
    }
  }
  return out;
}

export function mergeCatalysts(groups: CatalystEvent[][], from: string, to: string, tickers?: Set<string> | null): CatalystEvent[] {
  const seen = new Set<string>();
  const out: CatalystEvent[] = [];
  for (const g of groups)
    for (const e of g) {
      if (e.date < from || e.date > to || seen.has(e.id)) continue;
      if (tickers && e.kind !== "macro" && (!e.ticker || !tickers.has(e.ticker))) continue;
      seen.add(e.id);
      out.push(e);
    }
  return out.sort((a, b) => a.date.localeCompare(b.date) || b.weight - a.weight || a.title.localeCompare(b.title));
}

export interface HeatDay {
  date: string;
  count: number;
  weight: number;
  kinds: Partial<Record<CatalystKind, number>>;
}

/** Day grid from `start` (a Monday) for `weeks` weeks, weekdays only, with per-day counts and weight. */
export function heatGrid(events: CatalystEvent[], start: string, weeks: number): HeatDay[][] {
  const by = new Map<string, HeatDay>();
  for (const e of events) {
    const d = by.get(e.date) ?? { date: e.date, count: 0, weight: 0, kinds: {} };
    d.count += 1;
    d.weight += e.weight;
    d.kinds[e.kind] = (d.kinds[e.kind] ?? 0) + 1;
    by.set(e.date, d);
  }
  const grid: HeatDay[][] = [];
  for (let w = 0; w < weeks; w++) {
    const row: HeatDay[] = [];
    for (let i = 0; i < 5; i++) {
      const date = addDays(start, w * 7 + i);
      row.push(by.get(date) ?? { date, count: 0, weight: 0, kinds: {} });
    }
    grid.push(row);
  }
  return grid;
}

/** Days from today to the event (negative = past). */
export const daysAway = (date: string, today: string) => dayDiff(today, date);
