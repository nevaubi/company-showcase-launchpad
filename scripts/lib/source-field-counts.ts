/**
 * The field counts step (migration 0070), shared by the worker's child (`scripts/source-field-counts.ts`), the tests
 * and the local proof.
 *
 * `countSnapshotFields` streams one published snapshot's stored file exactly as the importer reads it
 * (`importSourceSnapshot`): every chunk's length and SHA-256 checked before its bytes reach the parser, the whole file's
 * SHA-256 at the end, gzip when declared, the declared encoding and delimiter, the header against the ordered
 * dictionary, every row's width, and `projectSourceRow` for the stored cells. It never reads `source_records`. The file
 * must hold exactly the snapshot's published records, or nothing is counted.
 *
 * `runFieldCounts` takes the published snapshots whose counts are not complete, newest published first, one at a
 * time, bounded per run in snapshots, source bytes and time, and writes each snapshot's rows by upsert in field order,
 * the last field last (the row that marks the counts complete). A run that stops keeps nothing of the snapshot it was
 * counting but the rows already sent, which the next run replaces: the queue is read again from the table each run,
 * so the step resumes where it stopped and a counted snapshot is never counted again.
 */
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { NativeCsvReader } from "../../src/lib/sources/csv";
import type { SourceChunk, SourceFileManifest, SourceSnapshot } from "../../src/lib/sources/schema";
import { ingestInput, projectSourceRow, validateSourceFile } from "../../src/lib/sources/validation";
import { FieldCounter, type FieldCounterOptions, type FieldCountRow } from "./field-counter";
import { safeError } from "./official-worker-plan";
import { SourceDataError, SourcePaused } from "./source-import";

export { SourceDataError, SourcePaused };

export type CountIo = {
  /** Each download is at most 32 MiB; its hash is checked here before any of its bytes are parsed. */
  readChunk(chunk: SourceChunk): Promise<Uint8Array>;
  /** False once the worker's lease is lost: the count stops. */
  active(): boolean;
};

export type SnapshotCount = { rows: FieldCountRow[]; records: number; bytes: number; capped: number };

/** Counts every field of one published snapshot from its stored file. */
export async function countSnapshotFields(
  snapshot: SourceSnapshot,
  rawFile: SourceFileManifest,
  io: CountIo,
  options: { deadline: number; now?: () => number; counter?: FieldCounterOptions },
): Promise<SnapshotCount> {
  const now = options.now ?? Date.now;
  const check = () => {
    if (!io.active()) throw new SourcePaused("Source lease was lost");
    if (now() >= options.deadline) throw new SourcePaused("Field counts runtime budget reached");
  };
  let file: SourceFileManifest;
  let ingest: SourceSnapshot["ingest"];
  try {
    file = validateSourceFile(rawFile);
    ingest = ingestInput.parse(snapshot.ingest);
  } catch (e) {
    throw new SourceDataError((e as Error).message);
  }
  if (file.sha256 !== snapshot.file_sha256) throw new SourceDataError("Snapshot and source file identity differ");
  if (snapshot.status !== "ready" || snapshot.loaded_rows !== snapshot.expected_rows) throw new SourceDataError("Only a published snapshot is counted");
  const width = snapshot.columns.length;
  const counter = new FieldCounter(width, options.counter);
  const whole = createHash("sha256");
  let verified = false;
  async function* chunks() {
    for (const chunk of file.chunks) {
      check();
      const bytes = await io.readChunk(chunk);
      if (bytes.length !== chunk.bytes || createHash("sha256").update(bytes).digest("hex") !== chunk.sha256)
        throw new SourceDataError(`Source chunk ${chunk.index} hash or byte length differs`);
      whole.update(bytes);
      // small slices, so a narrow file of millions of rows never holds a whole chunk's rows
      for (let i = 0; i < bytes.length; i += 65536) {
        check();
        yield bytes.subarray(i, Math.min(i + 65536, bytes.length));
      }
    }
    if (whole.digest("hex") !== file.sha256) throw new SourceDataError("Source file SHA-256 differs from its immutable manifest");
    verified = true;
  }
  const source = Readable.from(chunks());
  const stream = ingest.compression === "gzip" ? source.pipe(createGunzip()) : source;
  if (stream !== source) source.on("error", (e) => stream.destroy(e));
  const reader = new NativeCsvReader(ingest.delimiter);
  const decoder = new TextDecoder(ingest.encoding, { fatal: true });
  let headers = 0;
  let count = 0;
  const take = (native: string[]) => {
    if (headers < ingest.header_rows) {
      headers++;
      if (headers === ingest.header_rows && (native.length !== width || native.some((v, i) => v !== snapshot.columns[i].label)))
        throw new SourceDataError("Source header differs from ordered column dictionary");
      return;
    }
    count++;
    if (native.length !== width) throw new SourceDataError(`Source row ${count} width ${native.length} does not match ${width} columns`);
    if (count > snapshot.loaded_rows) throw new SourceDataError("Source contains more rows than the published snapshot");
    let values: (string | null)[];
    try {
      values = projectSourceRow(native, count, ingest).values;
    } catch (e) {
      throw new SourceDataError((e as Error).message);
    }
    counter.add(count, values);
  };
  try {
    for await (const bytes of stream) {
      let rows: string[][];
      try {
        rows = reader.write(decoder.decode(bytes as Uint8Array, { stream: true }));
      } catch (e) {
        throw new SourceDataError((e as Error).message);
      }
      for (const row of rows) take(row);
      check();
    }
    let tail: string[][];
    try {
      tail = [...reader.write(decoder.decode()), ...reader.close()];
    } catch (e) {
      throw new SourceDataError((e as Error).message);
    }
    for (const row of tail) take(row);
    if (!verified || headers !== ingest.header_rows || count !== snapshot.loaded_rows)
      throw new SourceDataError(`Source count differs: published ${snapshot.loaded_rows}, read ${count}, headers ${headers}`);
    return { rows: counter.rows(snapshot.id), records: count, bytes: file.bytes, capped: counter.held().capped };
  } finally {
    stream.destroy();
    if (stream !== source) source.destroy();
  }
}

// ---------------------------------------------------------------- the run

/** Rows one upsert sends at most, and their JSON bytes at most. */
export const PUT_ROWS = 250;
export const PUT_BYTES = 1024 * 1024;
/** Source bytes a second the run plans with (well under what the reader does on one core), to decide whether to start a snapshot. */
export const PLAN_BYTES_PER_SECOND = 4 * 1024 * 1024;
/** Time kept free at the end of a run for the last snapshot's writes. */
export const WRITE_MARGIN_MS = 15_000;

/** A published snapshot without complete counts. */
export type FieldCountsCandidate = { id: string; bytes: number };

export type FieldCountsStore = {
  /** Published snapshots whose counts are not complete (no row for their last field), newest published first. */
  pending(): Promise<FieldCountsCandidate[]>;
  /** One published snapshot and its file manifest. */
  load(id: string): Promise<{ snapshot: SourceSnapshot; file: SourceFileManifest }>;
  readChunk(chunk: SourceChunk): Promise<Uint8Array>;
  /** One upsert of rows on (snapshot_id, position). Throws an error carrying the database's `code`. */
  put(rows: FieldCountRow[]): Promise<void>;
};

export type FieldCountsLine = { snapshot: string; fields: number; capped: number; records: number; bytes: number; seconds: number };
export type FieldCountsFailure = { snapshot: string; error: string };
export type FieldCountsReceipt = {
  script: "source-field-counts";
  step: "field counts";
  /** Snapshots counted and stored by this run. */
  items: number;
  counted: FieldCountsLine[];
  failed: FieldCountsFailure[];
  /** Snapshots in this run's queue it did not reach (without the ones the worker asked it to skip). */
  left: number;
  /** Snapshots without counts the worker asked this run to skip. */
  skipped: number;
  /** Source bytes read. */
  bytes: number;
  seconds: number;
  /** Why the run ended before its queue did: "snapshots", "bytes", "time", or a stop of the snapshot in hand. */
  stopped?: string;
  /** The snapshot the run is counting; present only while it counts, so a receipt of a run that was stopped names it. */
  current?: string;
  /** A snapshot that did not fit in a whole run: the worker leaves it for a day. */
  too_long?: string[];
  /** The table of migration 0070 is not there: nothing was counted. */
  not_installed?: boolean;
  error?: string;
};

/** PostgREST PGRST205 (no such table in its schema cache) or PGRST200 (no such relationship), Postgres 42P01. */
export const tableMissing = (error: unknown) => {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "PGRST205" || code === "PGRST200" || code === "42P01";
};

/** Splits a snapshot's rows into upserts in field order: at most `rows` rows and `bytes` JSON bytes each. */
export function putBatches(rows: readonly FieldCountRow[], max = { rows: PUT_ROWS, bytes: PUT_BYTES }): FieldCountRow[][] {
  const batches: FieldCountRow[][] = [];
  let batch: FieldCountRow[] = [];
  let size = 2;
  for (const row of rows) {
    const bytes = JSON.stringify(row).length * 3 + 1;
    if (batch.length && (batch.length >= max.rows || size + bytes > max.bytes)) {
      batches.push(batch);
      batch = [];
      size = 2;
    }
    batch.push(row);
    size += bytes;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

export async function runFieldCounts(
  store: FieldCountsStore,
  o: {
    maxSnapshots: number;
    maxBytes: number;
    /** When the run stops, the snapshot in hand included (epoch ms). */
    deadline: number;
    skip?: ReadonlySet<string>;
    now?: () => number;
    active?: () => boolean;
    /** Called before each snapshot with the receipt so far, `current` set. */
    progress?: (receipt: FieldCountsReceipt) => void;
    counter?: FieldCounterOptions;
    log?: (line: Record<string, unknown>) => void;
  },
): Promise<FieldCountsReceipt> {
  const now = o.now ?? Date.now;
  const active = o.active ?? (() => true);
  const started = now();
  const receipt: FieldCountsReceipt = { script: "source-field-counts", step: "field counts", items: 0, counted: [], failed: [], left: 0, skipped: 0, bytes: 0, seconds: 0 };
  const close = () => {
    receipt.seconds = Math.round((now() - started) / 100) / 10;
    delete receipt.current;
    if (!receipt.error && receipt.failed.length) receipt.error = `${receipt.failed[0].snapshot.slice(0, 12)}: ${receipt.failed[0].error}`;
    return receipt;
  };
  let pending: FieldCountsCandidate[];
  try {
    pending = await store.pending();
  } catch (e) {
    if (tableMissing(e)) {
      receipt.not_installed = true;
      return close();
    }
    receipt.error = `list of snapshots without field counts: ${safeError(e)}`;
    return close();
  }
  const skip = o.skip ?? new Set<string>();
  const queue = pending.filter((c) => !skip.has(c.id));
  receipt.skipped = pending.length - queue.length;
  let next = 0;
  for (; next < queue.length; next++) {
    const candidate = queue[next];
    const first = next === 0;
    if (receipt.counted.length + receipt.failed.length >= o.maxSnapshots) {
      receipt.stopped = "snapshots";
      break;
    }
    if (!first && receipt.bytes + candidate.bytes > o.maxBytes) {
      receipt.stopped = "bytes";
      break;
    }
    if (!first && now() + (candidate.bytes / PLAN_BYTES_PER_SECOND) * 1000 + WRITE_MARGIN_MS > o.deadline) {
      receipt.stopped = "time";
      break;
    }
    o.progress?.({ ...receipt, current: candidate.id });
    const t0 = now();
    try {
      const { snapshot, file } = await store.load(candidate.id);
      const counted = await countSnapshotFields(snapshot, file, { readChunk: (c) => store.readChunk(c), active }, { deadline: o.deadline, now, counter: o.counter });
      receipt.bytes += counted.bytes;
      for (const batch of putBatches(counted.rows)) {
        if (!active()) throw new SourcePaused("Source lease was lost");
        await store.put(batch);
      }
      receipt.items += 1;
      receipt.counted.push({ snapshot: candidate.id, fields: counted.rows.length, capped: counted.capped, records: counted.records, bytes: counted.bytes, seconds: Math.round((now() - t0) / 100) / 10 });
      o.log?.({ event: "field_counts_stored", snapshot_id: candidate.id, fields: counted.rows.length, capped: counted.capped, records: counted.records });
    } catch (e) {
      if (e instanceof SourcePaused) {
        receipt.stopped = `${candidate.id.slice(0, 12)}: ${e.message}`;
        // A snapshot that a whole run could not count is left for a day by the worker. Any other stopped snapshot
        // stays in the queue: the next run starts with it and gives it the whole run.
        if (first && /runtime budget/.test(e.message)) {
          receipt.too_long = [candidate.id];
          next += 1;
        }
        break;
      }
      if (tableMissing(e)) {
        receipt.not_installed = true;
        next += 1;
        break;
      }
      receipt.failed.push({ snapshot: candidate.id, error: safeError(e) });
      o.log?.({ event: "field_counts_failed", snapshot_id: candidate.id, error: safeError(e) });
      // the file does not match its published snapshot: the next one may; anything else (storage, database) ends the run
      if (!(e instanceof SourceDataError)) {
        next += 1;
        break;
      }
    }
  }
  receipt.left = Math.max(0, queue.length - next);
  return close();
}
