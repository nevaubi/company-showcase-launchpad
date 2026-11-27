import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { runSetupPackRecovery, type SetupPackRecoveryOptions } from '../../../scripts/lib/setup-pack-recovery';
import { setupSourcePath, type SetupSourceObject } from '../../../scripts/lib/setup-source-pack';

const digest = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const days = Array.from({ length: 420 }, (_, i) => new Date(Date.UTC(2025, 0, i + 1)).toISOString().slice(0, 10));
const prices = Buffer.from('{"symbol":"JPM","bars":[]}');
const benchmark = Buffer.from(JSON.stringify({ dates: days, o: { SPY: days.map(() => 100) }, c: { SPY: days.map(() => 101) }, vix3m: days.map(() => null) }));
const oldBar = { date: days.at(-1)!, open: 11, high: 12, low: 10, close: 11, adj_close: 11, volume: 2000 };
const oldInputs = { earnings: [], short: [], official: [oldBar], buys: [], fails: [] };
const newInputs = { ...oldInputs, official: [{ ...oldBar, updated_at: '2026-11-26T03:00:00Z' }] };
const dated = Buffer.from(JSON.stringify(oldInputs));
const originalReceipt = { asOf: days.at(-1), samples: 31, pricesSha256: digest(prices), benchSha256: digest(benchmark), eventsAndOfficialBarsSha256: digest(dated) };

type Row = { ticker: string; receipt: Record<string, unknown>; as_of: string; completed_at: string; token: string|null; lease_until: string|null; retry_at: string|null };

function scenario() {
  const row: Row = { ticker: 'JPM', receipt: { ...originalReceipt }, as_of: days.at(-1)!, completed_at: '2026-11-27T10:25:00Z', token: null, lease_until: null, retry_at: null };
  const queries: string[] = [];
  const reply = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  const db = createClient('https://example.invalid', 'local-test-key', { auth: { persistSession: false }, global: { fetch: async (request, init) => {
    const u = new URL(String(request));
    const q = u.searchParams;
    expect(u.pathname).toBe('/rest/v1/setup_replay_work');
    queries.push(`${init?.method} ${q}`);
    const filtersMatch = (!q.has('token') || q.get('token') === 'eq.' + row.token) &&
      (!q.get('completed_at')?.startsWith('eq.') || q.get('completed_at') === 'eq.' + row.completed_at) &&
      (!q.has('lease_until') || (q.get('lease_until') === 'gt.now' && Date.parse(row.lease_until ?? '') > Date.now()));
    if (q.has('receipt->sourcePack') && (row.receipt.sourcePack || row.receipt.sourcePackRecovery ||
      row.token && Date.parse(row.lease_until ?? '') > Date.now() || Date.parse(row.retry_at ?? '') > Date.now())) return reply([]);
    if (!filtersMatch) return reply([]);
    if (init?.method === 'PATCH') Object.assign(row, JSON.parse(String(init.body)));
    return reply([{ ...row }]);
  } } });
  const blobs = new Map<string, Buffer>();
  const descriptor = (bytes: Buffer): SetupSourceObject => ({ bucket: 'datasets', path: setupSourcePath(digest(bytes)), sha256: digest(bytes), bytes: bytes.length, compressedBytes: 123, compression: 'gzip' });
  const ensure = vi.fn<SetupPackRecoveryOptions['store']['ensure']>(async (bytes, sha, options) => {
    await options?.beforeWrite?.();
    const b = Buffer.from(bytes);
    expect(digest(b)).toBe(sha);
    blobs.set(sha, b);
    return descriptor(b);
  });
  const deps: SetupPackRecoveryOptions = {
    db, store: { read: async sha => { const b = blobs.get(sha); return b ? { bytes: b, object: descriptor(b) } : null; }, ensure },
    readDataset: vi.fn(async path => path === 'setups/bench.json' ? benchmark : prices), readInputs: vi.fn(async () => newInputs),
    buildManifest: x => ({ bench: x.benchmark.object.sha256, prices: x.prices.object.sha256, inputs: x.inputs.object.sha256,
      originalCommit: null, scoredAt: x.scoredAt, priceOrigin: x.prices.readFrom }),
  };
  return { deps, row, queries, ensure, blobs, descriptor };
}

describe('completed replay source recovery', () => {
  it('uses an already archived original price and reconstructs timestamp-free dated input bytes only on an exact digest match', async () => {
    const f = scenario();
    f.blobs.set(digest(prices), prices);
    f.row.as_of = '2026-12-01'; // A superseding scoring attempt advanced this mutable queue field.
    const result = await runSetupPackRecovery(f.deps, 1);
    expect(result.recovered).toEqual(1);
    expect(f.deps.readDataset).toHaveBeenCalledTimes(1);
    expect(f.deps.readInputs).toHaveBeenCalledWith('JPM', days[0], days.at(-45), days.at(-1), expect.anything());
    expect(f.row.as_of).toBe('2026-12-01');
    expect(f.blobs.get(digest(dated))).toEqual(dated);
    expect(f.row.receipt).toMatchObject({ ...originalReceipt, sourcePack: { inputs: digest(dated), priceOrigin: 'archive', originalCommit: null, scoredAt: f.row.completed_at } });
    expect(f.row.token).toBeNull();
    expect((await runSetupPackRecovery(f.deps, 1)).examined).toBe(0);
    expect(f.ensure).toHaveBeenCalledTimes(2);
  });

  it('records changed input watermarks without writing even a previously matched blob or modifying evidence', async () => {
    const f = scenario();
    const replacement = Buffer.from('{"new":true}');
    f.deps.readDataset = async path => path === 'setups/bench.json' ? benchmark : replacement;
    expect((await runSetupPackRecovery(f.deps, 1)).mismatched).toBe(1);
    expect(f.ensure).not.toHaveBeenCalled();
    expect(f.deps.readInputs).not.toHaveBeenCalled();
    expect(f.row.receipt).toMatchObject({ ...originalReceipt, sourcePackRecovery: { status: 'source-vintage-mismatch', component: 'prices',
      expectedSha256: digest(prices), observedSha256: digest(replacement), scoredAt: f.row.completed_at } });
    expect((await runSetupPackRecovery(f.deps, 2)).examined).toBe(0);
  });

  it('retries a read outage without conflating it with a different source vintage', async () => {
    const f = scenario();
    f.deps.readInputs = vi.fn().mockRejectedValueOnce(new Error('temporarily unavailable')).mockResolvedValueOnce(newInputs);
    expect((await runSetupPackRecovery(f.deps, 1)).errors[0]).toContain('temporarily unavailable');
    expect(f.row.receipt).toEqual(originalReceipt);
    expect(f.row.token).toBeNull();
    expect(Date.parse(f.row.retry_at!)).toBeGreaterThan(Date.now());
    expect((await runSetupPackRecovery(f.deps, 1)).examined).toBe(0);
    f.row.retry_at = null;
    expect((await runSetupPackRecovery(f.deps, 1)).recovered).toBe(1);
  });

  it('cannot finish or release another owner’s work when ownership changes during storage I/O', async () => {
    const f = scenario();
    f.ensure.mockImplementationOnce(async (raw, _sha, opts) => {
      await opts?.beforeWrite?.();
      f.row.token = 'replacement';
      return f.descriptor(Buffer.from(raw));
    });
    expect((await runSetupPackRecovery(f.deps, 1)).lost).toBe(1);
    expect(f.row.token).toBe('replacement');
    expect(f.row.receipt).toEqual(originalReceipt);
  });

  it('stops a slow source read at the worker deadline and never writes after abort', async () => {
    const f = scenario();
    const ctrl = new AbortController();
    f.deps.signal = () => ctrl.signal;
    f.deps.readDataset = async () => { ctrl.abort(new Error('test deadline')); return benchmark; };
    const result = await runSetupPackRecovery(f.deps, 1);
    expect(result.errors[0]).toContain('test deadline');
    expect(f.ensure).not.toHaveBeenCalled();
    expect(f.row.receipt).toEqual(originalReceipt);
  });
});
