/** Streaming native CSV ingestion shared by the worker CLI and controlled end-to-end tests. */
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { NativeCsvReader } from "../../src/lib/sources/csv";
import { ingestInput, projectSourceRow, validateSourceFile, validateSourceRow } from "../../src/lib/sources/validation";
import type { SourceChunk, SourceFileManifest, SourceRecord, SourceSnapshot } from "../../src/lib/sources/schema";

export class SourceDataError extends Error {}
export class SourcePaused extends Error {}
export type SourceImportIo = {
  /** Each download is at most 32 MiB; hash-check it before any of its bytes reach the CSV parser. */
  readChunk(chunk: SourceChunk): Promise<Uint8Array>;
  put(rows: SourceRecord[]): Promise<void>;
  verified(sha256: string): Promise<void>;
  publish(): Promise<void>;
  active(): boolean;
  progress(event: Record<string, string | number | boolean>): void;
};
export async function importSourceSnapshot(snapshot: SourceSnapshot, rawFile: SourceFileManifest, io: SourceImportIo, options: { deadline: number; now?: () => number; batchRows?: number; batchBytes?: number }) {
  const now = options.now ?? Date.now;
  const check = () => { if (!io.active()) throw new SourcePaused("Source lease was lost"); if (now() >= options.deadline) throw new SourcePaused("Source runtime budget reached"); };
  let file: SourceFileManifest;
  let ingest: SourceSnapshot["ingest"];
  try { file = validateSourceFile(rawFile); ingest = ingestInput.parse(snapshot.ingest); }
  catch (e) { throw new SourceDataError((e as Error).message); }
  if (file.sha256 !== snapshot.file_sha256) throw new SourceDataError("Snapshot and source file identity differ");
  const whole = createHash("sha256"); let verified = false;
  async function* chunks() {
    for (const chunk of file.chunks) {
      check();
      const bytes = await io.readChunk(chunk);
      if (bytes.length !== chunk.bytes || createHash("sha256").update(bytes).digest("hex") !== chunk.sha256) throw new SourceDataError(`Source chunk ${chunk.index} hash or byte length differs`);
      whole.update(bytes);
      // Yield small slices so narrow multi-million-row files never accumulate a whole chunk's rows.
      for (let i=0;i<bytes.length;i+=65536) { check(); yield bytes.subarray(i,Math.min(i+65536,bytes.length)); }
      io.progress({ event:"source_chunk_verified",snapshot_id:snapshot.id,index:chunk.index,bytes:bytes.length });
    }
    if (whole.digest("hex") !== file.sha256) throw new SourceDataError("Source file SHA-256 differs from its immutable manifest");
    verified = true;
  }
  const source = Readable.from(chunks());
  const stream = ingest.compression === "gzip" ? source.pipe(createGunzip()) : source;
  if (stream !== source) source.on("error",e=>stream.destroy(e));
  const reader = new NativeCsvReader(ingest.delimiter);
  const decoder = new TextDecoder(ingest.encoding,{fatal:true});
  let headers = 0; let count = 0; let batch: SourceRecord[]=[]; let batchBytes=2; let written=snapshot.loaded_rows;
  const flush = async () => {
    if (!batch.length) return;
    if (!io.active()) throw new SourcePaused("Source lease was lost");
    await io.put(batch); written=batch.at(-1)!.row_number;
    io.progress({event:"source_batch_stored",snapshot_id:snapshot.id,loaded_rows:written,expected_rows:snapshot.expected_rows});
    batch=[]; batchBytes=2;
  };
  const take = async (native: string[]) => {
    if (headers < ingest.header_rows) {
      headers++;
      if (headers === ingest.header_rows && (native.length !== snapshot.columns.length || native.some((v,i)=>v !== snapshot.columns[i].label))) throw new SourceDataError("Source header differs from ordered column dictionary");
      return;
    }
    count++;
    if (native.length !== snapshot.columns.length) throw new SourceDataError(`Source row ${count} width ${native.length} does not match ${snapshot.columns.length} columns`);
    if (count > snapshot.expected_rows) throw new SourceDataError("Source contains more rows than the reviewed manifest");
    // Every contributing chunk is verified before parsing, and the store enforces a contiguous
    // immutable prefix. A bounded restart can safely parse past already stored rows without writes.
    if (count <= snapshot.loaded_rows) return;
    let row: SourceRecord;
    try { row=validateSourceRow(projectSourceRow(native,count,ingest),snapshot.columns.length); }
    catch(e) { throw new SourceDataError((e as Error).message); }
    const bytes=Buffer.byteLength(JSON.stringify(row))+1;
    if (bytes > 7*1024*1024) throw new SourceDataError(`Source row ${count} exceeds the bounded import payload`);
    if (batch.length && (batch.length >= (options.batchRows ?? 5000) || batchBytes+bytes > (options.batchBytes ?? 2*1024*1024))) await flush();
    batch.push(row); batchBytes+=bytes;
    if (now()>=options.deadline) { await flush(); throw new SourcePaused("Source runtime budget reached"); }
  };
  try {
    for await (const bytes of stream) {
      let rows: string[][];
      try { rows=reader.write(decoder.decode(bytes as Uint8Array,{stream:true})); }
      catch(e) { throw new SourceDataError((e as Error).message); }
      for (const row of rows) await take(row);
      check();
    }
    let tail: string[][];
    try { tail=[...reader.write(decoder.decode()),...reader.close()]; }
    catch(e) { throw new SourceDataError((e as Error).message); }
    for (const row of tail) await take(row);
    await flush();
    if (!verified || headers !== ingest.header_rows || count !== snapshot.expected_rows) throw new SourceDataError(`Source count differs: expected ${snapshot.expected_rows}, read ${count}, headers ${headers}`);
    await io.verified(file.sha256); check(); await io.publish();
    io.progress({event:"source_snapshot_published",snapshot_id:snapshot.id,rows:count,source_bytes:file.bytes});
    return {rows:count,published:true};
  } finally { stream.destroy(); if (stream !== source) source.destroy(); }
}
