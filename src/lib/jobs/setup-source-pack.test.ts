import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { createSetupSourceStore, MAX_REPLAY_SOURCE_BYTES, readSetupSourceBody, setupSourcePath } from '../../../scripts/lib/setup-source-pack';

const original = Buffer.from('{"ticker":"JPM","name":"Société"}\n');
const sha = (body: Uint8Array) => createHash('sha256').update(body).digest('hex');
const expected = sha(original);
const path = setupSourcePath(expected);
const missing = { message: 'Object not found', status: 400, statusCode: '404' };
const busy = { message: 'Unavailable', status: 503 };

function storage() {
  const objects = new Map<string, Uint8Array>();
  const download = vi.fn((key: string) => ({ asStream: async () => {
    const bytes = objects.get(key);
    if (!bytes) return { error: missing, data: null };
    return { error: null, data: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } }) };
  } }));
  const upload = vi.fn(async (key: string, body: Uint8Array, options: { upsert: false; contentType: string }) => {
    expect(options).toEqual({ upsert: false, contentType: 'application/gzip' });
    if (objects.has(key)) return { error: { message: 'Resource already exists', status: 409 } };
    objects.set(key, Buffer.from(body));
    return { error: null };
  });
  return { download, upload, objects };
}

describe('private replay source objects', () => {
  it('records the byte-exact UTF-8 object, verifies remote contents, and reuses a prior capture', async () => {
    const bucket = storage(), store = createSetupSourceStore(bucket);
    expect(await store.read(expected)).toBeNull();
    const first = await store.ensure(original.toString(), expected);
    expect(first).toEqual({ bucket: 'datasets', path, sha256: expected, bytes: original.byteLength, compressedBytes: bucket.objects.get(path)!.byteLength, compression: 'gzip' });
    expect(path).toBe(`ops/setup-replay/sha256/${expected.slice(0, 2)}/${expected}.json.gz`);
    expect(gunzipSync(bucket.objects.get(path)!)).toEqual(original);
    expect((await store.read(expected))?.bytes).toEqual(original);
    expect(await createSetupSourceStore(bucket).ensure(original, expected)).toEqual(first);
    expect(bucket.upload).toHaveBeenCalledTimes(1);
    const secondBucket = storage();
    await createSetupSourceStore(secondBucket).ensure(original, expected);
    expect(secondBucket.objects.get(path)).toEqual(bucket.objects.get(path));
  });

  it('coalesces benchmark requests within a batch and verifies a simultaneous writer from another batch', async () => {
    const bucket = storage(), store = createSetupSourceStore(bucket);
    const [a,b,c] = await Promise.all([store.ensure(original, expected, { shared: true }), store.ensure(original, expected, { shared: true }), createSetupSourceStore(bucket).ensure(original, expected)]);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(bucket.upload).toHaveBeenCalledTimes(2);
    expect(bucket.objects.size).toBe(1);
    const reads = bucket.download.mock.calls.length;
    await store.ensure(original, expected, { shared: true });
    expect(bucket.download).toHaveBeenCalledTimes(reads);
  });

  it('reuses the committed digest after upload succeeds but the readback is temporarily unavailable', async () => {
    const bucket = storage(), store = createSetupSourceStore(bucket);
    bucket.upload.mockImplementationOnce(async (key, bytes) => {
      bucket.objects.set(key, Buffer.from(bytes));
      bucket.download.mockImplementationOnce(() => ({ asStream: async () => ({ data: null, error: { ...busy, statusCode: '503' } }) }));
      return { error: null };
    });
    await expect(store.ensure(original, expected, { shared: true })).rejects.toThrow('503');
    expect((await store.ensure(original, expected, { shared: true })).sha256).toBe(expected);
    expect(bucket.upload).toHaveBeenCalledTimes(1);
  });

  it('recovers a write when its acknowledgement was lost without posting it twice', async () => {
    const bucket = storage(), store = createSetupSourceStore(bucket);
    bucket.upload.mockImplementationOnce(async (key, body) => {
      bucket.objects.set(key, Buffer.from(body));
      throw new TypeError('fetch failed');
    });
    expect((await store.ensure(original, expected)).sha256).toBe(expected);
    expect(bucket.upload).toHaveBeenCalledTimes(1);
    const missingWrite = storage();
    missingWrite.upload.mockResolvedValueOnce({ error: busy });
    await expect(createSetupSourceStore(missingWrite).ensure(original, expected)).rejects.toThrow('503');
    expect(missingWrite.objects.size).toBe(0);
  });

  it('refuses to overwrite digest collisions, corrupt data, or unreadable storage', async () => {
    const bucket = storage(), store = createSetupSourceStore(bucket);
    bucket.objects.set(path, gzipSync('different'));
    await expect(store.ensure(original, expected)).rejects.toThrow('SHA-256 mismatch');
    bucket.objects.set(path, Buffer.from('bad gzip'));
    await expect(store.read(expected)).rejects.toThrow();
    bucket.download.mockImplementationOnce(() => ({ asStream: async () => ({ data: null, error: { message: 'Access denied', status: 403, statusCode: '403' } }) }));
    await expect(store.ensure(original, expected)).rejects.toThrow('403');
    await expect(store.ensure('wrong', expected)).rejects.toThrow('differs from receipt');
    await expect(store.read('../invalid')).rejects.toThrow('SHA-256');
    expect(bucket.upload).not.toHaveBeenCalled();
  });

  it('checks ownership before creating an object and permits the next valid owner to retry', async () => {
    const bucket = storage(), store = createSetupSourceStore(bucket);
    await expect(store.ensure(original, expected, { shared: true, beforeWrite: async () => { throw new Error('lost lease'); } })).rejects.toThrow('lost lease');
    expect(bucket.objects.size).toBe(0);
    expect((await store.ensure(original, expected, { shared: true })).sha256).toBe(expected);
  });

  it('limits native source bytes, compressed transport, and decompressed output', async () => {
    const storeBucket = storage(), store = createSetupSourceStore(storeBucket);
    const tooLong = Buffer.alloc(MAX_REPLAY_SOURCE_BYTES + 1);
    await expect(store.ensure(tooLong, expected)).rejects.toThrow('byte limit');
    const cancelled = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(tooLong); }, cancel: cancelled });
    await expect(readSetupSourceBody(stream)).rejects.toThrow('byte limit');
    expect(cancelled).toHaveBeenCalledTimes(1);
    storeBucket.objects.set(path, Buffer.alloc(MAX_REPLAY_SOURCE_BYTES + 128 * 1024));
    await expect(store.read(expected)).rejects.toThrow('byte limit');
    storeBucket.objects.set(path, gzipSync(tooLong));
    await expect(store.read(expected)).rejects.toThrow();
  });
});
