// Estimates bundle built by the Filed Under estimates job (etl/estimates.py), served through the partner
// data service as estimates/{T}.json: Yahoo Finance consensus by fiscal period with our own daily snapshots,
// Benzinga analyst actions, ratings and price targets ("Powered by Benzinga Data"), provider EPS surprises
// with SEC GAAP EPS alongside, and company guidance quoted from earnings releases.
import { queryOptions } from "@tanstack/react-query";
import { partnerFile } from "@/lib/data";

export type PeriodCode = "0q" | "+1q" | "0y" | "+1y";

export interface ConsensusRange {
  avg: number | null;
  low: number | null;
  high: number | null;
  n: number | null;
  year_ago: number | null;
}
export interface ConsensusPeriod {
  code: PeriodCode;
  label: string;
  end: string;
  end_provider?: string;
  end_fixed?: string;
  eps: ConsensusRange;
  revenue: ConsensusRange;
  growth?: number | null;
}
export interface Snapshot {
  as_of: string;
  at?: string;
  p: Partial<
    Record<
      PeriodCode,
      {
        end: string;
        eps: number | null;
        eps_n?: number | null;
        eps_lo?: number | null;
        eps_hi?: number | null;
        rev?: number | null;
        rev_n?: number | null;
      }
    >
  >;
}
export interface Revision {
  from_date: string;
  eps_from: number | null;
  eps_to: number | null;
  eps_pct: number | null;
  rev_from?: number | null;
  rev_to?: number | null;
  rev_pct?: number | null;
}
export interface SecFact {
  v: number;
  end: string;
  form: string;
  filed: string;
  accn: string;
  url?: string;
  derived?: boolean;
}
export interface Surprise {
  quarter_end: string;
  eps_actual: number | null;
  eps_estimate: number | null;
  eps_difference?: number | null;
  surprise_pct: number | null;
  beat: number | null;
  gaap_eps?: SecFact | null;
  revenue?: SecFact | null;
  report?: { filed: string; accn: string; url?: string } | null;
  reaction?: { date: string; r1: number; spy1: number } | null;
}
export interface RevenueSurprise {
  quarter_end: string;
  consensus: number;
  consensus_as_of: string;
  actual: number;
  surprise_pct: number;
  filing?: { url?: string; accn?: string };
}
export interface Action {
  id: string;
  date: string;
  time?: string;
  firm: string;
  firm_id?: string;
  analyst?: string | null;
  action: string;
  action_pt?: string | null;
  rating_prior?: string | null;
  rating_current?: string | null;
  pt_prior?: number | null;
  pt_current?: number | null;
  pt_prior_printed?: string | null;
  pt_current_printed?: string | null;
  adj_pt_prior?: number | null;
  adj_pt_current?: number | null;
  currency?: string;
  url?: string;
  url_news?: string;
}
export interface TargetRow {
  id: string;
  date: string;
  firm: string;
  analyst?: string | null;
  pt: number;
  adjusted?: boolean;
  rating?: string;
  bucket?: Bucket;
  url?: string;
}
export type Bucket = "buy" | "hold" | "sell" | "other";
export interface GuidanceItem {
  id: string;
  series?: string;
  metric: string;
  label: string;
  basis?: string;
  unit: string;
  segment?: string | null;
  period: string;
  period_type?: string;
  period_end?: string;
  issued: string;
  low: number | null;
  high: number | null;
  mid?: number | null;
  action?: string;
  withdrawn?: boolean;
  quote?: string;
  doc?: string;
  page?: number;
}
export interface GuidanceVsConsensus {
  metric: string;
  label: string;
  basis?: string;
  period: string;
  period_end: string;
  code: PeriodCode;
  guide_low: number | null;
  guide_high: number | null;
  guide_mid: number | null;
  guide_id: string;
  issued: string;
  doc?: string;
  quote?: string;
  consensus: number | null;
  consensus_n?: number | null;
  gap_pct: number | null;
  scale_check?: boolean;
  position?: "within" | "above" | "below" | null;
}
export interface GuidanceOutcome {
  label: string;
  unit: string;
  basis?: string;
  period: string;
  period_end?: string;
  final_low: number | null;
  final_high: number | null;
  final_id?: string;
  actual: number | null;
  actual_inputs?: {
    accession: string;
    form: string;
    filed: string;
    end: string;
    start?: string;
    concept: string;
    value: number;
    label?: string;
    derived?: boolean;
  }[];
  result?: "above" | "below" | "met" | "within" | string | null;
  scale_check?: boolean;
}
export interface GuidanceDoc {
  id: string;
  url: string;
  title?: string;
  doc_type?: string;
  fiscal_label?: string;
  source_page?: string;
}
export interface Credibility {
  n_scored?: number;
  n_met?: number;
  hit_rate?: number | null;
  above_rate?: number | null;
  below_rate?: number | null;
  in_range_rate?: number | null;
  raise_rate?: number | null;
  avg_surprise?: number | null;
  tendency?: string | null;
  first_issued?: string;
  last_issued?: string;
  n_series?: number;
}
export interface StreetPoint {
  text: string;
  refs: string[];
  verified?: boolean;
  unsupported_numbers?: string[];
}

export interface StreetBundle {
  ticker: string;
  name: string;
  generated: string;
  price?: { close: number; date: string } | null;
  consensus?: {
    url?: string;
    as_of: string;
    periods: ConsensusPeriod[];
    next_earnings?: {
      date: string;
      is_estimate?: boolean;
      window_end?: string;
      eps?: { avg?: number };
      revenue?: { avg?: number };
    } | null;
  } | null;
  snapshots?: Snapshot[];
  revisions?: Partial<
    Record<PeriodCode, Partial<Record<"7" | "30" | "60" | "90", Revision | null>>>
  >;
  surprises?: Surprise[];
  revenue_surprises?: RevenueSurprise[];
  actions?: Action[];
  targets?: {
    since: string;
    stats?: {
      n: number;
      mean: number;
      median: number;
      high: number;
      low: number;
      upside_mean?: number;
      upside_median?: number;
    } | null;
    rows: TargetRow[];
  };
  ratings?: {
    since: string;
    counts: Partial<Record<Bucket, number>>;
    n: number;
    firms: { id: string; firm: string; rating: string; bucket: Bucket; date: string }[];
  };
  rating_history?: {
    month: string;
    buy: number;
    hold: number;
    sell: number;
    other?: number;
    n: number;
  }[];
  summary?: Record<
    "d90" | "d365",
    {
      since: string;
      count: number;
      upgrades: number;
      downgrades: number;
      initiations: number;
      target_raises: number;
      target_cuts: number;
      median_target_move?: number | null;
    }
  >;
  guidance?: {
    available: boolean;
    reason?: string;
    items?: GuidanceItem[];
    docs?: Record<string, GuidanceDoc>;
    vs_consensus?: GuidanceVsConsensus[];
    outcomes?: GuidanceOutcome[];
    credibility?: Credibility | null;
  };
  street_view?: {
    headline?: string;
    points: StreetPoint[];
    generated_at: string;
    model: string;
  } | null;
  sources?: {
    yahoo?: { retrieved_at?: string; url?: string };
    benzinga?: { retrieved_at?: string; history_from?: string };
  };
}

export const streetQuery = (t: string) =>
  queryOptions({
    queryKey: ["street", t],
    queryFn: () => partnerFile<StreetBundle>(`estimates/${t}.json`),
    staleTime: 3600_000,
    retry: 1,
  });

export const PERIOD_NAME: Record<PeriodCode, string> = {
  "0q": "Current qtr",
  "+1q": "Next qtr",
  "0y": "Current FY",
  "+1y": "Next FY",
};
export const BZ = "Powered by Benzinga Data";

export type ActionKind = "upgrade" | "downgrade" | "initiate" | "target" | "reiterate" | "drop";
const INACTIVE = new Set(["Terminates Coverage On", "Suspends", "Removes", "Firm Dissolved"]);
export function actionKindOf(a: Action): ActionKind {
  if (a.action === "Upgrades") return "upgrade";
  if (a.action === "Downgrades") return "downgrade";
  if (["Initiates Coverage On", "Reinstates", "Assumes"].includes(a.action)) return "initiate";
  if (INACTIVE.has(a.action)) return "drop";
  if (a.pt_current != null && a.pt_prior != null && a.pt_current !== a.pt_prior) return "target";
  return "reiterate";
}
export const ACTION_LABEL: Record<ActionKind, string> = {
  upgrade: "Upgrade",
  downgrade: "Downgrade",
  initiate: "Initiated",
  target: "Target change",
  reiterate: "Reiterated",
  drop: "Coverage dropped",
};

/* ---------- formatting ---------- */
const fin = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
export const fEps = (v: number | null | undefined) =>
  fin(v) ? `${v < 0 ? "−$" : "$"}${Math.abs(v).toFixed(2)}` : "–";
export const fPx = (v: number | null | undefined) =>
  fin(v)
    ? `$${v.toLocaleString("en-US", { minimumFractionDigits: v >= 1000 ? 0 : 2, maximumFractionDigits: v >= 1000 ? 0 : 2 })}`
    : "–";
export function fUsd(v: number | null | undefined) {
  if (!fin(v)) return "–";
  const a = Math.abs(v),
    s = v < 0 ? "−" : "";
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(a >= 1e11 ? 1 : 2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M`;
  return `${s}$${a.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}
export const fPctS = (v: number | null | undefined, d = 1) =>
  fin(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(d)}%` : "–";
export const fPct = (v: number | null | undefined, d = 0) =>
  fin(v) ? `${(v * 100).toFixed(d)}%` : "–";
export const fCnt = (v: number | null | undefined) => (fin(v) ? String(Math.round(v)) : "–");
export const tone = (v: number | null | undefined) =>
  !fin(v) || Math.abs(v) < 0.0005 ? "" : v > 0 ? "text-positive" : "text-negative";

export function fUnit(v: number | null | undefined, unit: string) {
  if (unit === "pct") return fin(v) ? `${(Math.abs(v) <= 1.5 ? v * 100 : v).toFixed(1)}%` : "–";
  if (unit === "USD_per_share") return fEps(v);
  if (unit === "USD") return fUsd(v);
  return fin(v) ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "–";
}
export function rangeText(
  lo: number | null | undefined,
  hi: number | null | undefined,
  unit: string,
) {
  if (lo == null && hi == null) return "–";
  if (lo == null || hi == null || lo === hi) return fUnit(lo ?? hi, unit);
  return `${fUnit(lo, unit)} – ${fUnit(hi, unit)}`;
}
export const basisLabel = (b?: string) =>
  !b || b === "unspecified"
    ? null
    : b === "gaap"
      ? "GAAP"
      : b === "non_gaap" || b === "adjusted"
        ? "non-GAAP"
        : b;
export const cleanQuote = (q?: string) =>
  String(q ?? "")
    .replace(/^[“"\s•·\-–]+|[”"\s]+$/g, "")
    .replace(/\s+/g, " ");

/** "https://www.sec.gov/Archives/edgar/data/1045810/000104581025000228/x.htm" → accession and file name. */
export function secDoc(url?: string): { accn: string; doc: string } | null {
  const m = /sec\.gov\/Archives\/edgar\/data\/\d+\/(\d{10})(\d{2})(\d{6})\/([^/?#]+)$/i.exec(
    url ?? "",
  );
  return m ? { accn: `${m[1]}-${m[2]}-${m[3]}`, doc: m[4] } : null;
}

export function ago(days: number) {
  return new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
}
