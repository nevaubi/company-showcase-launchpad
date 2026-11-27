import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BenchFile } from '../../src/lib/signals/context';
import { receiptText } from './run-receipt';
import { replayCalendar, type ReplayInputs } from './setup-replay';
import type { SetupSourceObject, SetupSourceStore } from './setup-source-pack';

interface ScoredReceipt extends Record<string, unknown> {
  asOf?: string;
  pricesSha256?: string;
  benchSha256?: string;
  eventsAndOfficialBarsSha256?: string;
}
interface WorkRow {
  ticker: string;
  completed_at: string;
  receipt: ScoredReceipt;
}
interface SourceBytes {
  bytes: Buffer;
  readAt: string;
  readFrom: 'native' | 'archive';
  object?: SetupSourceObject;
}
type VerifiedPart = SourceBytes & { object: SetupSourceObject };
export interface RecoveredManifestInputs {
  ticker: string;
  asOf: string;
  scoredAt: string;
  receipt: ScoredReceipt;
  window: { first: string; officialFrom: string };
  prices: VerifiedPart;
  benchmark: VerifiedPart;
  inputs: VerifiedPart;
}
export interface SetupPackRecoveryOptions {
  db: SupabaseClient;
  store: SetupSourceStore;
  readDataset(path: string, signal: AbortSignal): Promise<Uint8Array>;
  readInputs(ticker: string, first: string, officialFrom: string, asOf: string, signal: AbortSignal): Promise<ReplayInputs>;
  buildManifest(inputs: RecoveredManifestInputs): Record<string, unknown>;
  mayContinue?: () => boolean;
  signal?: () => AbortSignal;
}

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const validDigest = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const now = () => new Date().toISOString();
const leaseFilter = 'token.is.null,lease_until.lte.now';
const dueFilter = 'retry_at.is.null,retry_at.lte.now';

class ReceiptUnavailable extends Error {
  constructor(readonly detail: Record<string, unknown>) { super(String(detail.status)); }
}
class LeaseLost extends Error {}

/** Some storage clients do not expose an abortable request. A late read must never trigger a write. */
function readBeforeDeadline<T>(request: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const stop = () => reject(signal.reason);
    if (signal.aborted) stop();
    else signal.addEventListener('abort', stop, { once: true });
    request.then(v => { signal.removeEventListener('abort', stop); resolve(v); }, e => { signal.removeEventListener('abort', stop); reject(e); });
  });
}

/** Migration 0082 added updated_at to official bars. Only the exact old serialization can recover that receipt. */
function datedBytes(payload: ReplayInputs, expected: string): Buffer {
  const current = Buffer.from(JSON.stringify(payload));
  if (hash(current) === expected || !payload.official.some(b => 'updated_at' in b)) return current;
  const legacy = Buffer.from(JSON.stringify({ ...payload, official: payload.official.map(({ updated_at: _stamp, ...bar }) => bar) }));
  return hash(legacy) === expected ? legacy : current;
}

async function matchSource(name: string, expected: string, store: SetupSourceStore, nativeRead: () => Promise<Uint8Array>, signal: AbortSignal): Promise<SourceBytes> {
  signal.throwIfAborted();
  const archived = await readBeforeDeadline(store.read(expected), signal);
  if (archived) return { ...archived, readAt: now(), readFrom: 'archive' };
  const bytes = Buffer.from(await readBeforeDeadline(nativeRead(), signal));
  const observed = hash(bytes);
  if (expected !== observed) throw new ReceiptUnavailable({ status: 'source-vintage-mismatch', component: name, expectedSha256: expected, observedSha256: observed });
  return { bytes, readAt: now(), readFrom: 'native' };
}

/** At most one batch of completed receipts. Recovery never updates samples, scan markers or the scoring timestamp. */
export async function runSetupPackRecovery(deps: SetupPackRecoveryOptions, limit = 2) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 12) throw new Error('Source pack recovery limit must be between 1 and 12');
  const count = { examined: 0, recovered: 0, mismatched: 0, unavailable: 0, lost: 0, errors: [] as string[] };
  if (deps.mayContinue?.() === false) return count;
  const parentSignal = deps.signal?.();
  const cap = AbortSignal.timeout(90_000);
  const signal = parentSignal ? AbortSignal.any([cap, parentSignal]) : cap;
  const work = () => deps.db.from('setup_replay_work');
  const candidates = await work().select('ticker,completed_at').not('completed_at', 'is', null)
    .is('receipt->sourcePack', null).is('receipt->sourcePackRecovery', null).or(leaseFilter).or(dueFilter)
    .order('completed_at').order('ticker').limit(limit).abortSignal(signal).throwOnError();
  let previousBench: { digest: string; source: SourceBytes } | undefined;
  for (const candidate of candidates.data) {
    if (signal.aborted || deps.mayContinue?.() === false) break;
    const token = randomUUID();
    const claimed = await work().update({ token, lease_until: new Date(Date.now() + 180_000).toISOString() })
      .eq('ticker', candidate.ticker).eq('completed_at', candidate.completed_at).is('receipt->sourcePack', null)
      .is('receipt->sourcePackRecovery', null).or(leaseFilter).or(dueFilter).select('ticker,completed_at,receipt')
      .abortSignal(signal).throwOnError();
    const row = claimed.data[0] as WorkRow | undefined;
    if (!row) continue;
    count.examined++;
    const owned = { ticker: row.ticker, completed_at: row.completed_at, token };
    const checkLease = async () => {
      signal.throwIfAborted();
      const result = await work().select('ticker').match(owned).gt('lease_until', 'now').abortSignal(signal).throwOnError();
      if (!result.data.length) throw new LeaseLost();
    };
    const finish = async (metadata: Record<string, unknown>) => {
      const result = await work().update({ token: null, lease_until: null, retry_at: null, receipt: { ...row.receipt, ...metadata } })
        .match(owned).gt('lease_until', 'now').select('ticker').abortSignal(signal).throwOnError();
      return result.data.length === 1;
    };
    try {
      const priceSha = row.receipt?.pricesSha256, benchSha = row.receipt?.benchSha256, inputSha = row.receipt?.eventsAndOfficialBarsSha256;
      if (!validDigest(priceSha) || !validDigest(benchSha) || !validDigest(inputSha)) {
        throw new ReceiptUnavailable({ status: 'missing-original-digest' });
      }
      // A later scoring claim can replace the queue's as_of while its previous completed receipt is retained.
      const asOf = row.receipt.asOf;
      if (typeof asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new ReceiptUnavailable({ status: 'missing-original-cutoff' });
      const bench = previousBench?.digest === benchSha ? previousBench.source : await matchSource('benchmark', benchSha, deps.store, () => deps.readDataset('setups/bench.json', signal), signal);
      previousBench = { digest: benchSha, source: bench };
      const { first, officialFrom } = replayCalendar(JSON.parse(bench.bytes.toString('utf8')) as BenchFile, asOf);
      // Derive the allowlisted native path from the registry ticker, never from an arbitrary historical receipt field.
      const pricePath = `prices/${row.ticker.replace(/\^/g, 'IDX_').replace(/[^A-Za-z0-9_.-]/g, '_')}.json`;
      const price = await matchSource('prices', priceSha, deps.store, () => deps.readDataset(pricePath, signal), signal);
      const inputs = await matchSource('datedInputs', inputSha, deps.store, async () => datedBytes(
        await deps.readInputs(row.ticker, first, officialFrom, asOf, signal), inputSha), signal);
      await checkLease();
      // Defer all missing blobs until the entire historical input set has been proved recoverable.
      const ensure = async (part: SourceBytes, digest: string, shared = false): Promise<VerifiedPart> => ({ ...part,
        object: part.object ?? await readBeforeDeadline(deps.store.ensure(part.bytes, digest, { shared, beforeWrite: checkLease }), signal) });
      const manifest = deps.buildManifest({ ticker: row.ticker, asOf, scoredAt: row.completed_at, receipt: row.receipt, window: { first, officialFrom },
        benchmark: await ensure(bench, benchSha, true), prices: await ensure(price, priceSha), inputs: await ensure(inputs, inputSha) });
      if (await finish({ sourcePack: manifest })) count.recovered++;
      else count.lost++;
    } catch (error) {
      if (error instanceof ReceiptUnavailable) {
        if (await finish({ sourcePackRecovery: { ...error.detail, scoredAt: row.completed_at, checkedAt: now() } })) {
          if (error.detail.status === 'source-vintage-mismatch') count.mismatched++;
          else count.unavailable++;
        } else count.lost++;
      } else if (error instanceof LeaseLost) count.lost++;
      else {
        count.errors.push(`${row.ticker}: ${receiptText(error instanceof Error ? error.message : (error as {message?: string})?.message ?? error)}`);
        if (!signal.aborted) await work().update({ token: null, lease_until: null, retry_at: new Date(Date.now() + 600_000).toISOString() })
          .match(owned).gt('lease_until', 'now').abortSignal(signal).throwOnError();
      }
    }
  }
  return count;
}
