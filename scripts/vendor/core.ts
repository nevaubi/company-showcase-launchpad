import { createHash } from 'node:crypto';

export type Json = Record<string, any>;
export const MAX_IN_FLIGHT = 4;
export const MAX_ATTEMPTS = 3;
export const PHASE_B_CALL_LIMIT = 2000;
export const CREDIT_PROBE_MS = 30 * 60 * 1000;
export const PROVIDER_PENDING_MS = 10 * 60 * 1000;
export const PROGRESS_COMPANIES = 50;
export const PHASE_A_CREDIT_LIMIT = 1500;
export function phaseACanCall(spent: number, reserved: number) {
  return spent + reserved <= PHASE_A_CREDIT_LIMIT;
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
export function legionIdentifiers(domain: string | undefined, legal: string | undefined, linkedin: string | undefined): Json[] {
  const options: Json[] = [];
  if (domain) options.push({domain, min_confidence:'high'});
  if (linkedin && /^https:\/\/(www\.)?linkedin\.com\/company\//i.test(linkedin)) options.push({social_url:linkedin, min_confidence:'high'});
  if (legal && domain) options.push({name:legal, domain, min_confidence:'high'});
  return options;
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
