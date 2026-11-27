import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readSetupSourceBody, type SetupSourceObject } from './setup-source-pack';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export function replayEngineCommit(env = process.env): string | null {
  if (/^[a-f\d]{40}$/i.test(env.RENDER_GIT_COMMIT ?? '')) return env.RENDER_GIT_COMMIT!;
  try {
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 1500, stdio: ['ignore','pipe','ignore'] }).trim();
    return /^[a-f\d]{40}$/i.test(revision) ? revision : null;
  } catch { return null; }
}

export interface ReplayDatasetBody {
  download(path: string, options: {}, request: { signal: AbortSignal }): {
    asStream(): PromiseLike<{data: ReadableStream<Uint8Array> | null; error: {message: string} | null}>;
  };
}

export async function nativeReplayBytes(bucket: ReplayDatasetBody, path: string, signal = AbortSignal.timeout(20_000)) {
  const { data, error } = await bucket.download(path, {}, { signal }).asStream();
  if (error || !data) throw new Error(`${path}: ${error?.message ?? 'missing object'}`);
  const bytes = await readSetupSourceBody(data);
  if (!bytes.length) throw new Error(`Empty replay source ${path}`);
  return bytes;
}

export function replayJson<T>(bytes: Buffer) {
  return { file: JSON.parse(bytes.toString('utf8')) as T, bytes, hash: hash(bytes), readAt: new Date().toISOString() };
}

type Part = { object: SetupSourceObject; readAt: string; readFrom: 'native' | 'archive' };
export interface ManifestParts {
  ticker: string; asOf: string; scoredAt: string; capturedBy: string; originalCommit: string | null;
  receipt: Record<string, unknown>; window: {first: string; officialFrom: string};
  prices: Part; pricesPath: string; pricesFetchedAt?: string; benchmark: Part; benchGeneratedAt?: string;
  inputs: Part; marketBarsUpdatedThrough?: string | null;
}

/** The source byte hashes describe raw UTF-8 JSON. The receipt is linked only after all three archived objects verify. */
export function setupSourceManifest(m: ManifestParts) {
  const reference = ({ object, readAt, readFrom }: Part) => ({ object, readAt, readFrom });
  return { schema: 1, ticker: m.ticker, asOf: m.asOf, scoredAt: m.scoredAt, archivedAt: new Date().toISOString(),
    method: { executionVersion: 2, filingCutoff: m.receipt.filingCutoff ?? null, adjustmentReview: m.receipt.adjustmentReview ?? null,
      liquidityBasis: 'adjusted-close-times-reported-volume', scoringCommit: m.originalCommit, archiveCommit: m.capturedBy },
    prices: { ...reference(m.prices), origin: m.pricesPath, providerFetchedAt: m.pricesFetchedAt ?? null },
    benchmark: { ...reference(m.benchmark), origin: 'setups/bench.json', providerGeneratedAt: m.benchGeneratedAt ?? null },
    inputs: { ...reference(m.inputs), origin: 'public.setup_replay_inputs_v2', first: m.window.first, officialFrom: m.window.officialFrom,
      marketBarsUpdatedThrough: m.marketBarsUpdatedThrough ?? null },
  };
}

export function latestOfficialUpdate(rows: {updated_at?: string}[]): string | null {
  let last = 0;
  for (const row of rows) if (row.updated_at) {
    const at = Date.parse(row.updated_at);
    if (Number.isFinite(at) && at > last) last = at;
  }
  return last ? new Date(last).toISOString() : null;
}

type SourceStore = { ensure(bytes: Uint8Array | string, sha: string, options?: { shared?: boolean; beforeWrite?: () => Promise<void> }): Promise<SetupSourceObject> };
type Capture = { bytes: Buffer; hash: string; readAt: string };

export async function retainReplaySources(store: SourceStore, beforeWrite: () => Promise<void>,
  prices: Capture, bench: Capture, inputs: Capture) {
  await beforeWrite();
  const part = async (c: Capture, shared = false): Promise<Part> => ({
    object: await store.ensure(c.bytes, c.hash, { shared, beforeWrite }), readAt: c.readAt, readFrom: 'native',
  });
  // The storage worker has one active compressed object per issuer. The benchmark is verified once per process.
  const benchmark = await part(bench, true);
  const priceObject = await part(prices);
  const inputObject = await part(inputs);
  await beforeWrite();
  return { prices: priceObject, benchmark, inputs: inputObject };
}
