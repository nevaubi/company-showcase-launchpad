// Government and ownership records per company from the Filed Under government pipeline (etl/gov_pipeline.py):
// House periodic transaction reports, LDA lobbying, FEC PACs, Federal Register rules, public laws, USAspending,
// congressional hearing transcripts, and from the flows file Schedule 13D/13G stakes and Form 13F holdings.
import { queryOptions } from "@tanstack/react-query";
import { partnerFile } from "@/lib/data";
import type { FlowsFile } from "@/lib/technicals/data";

export interface Src {
  url: string;
  retrieved_at?: string;
  method?: string;
  page?: string;
}
export interface CongressTrade {
  id: string;
  chamber: "House" | "Senate";
  member: string;
  bioguide?: string;
  party: string;
  state_dst: string;
  owner: string;
  asset: string;
  type: string;
  type_code: string;
  tx_date: string;
  notified?: string;
  filed: string;
  lag_days: number | null;
  amount: string;
  amin: number | null;
  amax: number | null;
  pdf_url: string;
  page?: number;
  cited: string;
  committees: string[];
  committee_flag: boolean;
  flag_committees: string[];
  src: Src;
}
export interface LobbyFiling {
  id: string;
  uuid: string;
  year: number;
  quarter: number;
  type: string;
  registrant: string;
  client: string;
  amount: number | null;
  basis: string;
  posted: string;
  url: string;
  activities: {
    issue: string;
    code: string;
    description: string;
    lobbyists?: string[];
    agencies?: string[];
  }[];
}
export interface Hearing {
  id: string;
  title: string;
  date: string;
  chamber: string;
  committees: string[];
  subcommittees?: string[];
  mentions: number;
  quotes: {
    text: string;
    context: string;
    match: string;
    speaker: string | null;
    speaker_party: string | null;
  }[];
  url: string;
  text_url: string;
  src: Src;
}
export interface FrDoc {
  id: string;
  document_number: string;
  title: string;
  type: string;
  action: string;
  date: string;
  effective_on: string | null;
  comments_close_on: string | null;
  citation: string;
  agencies: string[];
  abstract: string | null;
  excerpt?: string | null;
  term?: string;
  url: string;
  pdf_url?: string;
}
export interface GovFile {
  ticker: string;
  name: string;
  generated: string;
  congress_trades: CongressTrade[];
  congress_meta: { committees_overseeing: string[]; legal_note: string; flag_basis: string };
  lobbying?: {
    quarters: { year: number; quarter: number; amount: number; basis: string; n: number }[];
    issues: {
      code: string;
      name: string;
      filings: number;
      latest: [number, number];
      latest_desc: string;
    }[];
    agencies: { name: string; filings: number }[];
    bills: {
      bill: string;
      congress: number;
      filings: number;
      issues: string[];
      first: string;
      last: string;
      cites: { filing: string; text: string }[];
    }[];
    filings: LobbyFiling[];
    filing_count: number;
    src?: Src;
  };
  pac?: {
    committees: { id: string; name: string; url: string }[];
    cycles: {
      cycle: number;
      receipts: number;
      disbursements: number;
      to_candidates: number;
      dem: number;
      rep: number;
      other: number;
      recipients: {
        name: string;
        member: string | null;
        party: string;
        office?: string;
        state?: string;
        amount: number;
      }[];
      n_recipients: number;
      src: Src;
    }[];
  };
  regulation?: { rules: FrDoc[]; proposed: FrDoc[]; retrieved_at?: string };
  legislation?: {
    id: string;
    label: string;
    title: string;
    short_titles?: string[];
    date: string;
    bills: string[];
    url: string;
    link: string;
    match: string;
  }[];
  spending?: {
    fy: {
      fy: number;
      contracts: number;
      grants: number;
      loans: number;
      other: number;
      total: number;
      partial: boolean;
    }[];
    awards: {
      id?: string;
      award_id?: string;
      amount?: number;
      agency?: string;
      description?: string;
      date?: string;
      url?: string;
    }[];
    entities: { name: string; url: string }[];
    status?: string;
  };
  hearings?: Hearing[];
  sources: Record<
    string,
    { status: string; note?: string; count?: number; url?: string; checked_at?: string }
  >;
  ai_read?: {
    status?: string;
    sentences?: { text: string; refs: string[] }[];
    facts?: { id: string; text: string }[];
    dropped?: { text: string; reason: string }[];
    generated_at?: string;
    model?: string;
    check_model?: string | null;
    label?: string;
  } | null;
}
export const govQuery = (t: string) =>
  queryOptions({
    queryKey: ["gov", t],
    queryFn: () => partnerFile<GovFile>(`gov/${t}.json`),
    staleTime: 3600_000,
    retry: 0,
  });

export interface Holder13DG {
  id: string;
  accession: string;
  form: string;
  filed: string;
  event_date: string;
  filer: string;
  filer_type: string;
  shares: number | null;
  percent: number | null;
  activist: boolean;
  purpose: string | null;
  url: string;
  index_url: string;
}
export interface Holder13F {
  cik: string;
  manager: string;
  shares: number;
  value: number;
  prev_shares: number;
  change: number;
  pct_change: number | null;
  new: boolean;
  exited: boolean;
  accessions: string[];
}
export type OwnershipFlows = FlowsFile & {
  holders13dg?: { current: Holder13DG[]; history: Holder13DG[] };
  inst13f?: {
    period: string;
    prior_period: string;
    holders: Holder13F[];
    buyers: Holder13F[];
    sellers: Holder13F[];
    totals: {
      managers: number;
      shares: number;
      value: number;
      prior_managers: number;
      prior_shares: number;
      new_positions: number;
      exits: number;
    };
    src: Src;
  };
};

export const partyShort = (p: string) =>
  /^dem/i.test(p) ? "D" : /^rep/i.test(p) ? "R" : p ? p[0].toUpperCase() : "?";
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /^[A-Z]/.test(w) && !/^(Jr|Sr|II|III|IV)\.?$/.test(w))
    .map((w) => w[0])
    .slice(0, 2)
    .join("");

/** Which Insiders & influence section holds the record behind a read's fact id. */
export function sectionOfFact(
  id: string,
  gov: GovFile,
): "congress" | "holders" | "lobbying" | "government" | "trading" | "form4" | "overview" {
  if (/^(lda|fec):/.test(id)) return "lobbying";
  if (/^usa:/.test(id)) return "government";
  if (/^13f:/.test(id)) return "holders";
  if (/^finra:/.test(id)) return "trading";
  if (/^form4:/.test(id)) return "form4";
  if (gov.congress_trades.some((t) => t.id === id)) return "congress";
  if ((gov.hearings ?? []).some((h) => h.id === id)) return "government";
  if (
    [...(gov.regulation?.rules ?? []), ...(gov.regulation?.proposed ?? [])].some((r) => r.id === id)
  )
    return "government";
  if ((gov.legislation ?? []).some((l) => l.id === id)) return "government";
  return "holders";
}
