/**
 * Form 4 repair pass (pure decisions). The scheduled `sec` walk parses at most two Form 4s per
 * company per visit, newest first, and only filings inside its 45-day window; it visits each company
 * about every 4 days. Bursts of same-day Form 4s and filings that reached `sec_filings` weeks late
 * (new coverage, the day pass, the catch-up) were never parsed: 20 Nov 2026, 4,245 of 9,817 Form 4s
 * filed 25 Sep to 17 Nov had neither trade rows nor a receipt, 1,638 of them already outside the
 * window. The repair pass walks `sec_filings` one filing day at a time, newest day first, and parses
 * every Form 4 of the day that has no `insider_trades` row, no `form4-seen:<accn>` receipt (read
 * before: no non-derivative transaction) and no given-up failure receipt.
 *
 * Cursor: job_state `form4-repair`, paused_reason `day:YYYY-MM-DD` (the day still being worked). The
 * cursor moves to an earlier day only when nothing is left to do on the current day; past the floor
 * it wraps to the newest day. A failure is recorded per filing (`form4-fail:<accn>`, cursor = tries);
 * after FORM4_MAX_TRIES the filing is skipped with its reason kept. An SEC refusal (403/429) stops the
 * run and holds the cursor.
 */

export const FORM4_REPAIR_KEY = "form4-repair";
export const FORM4_SEEN_PREFIX = "form4-seen:";
export const FORM4_FAIL_PREFIX = "form4-fail:";
export const FORM4_MAX_TRIES = 3;
export const FORM4_FORMS = ["4", "4/A"] as const;

export interface Form4Filing {
  accn: string;
  ticker: string;
  cik: string;
  filed: string;
  report: string | null;
  doc: string;
}

export const seenKey = (accn: string) => `${FORM4_SEEN_PREFIX}${accn}`;
export const failKey = (accn: string) => `${FORM4_FAIL_PREFIX}${accn}`;

/** The cursor row's day, or null (start at the newest day). */
export function parseRepairDay(reason: string | null | undefined): string | null {
  const m = /^day:(\d{4}-\d{2}-\d{2})$/.exec(reason ?? "");
  return m ? m[1] : null;
}
export const repairReason = (day: string) => `day:${day}`;

/**
 * Filings of one day still to read: no trade rows, no "no non-derivative transaction" receipt, and
 * not given up after FORM4_MAX_TRIES failures. Order: accession, so runs are repeatable.
 */
export function form4Todo(rows: readonly Form4Filing[], traded: ReadonlySet<string>, seen: ReadonlySet<string>, fails: ReadonlyMap<string, number>): Form4Filing[] {
  return rows
    .filter((r) => !traded.has(r.accn) && !seen.has(r.accn) && (fails.get(r.accn) ?? 0) < FORM4_MAX_TRIES)
    .sort((a, b) => a.accn.localeCompare(b.accn));
}

/** The failure receipt after one more failed try (bounded: a filing is skipped after FORM4_MAX_TRIES). */
export function failReceipt(accn: string, triesBefore: number, error: string, nowMs: number) {
  const tries = triesBefore + 1;
  return {
    job: failKey(accn),
    cursor: tries,
    paused_reason: `${tries >= FORM4_MAX_TRIES ? "gave up" : `try ${tries}`}: ${error}`.slice(0, 200),
    updated_at: new Date(nowMs).toISOString(),
  };
}

/** An SEC answer that means "stop asking for now" (the run ends and the cursor stays). */
export const isSecRefusal = (e: unknown) => {
  const s = (e as { status?: unknown } | null)?.status;
  return s === 403 || s === 429 || /responded (403|429)/.test(e instanceof Error ? e.message : String(e));
};
