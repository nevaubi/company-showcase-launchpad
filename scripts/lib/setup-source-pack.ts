import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

// Largest observed replay component is the ~550 KiB benchmark. Keep source validation bounded
// even when a provider or a stored object is malformed. Gzip adds a small overhead to random input.
export const MAX_REPLAY_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_GZIP_BYTES = MAX_REPLAY_SOURCE_BYTES + 64 * 1024;

export type SetupSourceObject = {
  bucket: 'datasets'; path: string; sha256: string; bytes: number; compressedBytes: number; compression: 'gzip';
};

type StorageError = { message: string; status?: number; statusCode?: string; code?: string };
interface SourceBucket {
  download(path: string, options: {}, request: { signal: AbortSignal }): {
    asStream(): PromiseLike<{ data: ReadableStream<Uint8Array> | null; error: StorageError | null }>;
  };
  upload(path: string, body: Uint8Array, options: { contentType: string; upsert: false }): PromiseLike<{ error: StorageError | null }>;
}

type WriteOptions = { shared?: boolean; beforeWrite?: () => Promise<void> };
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export function setupSourcePath(sha256: string) {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('Invalid replay source SHA-256');
  return `ops/setup-replay/sha256/${sha256.slice(0, 2)}/${sha256}.json.gz`;
}

function missing(e: StorageError) {
  return e.code === 'NoSuchKey' || e.code === 'ObjectNotFound' ||
    ((e.status === 404 || e.statusCode === '404' || e.status === 400 || e.statusCode === '400') && /^(?:the )?(?:requested )?(?:object|resource) (?:was )?not found\.?$/i.test(e.message));
}

function duplicate(e: StorageError) {
  return e.status === 409 || e.statusCode === '409' || e.code === 'ResourceAlreadyExists' ||
    /^(?:duplicate|(?:the )?resource already exists|(?:the )?object already exists)\.?$/i.test(e.message);
}

async function boundedBody(stream: ReadableStream<Uint8Array>, limit: number) {
  const reader = stream.getReader();
  let buffer = Buffer.allocUnsafe(Math.min(64 * 1024, limit));
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const required = length + value.byteLength;
      if (required > limit) {
        await reader.cancel();
        throw new Error('Replay source download exceeds byte limit');
      }
      if (required > buffer.length) {
        const larger = Buffer.allocUnsafe(Math.min(limit, Math.max(required, 2 * buffer.length)));
        buffer.copy(larger, 0, 0, length);
        buffer = larger;
      }
      buffer.set(value, length);
      length = required;
    }
    return buffer.subarray(0, length);
  } finally { reader.releaseLock(); }
}

/** Read a native price or benchmark object before parsing; cap the wire body as it arrives. */
export const readSetupSourceBody = (stream: ReadableStream<Uint8Array>) => boundedBody(stream, MAX_REPLAY_SOURCE_BYTES);

/** Use the native, service-role `datasets` bucket. Each returned descriptor has been read back. */
export function createSetupSourceStore(bucket: SourceBucket) {
  let shared: { sha256: string; pending: Promise<SetupSourceObject> } | undefined;

  async function read(sha256: string): Promise<{ object: SetupSourceObject; bytes: Buffer } | null> {
    const path = setupSourcePath(sha256);
    const { data, error } = await bucket.download(path, {}, { signal: AbortSignal.timeout(20_000) }).asStream();
    if (error) {
      if (missing(error)) return null;
      throw new Error(`Replay source read failed (${error.code ?? error.status ?? error.statusCode ?? error.message})`);
    }
    if (!data) throw new Error('Replay source storage returned no response body');
    const compressed = await boundedBody(data, MAX_GZIP_BYTES);
    const bytes = gunzipSync(compressed, { maxOutputLength: MAX_REPLAY_SOURCE_BYTES });
    if (digest(bytes) !== sha256) throw new Error('Stored replay source SHA-256 mismatch');
    const object: SetupSourceObject = { bucket: 'datasets', path, sha256, bytes: bytes.length, compressedBytes: compressed.length, compression: 'gzip' };
    return { object, bytes };
  }

  async function ensure(input: Uint8Array | string, sha256: string, options: WriteOptions = {}): Promise<SetupSourceObject> {
    const path = setupSourcePath(sha256);
    const length = typeof input === 'string' ? Buffer.byteLength(input) : input.byteLength;
    if (length > MAX_REPLAY_SOURCE_BYTES) throw new Error('Replay source exceeds byte limit');
    const bytes = typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input);
    if (digest(bytes) !== sha256) throw new Error('Replay source SHA-256 differs from receipt');
    if (options.shared && shared?.sha256 === sha256) return shared.pending;

    async function store() {
      const previous = await read(sha256);
      if (previous) {
        if (previous.bytes.length !== length) throw new Error('Stored replay source byte count mismatch');
        return previous.object;
      }
      const compressed = gzipSync(bytes, { level: 6 });
      await options.beforeWrite?.();
      let uncertain: Error | undefined;
      try {
        const { error } = await bucket.upload(path, compressed, { contentType: 'application/gzip', upsert: false });
        if (error && !duplicate(error)) {
          const status = Number(error.status ?? error.statusCode);
          const failure = new Error(`Replay source upload failed (${error.code ?? error.status ?? error.statusCode ?? error.message})`);
          if (status >= 400 && status < 500 && status !== 408 && status !== 429) throw failure;
          uncertain = failure;
        }
      } catch (error) {
        if (!(error instanceof TypeError) && !(error instanceof Error && /^(TimeoutError|AbortError)$/.test(error.name))) throw error;
        uncertain = error;
      }
      // A timeout or lost response may have followed a committed write. Verify at its one
      // immutable key before deferring; a retry can independently discover the object there.
      const verified = await read(sha256);
      if (!verified) throw uncertain ?? new Error('Replay source write could not be verified');
      if (verified.bytes.length !== length) throw new Error('Stored replay source byte count mismatch');
      return verified.object;
    }
    const pending = store();
    if (options.shared) shared = { sha256, pending };
    try { return await pending; }
    catch (error) {
      if (shared?.pending === pending) shared = undefined;
      throw error;
    }
  }
  return { read, ensure };
}
export type SetupSourceStore = ReturnType<typeof createSetupSourceStore>;
