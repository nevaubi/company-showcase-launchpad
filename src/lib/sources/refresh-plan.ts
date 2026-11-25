/** Refresh planning and CSV validation. No I/O, numeric inference or publication. */
import { NativeCsvReader } from "./csv";
import { supplementalRefreshProof, type SupplementalRefreshProof } from "./refresh-supplements";
import type { SourceColumn, SourceFileManifest, SourceIngest, SourceJson } from "./schema";

export type RefreshFamily = "fred" | "fhfa" | "eia_mer";
export type RefreshEligibility = { eligible: true; family: RefreshFamily; url: string; intervalMs: number; supplementalProof?: SupplementalRefreshProof }
  | { eligible: false; reason: string };
export type RefreshState = {
  last_attempt_at?: string;
  last_checked_at?: string;
  last_success_at?: string;
  next_due_at?: string;
  failures?: number;
  last_error?: string;
  last_requested_url?: string;
  etag?: string;
  last_modified?: string;
  last_staged_snapshot_id?: string;
};
const DAY = 24 * 60 * 60_000;

/**
 * The one identification every official-source collector sends to a publisher: who is asking and
 * where to write. The SEC lane sends the same line (`SEC_UA`); a test holds the two together.
 */
export const OFFICIAL_USER_AGENT = "FiledUnder Research research@filedunder.ai";

/** A refreshed family: the three direct CSV families and the two native adapters. */
export type RefreshSwitchFamily = RefreshFamily | "fdic" | "taiwan";

/** The worker environment variable that stops one family and leaves the others running. */
export const REFRESH_FAMILY_SWITCH: Record<RefreshSwitchFamily, string> = {
  fred: "OFFICIAL_FRED_ENABLED",
  eia_mer: "OFFICIAL_EIA_MER_ENABLED",
  fhfa: "OFFICIAL_FHFA_ENABLED",
  fdic: "OFFICIAL_FDIC_NATIVE_ENABLED",
  taiwan: "OFFICIAL_TAIWAN_REVENUE_ENABLED",
};

/**
 * A family is on unless its variable is a clear no: 0, false, off or no (any case, spaces ignored).
 * Unset and every other value are on. The FDIC and Taiwan variables existed before with the rule
 * "off only at 0" (docs/official-sources.md), so a value already set on the worker keeps its meaning.
 */
export function refreshFamilyEnabled(family: RefreshSwitchFamily, env: Record<string, string | undefined>): boolean {
  const value = env[REFRESH_FAMILY_SWITCH[family]];
  return value === undefined || !/^(0|false|off|no)$/i.test(value.trim());
}

/** The sentence a plan or receipt gives for a family that is switched off; null while it is on. */
export function refreshFamilyDisabledReason(family: RefreshSwitchFamily, env: Record<string, string | undefined>): string | null {
  if (refreshFamilyEnabled(family, env)) return null;
  const name = REFRESH_FAMILY_SWITCH[family];
  return `Refresh of this family is switched off by ${name}=${String(env[name]).trim().slice(0, 20)}.`;
}

/** Paths were retained in the acquired official provenance, not supplied on a CLI. */
export function authoritativeCsvUrl(value: string): { family: RefreshFamily; url: URL } | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return null;
  if (url.hostname === "fred.stlouisfed.org" && url.pathname === "/graph/fredgraph.csv") {
    const ids = url.searchParams.get("id")?.split(",") ?? [];
    if (!ids.length || ids.length > 32 || ids.some(id => !/^[A-Za-z0-9_.-]+$/.test(id))) return null;
    for (const [key, val] of url.searchParams) {
      if (!["id", "cosd", "coed"].includes(key)) return null;
      if (key !== "id" && !/^\d{4}-\d{2}-\d{2}$/.test(val)) return null;
    }
    return { family: "fred", url };
  }
  if (["www.fhfa.gov", "fhfa.gov"].includes(url.hostname)
      && ["/hpi/download/annual/hpi_at_tract.csv", "/hpi/download/monthly/hpi_master.csv"].includes(url.pathname)
      && !url.search) return { family: "fhfa", url };
  if (url.hostname === "www.eia.gov" && url.pathname === "/totalenergy/data/browser/csv.php"
      && /^T[A-Za-z0-9.]+$/.test(url.searchParams.get("tbl") ?? "")
      && [...url.searchParams.keys()].every(key => key === "tbl")) return { family: "eia_mer", url };
  return null;
}

export function refreshEligibility(file: Pick<SourceFileManifest, "provenance"> & Partial<Pick<SourceFileManifest, "sha256">>,
  ingest: SourceIngest, now: Date, datasetId?: string): RefreshEligibility {
  let direct = file.provenance.direct_url;
  let supplemental: SupplementalRefreshProof | null = null;
  if (typeof direct !== "string" || file.provenance.direct_download_sha256_verified !== true) {
    supplemental = supplementalRefreshProof(datasetId, file.sha256, ingest);
    if (!supplemental) return { eligible: false, reason: "No hash-proven original direct CSV download; derived tables and JSON APIs require their own reviewed adapter." };
    direct = supplemental.direct_url;
  }
  const trusted = authoritativeCsvUrl(direct);
  if (!trusted) return { eligible: false, reason: "Direct endpoint is outside the reviewed official CSV families; a separate adapter is required." };
  if (ingest.format !== "csv" || ingest.header_rows !== 1) return { eligible: false, reason: "This adapter requires one native CSV header row." };
  // Retained FRED URLs often end at the old collection date. Advance only that
  // documented upper date bound; preserve series IDs and the original lower bound.
  if (trusted.family === "fred" && trusted.url.searchParams.has("coed")) trusted.url.searchParams.set("coed", now.toISOString().slice(0, 10));
  return { eligible: true, family: trusted.family, url: trusted.url.href, intervalMs: trusted.family === "fred" ? DAY : 7 * DAY,
    ...(supplemental ? { supplementalProof: supplemental } : {}) };
}

/** Evidence for a newly fetched response; never writes back to the old file record. */
export function directRefreshProvenance(file: Pick<SourceFileManifest, "provenance">,
  eligibility: Extract<RefreshEligibility, { eligible: true }>,
  response: { url: string; resolvedUrl: string; etag?: string; lastModified?: string }): Record<string, SourceJson> {
  const supplemental = eligibility.supplementalProof ?? file.provenance.supplemental_original_download_evidence;
  return { adapter: "official_direct_csv_v1", direct_url: response.url, direct_download_sha256_verified: true,
    original_direct_url: file.provenance.direct_url ?? eligibility.supplementalProof?.direct_url ?? null,
    response_resolved_url: response.resolvedUrl, http_status: 200,
    response_etag: response.etag ?? null, response_last_modified: response.lastModified ?? null,
    family: eligibility.family, fetched_complete_response: true,
    ...(supplemental ? { supplemental_original_download_evidence: supplemental } : {}) };
}

export function safeRefreshRedirect(initial: string, redirected: string): boolean {
  const a = authoritativeCsvUrl(initial), b = authoritativeCsvUrl(redirected);
  if (!a || !b || a.family !== b.family || a.url.pathname !== b.url.pathname) return false;
  const identity = a.family === "fred" ? ["id", "cosd", "coed"] : a.family === "eia_mer" ? ["tbl"] : [];
  return identity.every(key => a.url.searchParams.get(key) === b.url.searchParams.get(key));
}

export function isRefreshDue(state: RefreshState | null, now: number): boolean {
  const due = state?.next_due_at ? Date.parse(state.next_due_at) : 0;
  return !Number.isFinite(due) || due <= now;
}

export function refreshFailure(state: RefreshState, now: Date, error: string): RefreshState {
  const failures = Math.min(16, (state.failures ?? 0) + 1);
  return { ...state, last_attempt_at: now.toISOString(), failures, last_error: error.slice(0, 1000),
    next_due_at: new Date(now.getTime() + Math.min(DAY, 30 * 60_000 * 2 ** (failures - 1))).toISOString() };
}

/**
 * A collection held for review (a changed native header, an empty response): a person has to look,
 * and collecting the same file again in 30 minutes only registers another held snapshot and uploads
 * its bytes again. The next try is a day later; the failure count and the reason are kept.
 */
export function refreshHeld(state: RefreshState, now: Date, reason: string): RefreshState {
  return { ...refreshFailure(state, now, reason), next_due_at: new Date(now.getTime() + DAY).toISOString() };
}

export function refreshChecked(state: RefreshState, now: Date, intervalMs: number, result: {
  url: string; etag?: string; lastModified?: string; stagedSnapshotId?: string;
}): RefreshState {
  return { ...state, last_attempt_at: now.toISOString(), last_checked_at: now.toISOString(),
    next_due_at: new Date(now.getTime() + intervalMs).toISOString(), failures: 0, last_error: undefined,
    last_requested_url: result.url, etag: result.etag, last_modified: result.lastModified,
    ...(result.stagedSnapshotId ? { last_success_at: now.toISOString(), last_staged_snapshot_id: result.stagedSnapshotId } : {}) };
}

export type NativeRefreshStats = { headers: string[]; rows: number; blankCounts: number[]; headerMatches: boolean };

/** Uses the importer's exact CSV parser; validation recomputes fresh counts. */
export class NativeRefreshScanner {
  private readonly reader: NativeCsvReader;
  private headers: string[] | null = null;
  private rows = 0;
  private blanks: number[] = [];
  private unfinishedCharacters = 0;
  constructor(delimiter: string, private readonly expectedHeaders: string[], private readonly maxRowCharacters = 8 * 1024 * 1024) {
    this.reader = new NativeCsvReader(delimiter);
  }
  private consume(rows: string[][]) {
    for (const row of rows) {
      if (row.reduce((n, value) => n + value.length, 0) > this.maxRowCharacters) throw new Error("Native CSV row exceeds the bounded refresh row size");
      if (this.headers === null) {
        if (!row.length || row.length > 16384) throw new Error("Invalid native CSV header width");
        this.headers = row; this.blanks = row.map(() => 0); continue;
      }
      if (row.length !== this.headers.length) throw new Error(`Native CSV row ${this.rows + 1} has ${row.length} fields, expected ${this.headers.length}`);
      this.rows++;
      for (let i = 0; i < row.length; i++) if (row[i] === "") this.blanks[i]++;
    }
  }
  write(text: string) {
    this.unfinishedCharacters += text.length;
    const rows = this.reader.write(text);
    this.consume(rows);
    if (rows.length) this.unfinishedCharacters = text.length;
    if (this.unfinishedCharacters > this.maxRowCharacters) throw new Error("Native CSV record exceeds the bounded refresh row size");
  }
  finish(): NativeRefreshStats {
    this.consume(this.reader.close());
    if (!this.headers) throw new Error("Missing native CSV header");
    return { headers: this.headers, rows: this.rows, blankCounts: this.blanks,
      headerMatches: this.headers.length === this.expectedHeaders.length && this.headers.every((name, i) => name === this.expectedHeaders[i]) };
  }
}

export function refreshColumns(previous: SourceColumn[], stats: NativeRefreshStats): SourceColumn[] {
  return stats.headerMatches ? previous.map(column => ({ ...column }))
    : stats.headers.map((label, index) => ({ key: `col${String(index + 1).padStart(4, "0")}`, label, type: "string" }));
}
