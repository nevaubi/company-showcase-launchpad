// Pure rules for the worker's per-filing steps (redline + supply refresh) and weekly supply intel.
export const MAX_ATTEMPTS = 5;
export const BATCH = 30;
/** Supply links are refreshed only for filings this recent; older backlog gets its redline only. */
export const SUPPLY_WINDOW_DAYS = 30;
export const INTEL_EVERY_MS = 7 * 86_400_000;
export const INTEL_COMPANIES = 20;

export interface NewFiling { accn: string; ticker: string; form: string; filed: string; report?: string | null; doc: string; discovered_at: string }

/** Failure receipts are job_state rows `filing-steps-fail:<accn>` (cursor = attempts). */
export const failKey = (accn: string) => `filing-steps-fail:${accn}`;
export function retryable(attempts: number): boolean { return attempts < MAX_ATTEMPTS; }

/** Epoch seconds cursor (fits job_state.cursor until 2038). */
export const toCursor = (iso: string) => Math.floor(Date.parse(iso) / 1000);
export const fromCursor = (c: number) => new Date(c * 1000).toISOString();

export function wantsSupply(f: { filed: string }, today = new Date().toISOString().slice(0, 10)): boolean {
  return Date.parse(`${today}T00:00:00Z`) - Date.parse(`${f.filed}T00:00:00Z`) <= SUPPLY_WINDOW_DAYS * 86_400_000;
}

/** Covered companies whose newest supply signal is oldest (never-signalled companies first). */
export function oldestSignals(tickers: string[], newest: Map<string, string>, n = INTEL_COMPANIES): string[] {
  return [...tickers].sort((a, b) => (newest.get(a) ?? "").localeCompare(newest.get(b) ?? "") || a.localeCompare(b)).slice(0, n);
}

/** One ticker's supply refresh per run, however many of its filings arrived. */
export function supplyTickers(done: NewFiling[], today?: string): string[] {
  return [...new Set(done.filter((f) => wantsSupply(f, today)).map((f) => f.ticker))];
}
