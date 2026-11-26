// Company to official-record links and the payload of the company's official panels. Pure types and small pure
// helpers; safe for the browser. The links themselves are server-only (`links.server.ts`, `links.json`).

/** What a link ties the company to. */
export type LinkKind = "registrant_rssd" | "insured_bank" | "noninsured_trust_company" | "abs_sponsor_bank";

/**
 * Why the link holds. Proven bases rest on identifiers both records carry:
 * - `ein_equal`: the employer identification number on the registrant's SEC cover page equals the Federal Reserve
 *   NIC tax ID (MDRM item 6191) of the entity, and NIC's legal name is the registrant;
 * - `top_holder`: the FDIC institution record's top regulatory holder (RSSDHCR) is the registrant's RSSD;
 * - `self`: the FDIC institution record's own RSSD is the registrant's RSSD (the registrant is the bank);
 * - `nic_equity` / `nic_other_basis`: current NIC relationship rows lead from the registrant's RSSD to the bank's,
 *   with an equity share, or with control on another basis and no equity share;
 * - `sponsor_bank_chain`: an asset-backed deal's sponsor CIK has the EIN of an insured bank of the registrant.
 * `name_match` and `name_and_subsidiary_list` are not proofs: such rows are kept for review only.
 */
export type LinkBasis = "ein_equal" | "top_holder" | "self" | "nic_equity" | "nic_other_basis" | "sponsor_bank_chain" | "name_match" | "name_and_subsidiary_list";

/** Only `proven` rows with an open `valid_to` are links. `review` rows are never read as links; `retired` rows record a link that was wrong. */
export type LinkStatus = "proven" | "review" | "retired";
export type KeyField = "RSSD" | "CERT" | "CIK";

/** One stored record: dataset, immutable snapshot and 1-based row number. */
export interface RecordPointer {
  dataset: string;
  snapshot: string;
  row: number;
}
/** The registrant's FR Y-9C row for one report date (the FR Y-9C tables carry no entity index). */
export interface Y9cPointer extends RecordPointer {
  /** ISO date of the report (RSSD9999). */
  report_date: string;
}

export interface SecEvidence {
  cik: string;
  /** EIN as printed on the cover page, nine digits without the dash. */
  ein?: string;
  ein_source?: "cover";
  accession?: string;
  form?: string;
  /** The cover page (R1.htm) of the filing the EIN was read from. */
  cover_url?: string;
  /** The EIN in SEC's EDGAR header when it differs from the cover page. */
  header_ein?: string;
  /** An earlier filing whose cover printed the same EIN (the one the link was first proved on). */
  prior_accession?: string;
}
export interface NicEvidence extends RecordPointer {
  rssd: string;
  /** NIC ID_TAX as stored (leading zeros dropped by the publisher). */
  tax_id: string;
  /** NIC legal name of the entity (a company name). */
  legal_name: string;
  entity_type: string;
  sec_reporting_status: string;
  name_check: string;
}
export interface FdicEvidence {
  /** FDIC institutions API address of the certificate; absent where the API does not list the institution. */
  api_url?: string;
  /** Why there is no API address (noninsured trust companies). */
  api_note?: string;
  dataset?: string;
  snapshot?: string;
  row?: number;
  bank_rssd?: string;
  /**
   * The FDIC record's top regulatory holder (RSSDHCR) as the FDIC states it; null when it names none. It is the
   * registrant for `top_holder`; for a bank held through NIC relationship rows it is an entity above the registrant.
   */
  holder_rssd?: string | null;
  report_date?: string;
  total_assets_k?: string;
  /** Inside the FDIC 500 cohort (insured institutions chosen by assets on 30 June 2026). */
  cohort500?: boolean;
  class?: "insured" | "noninsured_trust";
}
export interface RelationshipStep {
  offspring: string;
  row: number;
  equity_pct: string | null;
  other_basis: boolean;
  ctrl_ind: string | null;
}
export interface RelationshipEvidence {
  dataset: string;
  snapshot: string;
  /** RSSDs from the registrant to the bank. */
  path: string[];
  steps: RelationshipStep[];
}
export interface SponsorEvidence {
  cik: string;
  ein: string;
  ein_source: "edgar_header";
  bank_rssd: string;
  cert: string;
  deals: number;
  asset_class: string;
  deals_source: string;
}
export interface LinkChecks {
  /** FR Y-9C total assets (BHCK2170) against the 10-Q's total assets on the same date. */
  y9c_assets_tie?: { date: string; result: string };
  fdic_live?: { checked_at: string; report_date: string; verdict: string };
  exhibit21?: { url: string; accession: string; printed: boolean };
}
export interface LinkEvidence {
  sec: SecEvidence;
  nic?: NicEvidence;
  fdic?: FdicEvidence;
  relationship?: RelationshipEvidence;
  sponsor?: SponsorEvidence;
  /** Review rows: what supports the name match, and why no identifier links it. */
  supports?: string;
  why_no_key?: string;
  checks: LinkChecks;
}
export interface CompanyLink {
  ticker: string;
  cik: string;
  link_kind: LinkKind;
  key_field: KeyField;
  key_value: string;
  /** The entity as the source prints it (SEC conformed name, FDIC institution name); null on review rows. */
  entity_name: string | null;
  basis: LinkBasis;
  status: LinkStatus;
  valid_from: string | null;
  valid_to: string | null;
  evidence: LinkEvidence;
  rule_version: string;
  checked_at: string;
  y9c?: Y9cPointer[];
}

export const PROVEN_BASES: ReadonlySet<LinkBasis> = new Set(["ein_equal", "top_holder", "self", "nic_equity", "nic_other_basis", "sponsor_bank_chain"]);

/** A link is in force only when proven and not closed. */
export const isLive = (l: Pick<CompanyLink, "status" | "valid_to">): boolean => l.status === "proven" && l.valid_to == null;

// ------------------------------------------------------------------ the panels' payload

/** Where one figure is stored: dataset, snapshot, row and the field's native name. */
export interface FigureRef extends RecordPointer {
  field: string;
}
/** A snapshot as the panel cites it. */
export interface OfficialSource {
  dataset: string;
  snapshot: string;
  /** When the file was retrieved (not when the publisher revised it). */
  retrievedAt: string | null;
  publishedAt: string | null;
  fileSha256: string;
  /** The dataset's latest snapshot when it is not the one shown. */
  newerSnapshot: string | null;
}
/** A stored cell as the panel shows it: the publisher's string, and a number only for a plain decimal. */
export interface OfficialCell {
  text: string | null;
  value: number | null;
  /** number, empty (""), null (no value stored), text (anything else). */
  kind: "number" | "empty" | "null" | "text";
}
export interface BankLine {
  /** Native FDIC field name (the dictionary's label, e.g. ASSET). */
  field: string;
  label: string;
  /** Basis the FDIC definition states: year to date, the quarter, or a balance at the report date. */
  basis: "ytd" | "quarter" | "balance";
  /** Unit exactly as the snapshot's dictionary states it. */
  unit: string;
  title: string | null;
  cell: OfficialCell;
  ref: FigureRef;
}
export interface OfficialBank {
  cert: string;
  /** Name as the FDIC prints it. */
  name: string;
  kind: "insured" | "noninsured_trust";
  basis: LinkBasis;
  bankRssd: string | null;
  inCohort: boolean;
  state: string | null;
  /** Report date of the lines (ISO), when read. */
  reportDate: string | null;
  /** Total assets and deposits of the current quarter, for the table; null outside the cohort or when not read. */
  assets: OfficialCell | null;
  deposits: OfficialCell | null;
  lines: BankLine[];
  /** Why no figures are shown, when none are. */
  note: string | null;
  /** The FDIC's public page of the institution; null for a trust company the FDIC's public data does not list. */
  fdicUrl: string | null;
  linkRef: { dataset: string; snapshot: string; row: number } | null;
}
export interface HistoryMeasure {
  field: string;
  label: string;
  unit: string;
}
export interface HistoryPoint {
  /** ISO quarter end. */
  period: string;
  /** Index into `history.sources`. */
  source: number;
  row: number;
  /** Cells aligned to `history.measures`. */
  cells: OfficialCell[];
}
export interface BankHistory {
  cert: string;
  measures: HistoryMeasure[];
  sources: OfficialSource[];
  points: HistoryPoint[];
}
/** One branch state of an institution in the Summary of Deposits, as stored. */
export interface DepositsState {
  /** Branch state's postal abbreviation as stored (STALPBR). */
  code: string;
  /** Sum of the branches' deposits, in `DepositsByState.unit`. */
  deposits: OfficialCell;
  /** Branch records in the state. */
  branches: OfficialCell;
  row: number;
}
/** An institution's totals of the survey, as stored. */
export interface DepositsTotals {
  row: number;
  deposits: OfficialCell;
  branches: OfficialCell;
  /** States and territories with a branch. */
  states: OfficialCell;
  /** The survey year as stored (deposits are as of 30 June of it). */
  surveyYear: string | null;
}
/** One charter's deposits by branch state (FDIC Summary of Deposits), read by its certificate. */
export interface DepositsByState {
  cert: string;
  /** NAMEFULL as stored. */
  name: string | null;
  /** The unit the dictionary states for the deposits sums. */
  unit: string;
  states: DepositsState[];
  totals: DepositsTotals | null;
  source: OfficialSource;
  totalsSource: OfficialSource | null;
  /** Field labels the figures come from, for their references. */
  fields: { deposits: string; branches: string; state: string; states: string };
}
export interface Y9cLine {
  /** MDRM mnemonic, e.g. BHCAP793. */
  field: string;
  /** Description as stored in the Fed's variable dictionary. */
  label: string;
  /** Short name the panel uses. */
  short: string;
  /** Capital lines (Schedule HC-R) or balance sheet and income lines (Schedules HC and HI). */
  group: "capital" | "statement";
  /** Year to date (Schedule HI) or a balance or ratio at the report date. */
  basis: "ytd" | "balance";
  /** Reviewed unit (y9c-fields.ts), or null when it could not be established: then the value is shown as filed. */
  unit: string | null;
  unitEvidence: string | null;
  labelRef: RecordPointer | null;
  /** One cell per quarter, aligned to `quarters`. */
  cells: (OfficialCell & { ref: FigureRef })[];
}
export interface Y9cQuarter {
  reportDate: string;
  ref: RecordPointer;
  /** BHCK2170, total assets (BHC consolidated), USD thousands per the dictionary. */
  totalAssets: OfficialCell & { ref: FigureRef; unit: string | null };
}
export interface Y9cReport {
  rssd: string;
  legalName: string;
  source: OfficialSource;
  dictionary: OfficialSource | null;
  quarters: Y9cQuarter[];
  lines: Y9cLine[];
  /** Quarters the mapping points at but the read could not confirm. */
  missing: { reportDate: string; reason: string }[];
}
export interface AbsSponsorLine {
  sponsorCik: string;
  sponsorName: string;
  cert: string;
  deals: number;
  assetClass: string;
}
export interface OtherInstitution {
  cert: string;
  name: string;
  kind: "insured" | "noninsured_trust";
  fdicUrl: string;
}
export interface CompanyOfficial {
  ticker: string;
  registrant: { rssd: string; legalName: string; einCoverUrl: string | null } | null;
  banks: OfficialBank[];
  /** The bank whose history is included. */
  history: BankHistory | null;
  historyNote: string | null;
  /** Assets, deposits and quarterly net income of every proven cohort charter, largest first (the small multiple). */
  trends: BankHistory[];
  trendsNote: string | null;
  /** The selected charter's deposits by branch state. */
  deposits: DepositsByState | null;
  depositsNote: string | null;
  y9c: Y9cReport | null;
  y9cNote: string | null;
  abs: AbsSponsorLine[];
  sources: { current: OfficialSource | null; history: OfficialSource | null };
  /** Plain sentences the panels show as they are. */
  caveats: string[];
}
export type CompanyOfficialResult = { ok: true; data: CompanyOfficial } | { ok: false; reason: string };

/** What the page needs synchronously to guard name-matched bank rows: the certificates proven for a mapped ticker. */
export interface BankGuardEntry {
  certs: number[];
  /** RSSDs a deposits roll-up may be keyed by: the registrant, when it is the top holder of every proven bank. */
  rollup: string[];
}
