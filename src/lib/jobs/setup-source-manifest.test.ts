import { describe, expect, it, vi } from 'vitest';
import { replayJson, retainReplaySources, setupSourceManifest } from '../../../scripts/lib/setup-source-manifest';
import type { SetupSourceObject } from '../../../scripts/lib/setup-source-pack';

const capture = (n: number) => replayJson<{n: number}>(Buffer.from(`{"n":${n}}`));
const store = { ensure: async (bytes: Uint8Array | string, sha256: string): Promise<SetupSourceObject> => ({
  sha256, bytes: Buffer.byteLength(bytes), compressedBytes: 27, compression: 'gzip', bucket: 'datasets', path: `ops/setup-replay/sha256/${sha256.slice(0,2)}/${sha256}.json.gz`,
}) };

describe('verified replay source manifests', () => {
  it('links exactly the bytes used without embedding original payloads in a receipt', async () => {
    const prices = capture(1), benchmark = capture(2), inputs = capture(3);
    const lease = vi.fn(async () => {});
    const refs = await retainReplaySources(store, lease, prices, benchmark, inputs);
    const reconstructed = { ...refs.prices, bytes: 'raw bytes must never be serialized' };
    const manifest = setupSourceManifest({ ...refs, prices: reconstructed, ticker: 'JPM', asOf: '2026-11-25', scoredAt: prices.readAt,
      capturedBy: 'a'.repeat(40), originalCommit: null, receipt: { filingCutoff: 'next-session-v1' },
      window: { first: '2016-11-01', officialFrom: '2026-09-24' }, pricesPath: 'prices/JPM.json', pricesFetchedAt: prices.readAt });
    expect(lease).toHaveBeenCalledTimes(2);
    expect(manifest.prices.object.sha256).toBe(prices.hash);
    expect(manifest.benchmark.object.sha256).toBe(benchmark.hash);
    expect(manifest.inputs.object.sha256).toBe(inputs.hash);
    expect(manifest.method.scoringCommit).toBeNull();
    expect(JSON.stringify(manifest)).not.toContain(reconstructed.bytes);
  });
  it('does not return a manifest if ownership is lost before writes or before the final commit', async () => {
    const checked = vi.fn(store.ensure), c = capture(1);
    const lost = async () => { throw new Error('lease lost'); };
    await expect(retainReplaySources({ ensure: checked }, lost, c, c, c)).rejects.toThrow('lease lost');
    expect(checked).not.toHaveBeenCalled();
    const race = vi.fn().mockResolvedValueOnce(undefined).mockImplementationOnce(lost);
    await expect(retainReplaySources({ ensure: checked }, race, c, c, c)).rejects.toThrow('lease lost');
    expect(checked).toHaveBeenCalledTimes(3);
  });
});
