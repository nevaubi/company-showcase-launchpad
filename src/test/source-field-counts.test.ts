// The field counts step (scripts/lib/source-field-counts.ts): a snapshot's stored file read exactly as the importer
// reads it (chunks checked, gzip, the declared encoding, header and null markers), refusals that keep a part from being
// stored as the whole, a 2-million-row stream in bounded memory, and the run: newest first, bounded in snapshots, bytes
// and time, written in field order, resumed by the next run, idempotent, tolerant of a missing table.
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { FieldCounter, type FieldCountRow } from "../../scripts/lib/field-counter";
import {
  countSnapshotFields, putBatches, runFieldCounts, SourceDataError, SourcePaused, tableMissing,
  type FieldCountsStore,
} from "../../scripts/lib/source-field-counts";
import type { SourceChunk, SourceFileManifest, SourceSnapshot } from "@/lib/sources/schema";

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const H = (n: number) => n.toString(16).padStart(64, "0");

/** A stored file: the bytes cut into chunks of `size` bytes (the store cuts at 32 MiB; tests cut anywhere). */
function stored(bytes: Uint8Array, size: number) {
  const parts = new Map<string, Uint8Array>();
  const chunks: SourceChunk[] = [];
  for (let at = 0, index = 0; at < bytes.length; at += size, index++) {
    const part = bytes.subarray(at, Math.min(at + size, bytes.length));
    const hash = sha(part);
    parts.set(`official/objects/${hash}`, part);
    chunks.push({ index, path: `official/objects/${hash}`, sha256: hash, bytes: part.length });
  }
  const file: SourceFileManifest = { sha256: sha(bytes), bytes: bytes.length, content_type: "text/csv", chunks, provenance: {} };
  return { file, parts };
}

function snapshotOf(id: string, labels: string[], records: number, file: SourceFileManifest, ingest: Partial<SourceSnapshot["ingest"]> = {}): SourceSnapshot {
  return {
    id, dataset_id: `d_${id.slice(-4)}`, status: "ready", expected_rows: records, loaded_rows: records, retrieved_at: null, published_at: "2026-11-25T06:00:00Z",
    coverage: {}, quality: {}, file_sha256: file.sha256, source_path: "t.csv", created_at: "2026-11-25T05:00:00Z",
    columns: labels.map((label, i) => ({ key: `c${i}`, label, type: "string" })),
    ingest: { format: "csv", encoding: "utf-8", delimiter: ",", header_rows: 1, dimensions: {}, ...ingest },
  };
}

const io = (parts: Map<string, Uint8Array>, active = () => true) => ({
  readChunk: async (c: SourceChunk) => {
    const part = parts.get(c.path);
    if (!part) throw new Error(`no object ${c.path}`);
    return part;
  },
  active,
});
const far = () => Date.now() + 600_000;

/** Records and the CSV text for them (no quoting needed: the generator writes no comma, quote or newline). */
function table(count: number, seed = 1) {
  let s = seed;
  const next = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const kinds = ["Zürich", "Genève", "Basel", "Bern"];
  const rows: string[][] = [];
  for (let i = 1; i <= count; i++) {
    const x = next();
    rows.push([String(i), kinds[Math.floor(x * x * kinds.length)], x < 0.1 ? "" : x < 0.15 ? "NA" : String(Math.floor(x * 30)), `n${i % 7}`]);
  }
  const text = `id,city,grade,group\n${rows.map((r) => r.join(",")).join("\n")}\n`;
  return { rows, text };
}

describe("countSnapshotFields", () => {
  it("counts a file as the importer reads it: quotes, newlines in a cell, CRLF, a byte order mark and declared nulls", async () => {
    const text = "﻿name,kind,note\r\n\"Smith, J\",A,NA\r\n\"two\nlines\",A,\r\nplain,\"B\",\"said \"\"hi\"\"\"\r\nplain,A,NA\r\n";
    const bytes = new TextEncoder().encode(text);
    const { file, parts } = stored(bytes, 7);
    const snap = snapshotOf(H(1), ["name", "kind", "note"], 4, file, { null_values: ["NA"] });
    const out = await countSnapshotFields(snap, file, io(parts), { deadline: far() });
    expect(out.records).toBe(4);
    expect(out.rows[0]).toMatchObject({ filled: 4, distinct_values: 3, top: [["plain", 2, 3], ["Smith, J", 1, 1], ["two\nlines", 1, 2]] });
    expect(out.rows[1]).toMatchObject({ filled: 4, top: [["A", 3, 1], ["B", 1, 3]] });
    expect(out.rows[2]).toMatchObject({ filled: 1, blank: 1, missing: 2, top: [['said "hi"', 1, 3]] });
  });

  it("gives the counts of the records themselves, across chunk cuts inside characters, plain or gzip", async () => {
    const { rows, text } = table(20000);
    const expected = new FieldCounter(4);
    rows.forEach((r, i) => expected.add(i + 1, r.map((v) => (v === "NA" ? null : v))));
    const bytes = new TextEncoder().encode(text);
    for (const [label, body, ingest] of [
      ["plain", bytes, {}],
      ["gzip", new Uint8Array(gzipSync(bytes)), { compression: "gzip" as const }],
    ] as const) {
      const { file, parts } = stored(body, 7777);
      const snap = snapshotOf(H(2), ["id", "city", "grade", "group"], rows.length, file, { null_values: ["NA"], ...ingest });
      const out = await countSnapshotFields(snap, file, io(parts), { deadline: far() });
      expect(out.rows, label).toEqual(expected.rows(H(2)));
      expect(out.rows[0], label).toMatchObject({ capped: "values", filled: 20000 });
    }
  });

  it("reads windows-1252 and tab-separated files as declared", async () => {
    const bytes = new Uint8Array([...new TextEncoder().encode("a\tb\n"), 0x43, 0x61, 0x66, 0xe9, 0x09, 0x31, 0x0a]);
    const { file, parts } = stored(bytes, 3);
    const snap = snapshotOf(H(3), ["a", "b"], 1, file, { encoding: "windows-1252", delimiter: "\t" });
    const out = await countSnapshotFields(snap, file, io(parts), { deadline: far() });
    expect(out.rows[0].top).toEqual([["Café", 1, 1]]);
  });

  it("refuses a file that is not the published snapshot, so no part is stored as the whole", async () => {
    const { rows, text } = table(50);
    const bytes = new TextEncoder().encode(text);
    const { file, parts } = stored(bytes, 100);
    const labels = ["id", "city", "grade", "group"];
    const run = (snap: SourceSnapshot, f = file, p = parts) => countSnapshotFields(snap, f, io(p), { deadline: far() });
    await expect(run(snapshotOf(H(4), labels, rows.length, file))).resolves.toMatchObject({ records: 50 });
    await expect(run(snapshotOf(H(4), labels, 51, file))).rejects.toThrow(/published 51, read 50/);
    await expect(run(snapshotOf(H(4), labels, 49, file))).rejects.toThrow(/more rows than the published snapshot/);
    await expect(run(snapshotOf(H(4), ["id", "town", "grade", "group"], 50, file))).rejects.toThrow(/header differs/);
    await expect(run(snapshotOf(H(4), [...labels, "extra"], 50, file))).rejects.toThrow(SourceDataError);
    await expect(run({ ...snapshotOf(H(4), labels, 50, file), status: "staging" })).rejects.toThrow(/published snapshot/);
    const bad = new Map(parts);
    const first = file.chunks[0];
    bad.set(first.path, new Uint8Array(first.bytes));
    await expect(run(snapshotOf(H(4), labels, 50, file), file, bad)).rejects.toThrow(/chunk 0 hash/);
    await expect(run(snapshotOf(H(4), labels, 50, { ...file, sha256: H(9) }), { ...file, sha256: H(9) })).rejects.toThrow(/differs from its immutable manifest/);
  });

  it("stops when its time is up or the lease is lost", async () => {
    const { rows, text } = table(3000);
    const { file, parts } = stored(new TextEncoder().encode(text), 4096);
    const snap = snapshotOf(H(5), ["id", "city", "grade", "group"], rows.length, file, { null_values: ["NA"] });
    await expect(countSnapshotFields(snap, file, io(parts), { deadline: Date.now() - 1 })).rejects.toThrow(SourcePaused);
    let calls = 0;
    await expect(countSnapshotFields(snap, file, io(parts, () => ++calls < 5), { deadline: far() })).rejects.toThrow(/lease was lost/);
  });

  it("counts a stream of 2 million records in bounded memory", { timeout: 120_000 }, async () => {
    // Two fields hold a new value in every record: a counter that kept them would hold 4 million strings.
    const count = 2_000_000;
    const pieces: Uint8Array[] = [new TextEncoder().encode("id,key,kind\n")];
    for (let from = 1; from <= count; from += 100_000) {
      let text = "";
      for (let i = from; i < from + 100_000 && i <= count; i++) text += `${i},k${(i * 2654435761) % 4294967296},${i % 10 === 0 ? "" : i % 3 === 0 ? "B" : "A"}\n`;
      pieces.push(new TextEncoder().encode(text));
    }
    const bytes = new Uint8Array(Buffer.concat(pieces));
    pieces.length = 0;
    const { file, parts } = stored(bytes, 32 * 1024 * 1024);
    expect(file.chunks.length).toBeGreaterThan(1);
    const snap = snapshotOf(H(6), ["id", "key", "kind"], count, file);
    const base = process.memoryUsage().heapUsed;
    let peak = 0;
    const watched = io(parts, () => {
      peak = Math.max(peak, process.memoryUsage().heapUsed - base);
      return true;
    });
    const out = await countSnapshotFields(snap, file, watched, { deadline: far() });
    expect(out.records).toBe(count);
    expect(out.rows[0]).toMatchObject({ capped: "values", filled: count, numeric_rows: count, top: [] });
    expect(out.rows[1]).toMatchObject({ capped: "values", filled: count });
    expect(out.rows[2]).toMatchObject({ blank: 200_000, filled: 1_800_000, distinct_values: 2, top: [["A", 1_200_000, 1], ["B", 600_000, 3]] });
    // what the counter holds is bounded by its cap; the reader keeps only the slice in hand
    expect(peak).toBeLessThan(160 * 1024 * 1024);
  });
});

// ---------------------------------------------------------------- the run

type Entry = { snapshot: SourceSnapshot; file: SourceFileManifest };

class FakeStore implements FieldCountsStore {
  entries = new Map<string, Entry>();
  parts = new Map<string, Uint8Array>();
  /** Newest published first. */
  order: string[] = [];
  table = new Map<string, FieldCountRow>();
  puts: FieldCountRow[][] = [];
  loads: string[] = [];
  failPending: unknown = null;
  failPut: (rows: FieldCountRow[], n: number) => unknown = () => null;
  failChunk: (c: SourceChunk) => unknown = () => null;
  add(id: string, labels: string[], rows: string[][]) {
    const text = `${labels.join(",")}\n${rows.map((r) => r.join(",")).join("\n")}\n`;
    const { file, parts } = stored(new TextEncoder().encode(text), 5000);
    for (const [k, v] of parts) this.parts.set(k, v);
    this.entries.set(id, { snapshot: snapshotOf(id, labels, rows.length, file), file });
    this.order.push(id);
    return file.bytes;
  }
  async pending() {
    if (this.failPending) throw this.failPending;
    return this.order
      .filter((id) => !this.table.has(`${id}|${this.entries.get(id)!.snapshot.columns.length - 1}`))
      .map((id) => ({ id, bytes: this.entries.get(id)!.file.bytes }));
  }
  async load(id: string) {
    this.loads.push(id);
    return this.entries.get(id)!;
  }
  async readChunk(c: SourceChunk) {
    const failure = this.failChunk(c);
    if (failure) throw failure;
    return this.parts.get(c.path)!;
  }
  async put(rows: FieldCountRow[]) {
    const failure = this.failPut(rows, this.puts.length);
    if (failure) throw failure;
    this.puts.push(rows);
    for (const r of rows) this.table.set(`${r.snapshot_id}|${r.position}`, r);
  }
}

const labels = (n: number) => Array.from({ length: n }, (_, i) => `f${i}`);
const recordsOf = (count: number, width: number, salt = 0) =>
  Array.from({ length: count }, (_, r) => Array.from({ length: width }, (_, f) => `v${(r * (f + 1) + salt) % 5}`));

describe("runFieldCounts", () => {
  it("counts the newest first, one at a time, in field order with the last field last, and once", async () => {
    const store = new FakeStore();
    store.add(H(11), labels(3), recordsOf(40, 3));
    store.add(H(12), labels(600), recordsOf(5, 600));
    const seen: (string | undefined)[] = [];
    const r = await runFieldCounts(store, { maxSnapshots: 10, maxBytes: 1e9, deadline: far(), progress: (p) => seen.push(p.current) });
    expect(r).toMatchObject({ items: 2, left: 0, failed: [], skipped: 0 });
    expect(r.current).toBeUndefined();
    expect(seen).toEqual([H(11), H(12)]);
    expect(store.loads).toEqual([H(11), H(12)]);
    // 600 fields go in three upserts of at most 250 rows, in field order
    const wide = store.puts.filter((b) => b[0].snapshot_id === H(12));
    expect(wide.map((b) => b.length)).toEqual([250, 250, 100]);
    expect(wide.flat().map((x) => x.position)).toEqual(Array.from({ length: 600 }, (_, i) => i));
    const again = await runFieldCounts(store, { maxSnapshots: 10, maxBytes: 1e9, deadline: far() });
    expect(again).toMatchObject({ items: 0, left: 0 });
    expect(store.loads).toHaveLength(2);
  });

  it("writes the same rows again when a snapshot is counted again (upsert)", async () => {
    const store = new FakeStore();
    store.add(H(13), labels(2), recordsOf(30, 2));
    await runFieldCounts(store, { maxSnapshots: 1, maxBytes: 1e9, deadline: far() });
    const first = [...store.table.values()].map((r) => ({ ...r }));
    store.table.delete(`${H(13)}|1`);
    await runFieldCounts(store, { maxSnapshots: 1, maxBytes: 1e9, deadline: far() });
    expect([...store.table.values()]).toEqual(first);
  });

  it("stops at its bounds of snapshots, bytes and time, always starting the first", async () => {
    const store = new FakeStore();
    const small = store.add(H(21), labels(2), recordsOf(10, 2));
    store.add(H(22), labels(2), recordsOf(4000, 2));
    store.add(H(23), labels(2), recordsOf(10, 2));
    expect(await runFieldCounts(store, { maxSnapshots: 1, maxBytes: 1e9, deadline: far() })).toMatchObject({ items: 1, left: 2, stopped: "snapshots" });
    // the second is bigger than what is left of the byte bound: the run ends before it
    expect(await runFieldCounts(store, { maxSnapshots: 9, maxBytes: small, deadline: far() })).toMatchObject({ items: 1, left: 1, stopped: "bytes" });
    // the first of a run always starts, whatever its size
    const big = new FakeStore();
    big.add(H(24), labels(2), recordsOf(4000, 2));
    expect(await runFieldCounts(big, { maxSnapshots: 9, maxBytes: 10, deadline: far() })).toMatchObject({ items: 1 });
    // a snapshot whose planned time would pass the deadline is not started, unless first
    const timed = new FakeStore();
    timed.add(H(25), labels(2), recordsOf(10, 2));
    timed.add(H(26), labels(2), recordsOf(10, 2));
    expect(await runFieldCounts(timed, { maxSnapshots: 9, maxBytes: 1e9, deadline: Date.now() + 10_000 })).toMatchObject({ items: 1, left: 1, stopped: "time" });
  });

  it("resumes: a snapshot stopped part way is not complete, and the next run counts it whole", async () => {
    const store = new FakeStore();
    store.add(H(31), labels(2), recordsOf(10, 2));
    store.add(H(32), labels(2), recordsOf(5000, 2));
    let clock = 1_000_000;
    let reads = 0;
    store.failChunk = () => {
      reads += 1;
      if (reads > 2) clock += 10_000;
      return null;
    };
    const stopped = await runFieldCounts(store, { maxSnapshots: 9, maxBytes: 1e9, deadline: 1_030_000, now: () => clock });
    expect(stopped).toMatchObject({ items: 1, left: 1 });
    expect(stopped.stopped).toMatch(/runtime budget/);
    expect(stopped.too_long).toBeUndefined();
    expect((await store.pending()).map((p) => p.id)).toEqual([H(32)]);
    store.failChunk = () => null;
    expect(await runFieldCounts(store, { maxSnapshots: 9, maxBytes: 1e9, deadline: far() })).toMatchObject({ items: 1, left: 0 });
    expect(await store.pending()).toEqual([]);
  });

  it("names a snapshot that a whole run could not count, and skips what the worker asks", async () => {
    const store = new FakeStore();
    store.add(H(41), labels(2), recordsOf(5000, 2));
    store.add(H(42), labels(2), recordsOf(10, 2));
    let clock = 0;
    store.failChunk = () => ((clock += 50_000), null);
    const r = await runFieldCounts(store, { maxSnapshots: 9, maxBytes: 1e9, deadline: 60_000, now: () => clock });
    expect(r).toMatchObject({ items: 0, too_long: [H(41)], left: 1 });
    store.failChunk = () => null;
    const next = await runFieldCounts(store, { maxSnapshots: 9, maxBytes: 1e9, deadline: far(), skip: new Set([H(41)]) });
    expect(next).toMatchObject({ items: 1, skipped: 1, left: 0 });
    expect(store.loads.at(-1)).toBe(H(42));
  });

  it("goes on after a file that does not match its snapshot, and ends the run on any other failure", async () => {
    const store = new FakeStore();
    // three different files (the store addresses objects by content)
    store.add(H(51), labels(2), recordsOf(10, 2, 1));
    store.add(H(52), labels(2), recordsOf(10, 2, 2));
    store.add(H(53), labels(2), recordsOf(10, 2, 3));
    store.entries.get(H(51))!.snapshot.loaded_rows = 11;
    store.entries.get(H(51))!.snapshot.expected_rows = 11;
    store.failChunk = (c) => (c.path === store.entries.get(H(52))!.file.chunks[0].path ? new Error("storage answered 503") : null);
    const r = await runFieldCounts(store, { maxSnapshots: 9, maxBytes: 1e9, deadline: far() });
    expect(r.failed.map((f) => f.snapshot)).toEqual([H(51), H(52)]);
    expect(r).toMatchObject({ items: 0, left: 1 });
    expect(r.error).toMatch(/^000000000000: .*published 11, read 10/);
  });

  it("does nothing but say so while the table of migration 0070 is missing", async () => {
    const store = new FakeStore();
    store.add(H(61), labels(2), recordsOf(10, 2));
    store.failPending = { code: "PGRST205", message: "Could not find the table 'public.source_field_counts' in the schema cache" };
    expect(await runFieldCounts(store, { maxSnapshots: 9, maxBytes: 1e9, deadline: far() })).toMatchObject({ not_installed: true, items: 0 });
    store.failPending = null;
    store.failPut = () => ({ code: "42P01", message: 'relation "public.source_field_counts" does not exist' });
    expect(await runFieldCounts(store, { maxSnapshots: 9, maxBytes: 1e9, deadline: far() })).toMatchObject({ not_installed: true, items: 0 });
    expect(tableMissing({ code: "PGRST200" })).toBe(true);
    expect(tableMissing({ code: "57014" })).toBe(false);
  });

  it("leaves a snapshot incomplete when a write fails part way", async () => {
    const store = new FakeStore();
    store.add(H(71), labels(600), recordsOf(3, 600));
    store.failPut = (_rows, n) => (n === 1 ? new Error("network reset") : null);
    const r = await runFieldCounts(store, { maxSnapshots: 9, maxBytes: 1e9, deadline: far() });
    expect(r).toMatchObject({ items: 0, failed: [{ snapshot: H(71) }] });
    expect(store.table.size).toBe(250);
    expect((await store.pending()).map((p) => p.id)).toEqual([H(71)]);
  });

  it("cuts upserts by rows and by bytes", () => {
    const row = (position: number, value: string): FieldCountRow => ({
      snapshot_id: H(1), position, filled: 1, blank: 0, missing: 0, numeric_rows: 0, value_cap: 1000, distinct_values: 1, capped: null, top: [[value, 1, 1]], other_rows: 0, other_values: 0,
    });
    const rows = Array.from({ length: 10 }, (_, i) => row(i, "x".repeat(i === 3 ? 400_000 : 10)));
    const batches = putBatches(rows);
    expect(batches.flat().map((r) => r.position)).toEqual(Array.from({ length: 10 }, (_, i) => i));
    expect(batches.length).toBeGreaterThan(1);
    expect(putBatches(rows, { rows: 4, bytes: 1e9 }).map((b) => b.length)).toEqual([4, 4, 2]);
  });
});
