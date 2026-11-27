import { createHash } from 'node:crypto';

export type Json = Record<string, any>;
export const MAX_IN_FLIGHT = 1;
/** Owner, Nov 19: no rush. Firecrawl credits allowed in any trailing 60 minutes (env VENDOR_MAX_CREDITS_PER_HOUR overrides). */
export const MAX_CREDITS_PER_HOUR = 12000;
export const PACING_REASON = 'pacing: hourly credit budget reached';
export const INTERRUPTED_REASON = 'collector interrupted; resume from existing files';
export const MAX_ATTEMPTS = 3;
export const PHASE_B_CALL_LIMIT = 2000;
export const CREDIT_PROBE_MS = 30 * 60 * 1000;
export const PROVIDER_PENDING_MS = 10 * 60 * 1000;
export const PROGRESS_COMPANIES = 50;
export const PHASE_A_CREDIT_LIMIT = 1500;
/**
 * Fiscal.ai capabilities collected per company in Phase A, in order. prices/daily is deliberately absent
 * (owner, Nov 19): the app already keeps its own price history, so vendor daily prices are not collected.
 * Also cut (owner, Nov 19) as duplicates: prices/splits (EODHD splits is kept), filings/list (app keeps the SEC index)
 * and ownership/insider-transactions (app parses Form 4 from the SEC).
 */
export const CUT_FISCAL_CAPABILITIES = ['prices/daily','prices/splits','filings/list','ownership/insider-transactions'] as const;
export const PHASE_A_FISCAL_CAPABILITIES = ['company/segments-and-kpis','financials/income-statement','financials/balance-sheet','financials/cash-flow-statement','financials/income-statement-as-reported','financials/balance-sheet-as-reported','financials/cash-flow-statement-as-reported','financials/adjusted-metrics','company/shares-outstanding','ratios/series','ownership/institutional-holders','ownership/insider-holders','events/ir-events'] as const;
/** Per-company ceiling for Phase C (owner, Nov 19), so one company with many matches can't run away. */
export const PHASE_C_CREDIT_LIMIT = 150;
/** Phase B/C capabilities cut (owner, Nov 19): duplicates of data the app already keeps, noisy matches, or news. */
export const CUT_PHASE_BC_CAPABILITIES = ['fred/series/series','fred/series/observations','bls-gov/economic-statistics/bls_series_detail','bls-gov/economic-statistics/bls_top_picks','bls-gov/economic-statistics/bls_surveys','fiscaldata-treasury-gov/fiscal-data/data','fiscaldata-treasury-gov/fiscal-data/datasets','census-gov/census/data','census-gov/census/variables','census-gov/census/datasets','nasdaq-com/news/latest_headlines','govinfo-gov/legislation/search','nhtsa-gov/recalls/vehicle_recalls','banks-data-fdic-gov/bank-data/institutions','banks-data-fdic-gov/bank-data/financials'] as const;
export const EIA_CALL_LIMIT = 300;
export function phaseACanCall(spent: number, reserved: number, limit: number = PHASE_A_CREDIT_LIMIT) {
  return spent + reserved <= limit;
}
export function earningsBatches(tickers: string[], stored: Set<string>, today: Date) {
  const to = new Date(today);
  to.setUTCDate(to.getUTCDate() + 90);
  const missing = tickers.filter(t => !stored.has(t));
  return Array.from({length: Math.ceil(missing.length / 10)}, (_, i) => ({
    tickers: missing.slice(i * 10, i * 10 + 10),
    options: {symbols: missing.slice(i * 10, i * 10 + 10).map(t => `${t}.US`).join(','), from: '1996-01-01', to: to.toISOString().slice(0, 10)},
  }));
}
export function earningsRecords(result: Json, ticker: string) {
  return records(result, {response:{key:'earnings'}}).filter(r => String(r.code ?? r.symbol ?? '').toUpperCase() === `${ticker}.US`.toUpperCase());
}
export function earningsNext(result: Json, contract: Json, options: Json): Json | null {
  const data = result.data ?? {};
  const meta = result.pagination ?? data.pagination ?? result.meta ?? data.meta ?? {};
  const more = meta.hasNextPage === true || meta.hasMore === true || meta.nextCursor != null || meta.next_cursor != null || meta.nextPage != null || data.next_offset != null || (meta.totalPages && Number(options.page ?? 1) < meta.totalPages);
  if (!more) return null;
  const next = nextOptions(result, contract, options);
  if (!next) throw new Error('Earnings reports more pages but its reviewed contract exposes no continuation option');
  return next;
}
export function storageLedger(detail: Json) { return {...detail, credits:0}; }
export function providerPending(body: Json) {
  return /provider request is still running|retry with the same x-request-id once it has finished/i.test(JSON.stringify(body));
}
export function providerMiss(body: Json) {
  return /"(?:code|type)"\s*:\s*"not_found"/i.test(JSON.stringify(body));
}
/** Registrable domain of a website ("https://about.nike.com" → "nike.com", "www.bp.co.uk" → "bp.co.uk"). */
export function primaryDomain(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  let host: string;
  try { host = new URL(/^https?:/i.test(url) ? url : `https://${url}`).hostname.toLowerCase(); } catch { return undefined; }
  const parts = host.replace(/^www\./, '').split('.').filter(Boolean);
  if (parts.length < 2) return undefined;
  const sld = /^(co|com|org|net|ac|gov)$/.test(parts[parts.length-2]) && parts[parts.length-1].length === 2;
  return parts.slice(sld ? -3 : -2).join('.');
}
/** One attempt per identifier, in order: primary domain, legal name + domain, then the LinkedIn page. */
export function legionIdentifiers(domain: string | undefined, legal: string | undefined, linkedin: string | undefined): Json[] {
  const options: Json[] = [];
  if (domain) options.push({domain, min_confidence:'high'});
  if (legal && domain) options.push({name:legal, domain, min_confidence:'high'});
  if (linkedin && /^https:\/\/(www\.)?linkedin\.com\/company\//i.test(linkedin)) options.push({social_url:linkedin, min_confidence:'high'});
  return options;
}
/** Records a stored or returned page holds (ledger `items`). */
export function pageRecords(pages: Json[], contract: Json): number {
  return pages.reduce((n, p) => n + records(p.response ?? {}, contract).length, 0);
}
export function fileKey(provider: string, capability: string, name: string) {
  return `vendor/${provider}/${capability.replaceAll('/', '__')}/${name}.json`;
}
export function requestId(provider: string, capability: string, name: string, options: Json) {
  const ordered = (x: any): any => Array.isArray(x) ? x.map(ordered) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, ordered(x[k])])) : x;
  return createHash('sha256').update(JSON.stringify([provider, capability, name, ordered(options)])).digest('hex');
}
export function exhausted(status: number, body: Json) {
  const text = JSON.stringify(body);
  return status === 402 || (status === 403 && /Credit limit reached/i.test(text)) || /insufficient_credits|credits_exhausted|credit_balance_exhausted/i.test(text);
}
export function records(result: Json, contract: Json): any[] {
  const data = result.data ?? result.records;
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  const key = contract.response?.key;
  if (key && Array.isArray(data[key])) return data[key];
  for (const k of ['records', 'results', 'items', 'data', 'observations', 'earnings', 'ratings', 'removed']) if (Array.isArray(data[k])) return data[k];
  return [];
}
/** Only advance with explicit continuation, or a documented page parameter and a full page. */
export function nextOptions(result: Json, contract: Json, options: Json): Json | null {
  const data = result.data ?? {};
  const meta = result.pagination ?? data.pagination ?? result.meta ?? data.meta ?? {};
  if (meta.hasNextPage === false || meta.hasMore === false) return null;
  const names = new Set((contract.options ?? []).map((o: Json) => o.name));
  const cursor = meta.nextCursor ?? meta.next_cursor ?? data.nextCursor ?? data.next_cursor ?? result.nextCursor ?? result.next_cursor ?? data.continuation ?? result.continuation;
  if (cursor) {
    const field = ['cursor', 'continuation'].find(k => names.has(k));
    if (field && options[field] !== cursor) return { ...options, [field]: cursor };
  }
  const page = ['pageNumber', 'page', '$offset', 'offset', 'skip'].find(k => names.has(k));
  if (!page) return null;
  const sizeName = ['pageSize', 'pagesize', 'page_size', '$limit', 'limit', 'per_page'].find(k => names.has(k));
  const size = Number(sizeName ? options[sizeName] ?? contract.options.find((o: Json) => o.name === sizeName)?.default : 0);
  const count = records(result, contract).length;
  const more = meta.hasNextPage === true || meta.hasMore === true || data.next_offset != null || (meta.totalPages && Number(options[page] ?? 1) < meta.totalPages) || (size > 0 && count >= size);
  if (!more || count === 0) return null;
  return { ...options, [page]: meta.nextPage ?? data.next_offset ?? Number(options[page] ?? (page === 'pageNumber' ? 1 : 0)) + (page.includes('offset') || page === 'skip' ? size : 1) };
}
export function assertOptions(contract: Json, options: Json) {
  const names = new Set((contract.options ?? []).map((o: Json) => o.name));
  for (const key of Object.keys(options)) if (!names.has(key)) throw new Error(`${contract.id}: invalid option ${key}; valid: ${[...names].join(', ')}`);
  for (const o of contract.options ?? []) {
    if (o.required && options[o.name] == null) throw new Error(`${contract.id}: missing ${o.name}`);
    if (o.oneOf && options[o.name] != null && !o.oneOf.map(String).includes(String(options[o.name]))) throw new Error(`${contract.id}: ${o.name} valid options: ${o.oneOf.join(', ')}`);
  }
}
export function pruneWithdrawn(value: any, ids: Set<string>): any {
  if (Array.isArray(value)) return value.filter(x => !(x && typeof x === 'object' && ids.has(String(x.id)))).map(x => pruneWithdrawn(x, ids));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, pruneWithdrawn(v, ids)]));
  return value;
}
export const CREDIT_PAUSE_REASON = 'Firecrawl credits exhausted; probing every 30 minutes';
/**
 * Credit pause shared by concurrent calls: a 402 always records the paused reason and starts one
 * 30-minute probe wait; a concurrent call that happens to succeed during that wait must not clear
 * the reason (only a success after the wait — the probe — does), so status stays truthful.
 */
export class CreditPause {
  wait: Promise<void> | null = null;
  paused = false;
  constructor(private setReason: (reason: string | null) => Promise<unknown>, private sleep: (ms: number) => Promise<unknown>, private probeMs = CREDIT_PROBE_MS) {}
  exhausted(): Promise<void> {
    if (!this.wait) {
      this.paused = true;
      this.wait = (async () => {
        try { await this.setReason(CREDIT_PAUSE_REASON); } catch { /* lease loss stops the collector separately */ }
        await this.sleep(this.probeMs);
      })().finally(() => { this.wait = null; });
    }
    return this.wait;
  }
  /** Resume a collector that was already paused when it took the lease. */
  resume() { if (!this.wait) { this.paused = true; this.wait = (async () => { await this.sleep(this.probeMs); })().finally(() => { this.wait = null; }); } }
  async success() {
    if (this.wait || !this.paused) return;
    this.paused = false;
    await this.setReason(null);
  }
}
/** An earnings file without the duplicated batch response; record counts are returned for verification. */
export function compactEarningsFile(v: Json): { value: Json; changed: boolean; recordsBefore: number; recordsAfter: number } {
  const count = (pages: Json[]) => pages.reduce((n, p) => n + (Array.isArray(p.response?.data?.earnings) ? p.response.data.earnings.length : 0), 0);
  const pages: Json[] = v.pages ?? [];
  const changed = pages.some((p) => 'sharedResponse' in p);
  const next = { ...v, pages: pages.map(({ sharedResponse: _drop, ...p }) => p) };
  return { value: next, changed, recordsBefore: count(pages), recordsAfter: count(next.pages) };
}

export function hourlyCreditLimit(env: Record<string, string | undefined> = process.env) {
  const v = Number(env.VENDOR_MAX_CREDITS_PER_HOUR);
  return Number.isFinite(v) && v > 0 ? v : MAX_CREDITS_PER_HOUR;
}
/** Trailing-60-minute credit window; seeded from the ledger so restarts and handovers keep counting. */
export class HourlyBudget {
  private entries: { at: number; credits: number }[] = [];
  constructor(public limit = hourlyCreditLimit(), private clock: () => number = Date.now) {}
  add(credits: number, at = this.clock()) { if (credits > 0) this.entries.push({ at, credits }); }
  spent(at = this.clock()) {
    this.entries = this.entries.filter((e) => e.at > at - 3600000);
    return this.entries.reduce((n, e) => n + e.credits, 0);
  }
  /** A call larger than the whole budget may still run once the window is empty, so it never waits forever. */
  canCall(next: number, at = this.clock()) {
    const spent = this.spent(at);
    return spent + next <= this.limit || spent === 0;
  }
}

// ---------------------------------------------------------------------------------------------
// What is already settled (repairs of 27 Nov 2026)
//
// Before these, every restart walked all companies again from the first: each stored file was
// downloaded to learn that it exists (16 GB a pass), and requests that can never be answered were
// asked again on every pass (5,016 refusals of 227 companies' segments in three days).
//
//   stored     a file in the archive, known from a listing of the archive folders, not a download
//   answered   the provider said something that will not change by asking again:
//                expired    HTTP 409 "request already completed, its response is no longer kept":
//                           this request id can never return data (a new id is a new, charged call;
//                           that is the owner's decision, never the collector's). All 232 on file on
//                           27 Nov 2026 had first answered "not found" at no charge; the refusal is
//                           that same answer after the provider dropped its copy.
//                not_found  the provider has no such company or no such data: asked again after 30 days
//                           (same request id: the provider repeats the answer or refuses, which is final)
//                no_match   no identifier to match the company on, or no verified match: again after 30 days
//              kept as one ledger row each (`unavailable`), read back at the start
// ---------------------------------------------------------------------------------------------

export type AnswerKind = 'expired' | 'not_found' | 'no_match';
export interface Answer { kind: AnswerKind; at: number }
/** How long a "not there" answer stands before the provider is asked again. `expired` stands for good. */
export const ANSWER_RECHECK_MS = 30 * 86_400_000;
export const answerKey = (provider: string, capability: string, name: string) => `${provider}/${capability}/${name}`;

/** HTTP 409: the request ran once and its response was dropped; this request id can never return it. */
export function providerExpired(status: number, body: Json): boolean {
  return status === 409 && /request already completed/i.test(JSON.stringify(body)) && /no longer kept/i.test(JSON.stringify(body));
}

/** Whether a recorded answer still stands at `now`. */
export function answerStands(a: Answer | undefined, now: number): boolean {
  if (!a) return false;
  return a.kind === 'expired' || now - a.at < ANSWER_RECHECK_MS;
}

/** The answers on file, from their ledger rows (`detail.unavailable`); the newest row of a key wins. */
export function answersFromLedger(rows: readonly { started_at: string; detail: Json }[]): Map<string, Answer> {
  const out = new Map<string, Answer>();
  for (const r of rows) {
    const d = r.detail ?? {};
    const kind = d.unavailable as AnswerKind | undefined;
    if ((kind !== 'expired' && kind !== 'not_found' && kind !== 'no_match') || !d.provider || !d.capability || !d.name) continue;
    const key = answerKey(String(d.provider), String(d.capability), String(d.name));
    const at = Date.parse(r.started_at);
    const prev = out.get(key);
    if (!prev || at >= prev.at) out.set(key, { kind, at });
  }
  return out;
}

export interface PhaseATodo {
  /** fiscal.ai capabilities still to fetch, in the collection order */
  fiscal: string[];
  /** the transcripts file is missing while the list of IR events is stored or still to fetch */
  transcripts: boolean;
  /** EODHD capabilities still to fetch */
  eod: string[];
  /** the Data Legion match is still to try */
  legion: boolean;
  /** Benzinga capabilities still to fetch */
  benzinga: string[];
  /** the company profile itself is still to fetch */
  profile: boolean;
  /** nothing left: no call, no download */
  done: boolean;
}

export const PHASE_A_EOD_CAPABILITIES = ['fundamentals/company', 'corporate-actions/dividends', 'corporate-actions/splits'] as const;
export const PHASE_A_BENZINGA_CAPABILITIES = ['calendar/ratings', 'calendar/consensus-ratings'] as const;

/**
 * What Phase A still has to do for one company: every piece that is neither stored nor answered.
 * Without a profile (the provider does not know the company) nothing of fiscal.ai can be asked, so
 * its capabilities are not counted as missing.
 */
export function phaseATodo(ticker: string, stored: ReadonlySet<string>, answers: ReadonlyMap<string, Answer>, now: number): PhaseATodo {
  const settled = (provider: string, cap: string) => stored.has(fileKey(provider, cap, ticker)) || answerStands(answers.get(answerKey(provider, cap, ticker)), now);
  const profile = !settled('fiscal-ai', 'company/profile');
  const known = stored.has(fileKey('fiscal-ai', 'company/profile', ticker));
  const fiscal = known || profile ? PHASE_A_FISCAL_CAPABILITIES.filter((cap) => !settled('fiscal-ai', cap)) : [];
  // transcripts hang off the IR events list: asked for only when that list exists or is still to come
  const events = stored.has(fileKey('fiscal-ai', 'events/ir-events', ticker)) || fiscal.includes('events/ir-events');
  const transcripts = (known || profile) && events && !settled('fiscal-ai', 'events/transcript');
  const eod = PHASE_A_EOD_CAPABILITIES.filter((cap) => !settled('eodhd', cap));
  const legion = !settled('datalegion', 'companies/enrich-premium');
  const benzinga = PHASE_A_BENZINGA_CAPABILITIES.filter((cap) => !settled('benzinga', cap));
  const done = !profile && !fiscal.length && !transcripts && !eod.length && !legion && !benzinga.length;
  return { profile, fiscal, transcripts, eod, legion, benzinga, done };
}

/** Counts over the whole universe, for the plan report and the progress row. */
export function phaseASummary(tickers: readonly string[], stored: ReadonlySet<string>, answers: ReadonlyMap<string, Answer>, now: number) {
  const missing: Record<string, number> = {};
  let done = 0;
  const add = (k: string) => (missing[k] = (missing[k] ?? 0) + 1);
  for (const t of tickers) {
    const todo = phaseATodo(t, stored, answers, now);
    if (todo.done) { done++; continue; }
    if (todo.profile) add('fiscal-ai/company/profile');
    for (const c of todo.fiscal) add(`fiscal-ai/${c}`);
    if (todo.transcripts) add('fiscal-ai/events/transcript');
    for (const c of todo.eod) add(`eodhd/${c}`);
    if (todo.legion) add('datalegion/companies/enrich-premium');
    for (const c of todo.benzinga) add(`benzinga/${c}`);
  }
  return { companies: tickers.length, done, open: tickers.length - done, missing };
}

/**
 * A local checkpoint (one provider response kept on the worker's disk) as text, or null when the
 * file is not whole. A checkpoint cut off while it was written (the worker was stopped mid-write)
 * ends before its closing brace: reading one of these with JSON.parse ended the clean-up step after
 * Phase A on every pass, so Phases B and C never started.
 */
export function parseCheckpoint(text: string): Json | null {
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

/** Whether a checkpoint's first bytes say it is a page of `provider`/`capability` (it is written with those two keys first). */
export function checkpointIs(head: string, provider: string, capability: string): boolean {
  return head.includes(`"provider":${JSON.stringify(provider)}`) && head.includes(`"capability":${JSON.stringify(capability)}`);
}

/**
 * After a whole pass (Phases A, B, C and both clean-ups ended without a stop) the collector rests:
 * the worker restarts it thirty seconds after it exits, and a pass that finds nothing new would
 * otherwise repeat for ever. A week matches the withdrawal clean-up; "not there" answers are asked
 * again after thirty days, within a later pass.
 */
export const PASS_REST_MS = 7 * 86_400_000;
/** Milliseconds the collector still has to rest at `now`; 0 when no pass finished or the rest is over. */
export function passRestLeft(lastFinishedAt: string | null | undefined, now: number): number {
  const at = lastFinishedAt ? Date.parse(lastFinishedAt) : NaN;
  if (!Number.isFinite(at) || at > now) return 0;
  return Math.max(0, at + PASS_REST_MS - now);
}
