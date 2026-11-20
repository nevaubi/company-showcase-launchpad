/**
 * Registrant drift check (pure): compares each covered company's CIK with the registrant SEC's
 * ticker file (`https://www.sec.gov/files/company_tickers.json`) maps its ticker to. A holding-company
 * reorganisation moves a listed company to a new CIK (XOM: 34088 → 2115436, July 2026) and the old
 * CIK's index stops receiving its reports, so the SEC feed jobs silently miss them until coverage
 * carries the new CIK (with the old one in `formerCiks`).
 *
 * The worker runs it weekly (scripts/registrant-drift.ts); each drifting ticker is a job_state row
 * `registrant-drift:<TICKER>` that the watchdog raises as an alert naming the ticker and both CIKs.
 */
import { companyCiks, type CoverageCompany } from "@/lib/coverage";

export const DRIFT_PREFIX = "registrant-drift:";
export const driftKey = (ticker: string) => `${DRIFT_PREFIX}${ticker}`;
/** The ticker file lists about 10,000 registrants; a short answer is a bad download, not news. */
export const MIN_TICKER_FILE_ROWS = 5000;

export interface TickerFileEntry {
  cik_str: number | string;
  ticker: string;
  title: string;
}

export interface Drift {
  ticker: string;
  coverageCik: string;
  secCik: string;
  secName: string;
  /** SEC's CIK is one coverage already lists as former (coverage points at the wrong one) */
  knownFormer: boolean;
}

const normTicker = (t: string) => t.trim().toUpperCase().replace(/[./]/g, "-");
const unpad = (cik: string | number) => String(Number(cik));

/** Entries of the ticker file, or null when it is not the file (wrong shape or too short). */
export function parseTickerFile(json: unknown): TickerFileEntry[] | null {
  if (!json || typeof json !== "object") return null;
  const rows = Object.values(json as Record<string, unknown>).filter(
    (r): r is TickerFileEntry => !!r && typeof r === "object" && typeof (r as TickerFileEntry).ticker === "string" && Number.isFinite(Number((r as TickerFileEntry).cik_str)),
  );
  return rows.length >= MIN_TICKER_FILE_ROWS ? rows : null;
}

export function registrantDrift(coverage: readonly Pick<CoverageCompany, "ticker" | "cik" | "formerCiks">[], file: readonly TickerFileEntry[]): { drift: Drift[]; unlisted: string[] } {
  const sec = new Map<string, TickerFileEntry>();
  for (const e of file) if (!sec.has(normTicker(e.ticker))) sec.set(normTicker(e.ticker), e);
  const drift: Drift[] = [];
  const unlisted: string[] = [];
  for (const c of coverage) {
    const e = sec.get(normTicker(c.ticker));
    if (!e) {
      unlisted.push(c.ticker);
      continue;
    }
    const secCik = unpad(e.cik_str);
    if (secCik === unpad(c.cik)) continue;
    drift.push({ ticker: c.ticker, coverageCik: unpad(c.cik), secCik, secName: e.title, knownFormer: companyCiks(c).includes(secCik) });
  }
  return { drift, unlisted };
}

/** The job_state row for one drifting ticker (cursor = SEC's CIK, reason names both CIKs). */
export function driftRow(d: Drift, nowMs: number) {
  return {
    job: driftKey(d.ticker),
    cursor: Number(d.secCik),
    paused_reason: `coverage CIK ${d.coverageCik}, SEC CIK ${d.secCik} (${d.secName.slice(0, 80)})`,
    updated_at: new Date(nowMs).toISOString(),
  };
}
