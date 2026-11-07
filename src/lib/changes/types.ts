// "What changed" events from the Filed Under pipeline (etl/changes.py): changes/feed.json (universe, 30 days,
// ranked) and changes/{T}.json (one company, 90 days). Every event carries its evidence and a stable id.

export type ChangeTier = "high" | "medium" | "low";

export type ChangeType =
  | "filing_change"
  | "filing_8k"
  | "insider"
  | "contracts"
  | "analyst"
  | "earnings"
  | "ir_doc"
  | "technical"
  | "dividend"
  | "ipo"
  | "macro";

export interface ChangeEvidence {
  label: string;
  url: string;
  /** sec: an SEC document; ir: a company investor-relations page; web: another public source; app: a page here */
  kind: "sec" | "ir" | "web" | "app";
  excerpt?: string;
}

export interface BaseRate {
  horizon_days: number;
  excess: number | null;
  excess_ci: [number | null, number | null];
  hit: number | null;
  n: number | null;
  months?: number | null;
  verdict: string;
  since?: string | null;
  caveat: string;
}

export interface ChangeEvent {
  id: string;
  type: ChangeType;
  sub: string;
  /** null for universe-level events (IPOs, macro releases) */
  t: string | null;
  name: string | null;
  sector: string | null;
  /** event date (YYYY-MM-DD); future when `upcoming` */
  date: string;
  title: string;
  detail: string | null;
  tier: ChangeTier;
  /** the rule that set the tier, in words */
  reason: string;
  evidence: ChangeEvidence[];
  metrics: Record<string, unknown>;
  base_rate: BaseRate | null;
  tags: string[];
  upcoming: boolean;
  /** when the pipeline first published this event (ISO) */
  first_seen?: string;
  /** position in the ranked feed */
  order?: number;
}

export interface ChangeCounts {
  by_type: Partial<Record<ChangeType, number>>;
  by_tier: Partial<Record<ChangeTier, number>>;
  total: number;
}

export interface CompanyChanges {
  ticker: string;
  name: string;
  sector: string;
  generated: string;
  as_of: string;
  window_days: number;
  counts: ChangeCounts;
  events: ChangeEvent[];
  method: string;
}

export interface ChangesFeed {
  generated: string;
  as_of: string;
  window_days: number;
  version: number;
  counts: ChangeCounts;
  shown: number;
  events: ChangeEvent[];
  method: string;
  tiers: Record<ChangeTier, string>;
}
