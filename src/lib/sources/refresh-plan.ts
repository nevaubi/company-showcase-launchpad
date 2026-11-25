/** Refresh planning and CSV validation. No I/O, numeric inference or publication. */
import { NativeCsvReader } from "./csv";
import type { SourceColumn, SourceFileManifest, SourceIngest } from "./schema";

export type RefreshFamily = "fred" | "fhfa" | "eia_mer";
export type RefreshEligibility = { eligible: true; family: RefreshFamily; url: string; intervalMs: number }
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
      && /^T[A-Z0-9.]+$/.test(url.searchParams.get("tbl") ?? "")
      && [...url.searchParams.keys()].every(key => key === "tbl")) return { family: "eia_mer", url };
  return null;
}

export function refreshEligibility(file: Pick<SourceFileManifest, "provenance">, ingest: SourceIngest, now: Date): RefreshEligibility {
  const direct = file.provenance.direct_url;
  if (typeof direct !== "string" || file.provenance.direct_download_sha256_verified !== true) {
    return { eligible: false, reason: "No hash-proven original direct CSV download; derived tables and JSON APIs require their own reviewed adapter." };
  }
  const trusted = authoritativeCsvUrl(direct);
  if (!trusted) return { eligible: false, reason: "Direct endpoint is outside the reviewed official CSV families; a separate adapter is required." };
  if (ingest.format !== "csv" || ingest.header_rows !== 1) return { eligible: false, reason: "This adapter requires one native CSV header row." };
  // Retained FRED URLs often end at the old collection date. Advance only that
  // documented upper date bound; preserve series IDs and the original lower bound.
  if (trusted.family === "fred" && trusted.url.searchParams.has("coed")) trusted.url.searchParams.set("coed", now.toISOString().slice(0, 10));
  return { eligible: true, family: trusted.family, url: trusted.url.href, intervalMs: trusted.family === "fred" ? DAY : 7 * DAY };
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
