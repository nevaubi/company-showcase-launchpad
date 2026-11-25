/** Server-only immutable source staging, shared by direct CSV and reviewed API adapters. */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { createGunzip } from "node:zlib";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NativeRefreshScanner, refreshColumns, type NativeRefreshStats } from "../../src/lib/sources/refresh-plan";
import { SOURCE_CHUNK_BYTES, validateSourceFile } from "../../src/lib/sources/validation";
import type { SourceColumn, SourceFileManifest, SourceIngest, SourceJson } from "../../src/lib/sources/schema";

export type NativeRefreshTemplate = {
  datasetId: string;
  previousSnapshotId: string | null;
  previousFileSha256: string | null;
  previousRows: number;
  columns: SourceColumn[];
  ingest: SourceIngest;
  coverage?: Record<string, SourceJson>;
};
export type StageNativeRefreshInput = {
  sb: SupabaseClient;
  template: NativeRefreshTemplate;
  filePath: string;
  retrievedAt: string;
  provenance: Record<string, SourceJson>;
  /** Counts/scopes freshly computed by a reviewed adapter, never old coverage. */
  freshCoverage?: Record<string, SourceJson>;
  /** Narrow adapter evidence; importer/publication guard flags cannot be set here. */
  freshQuality?: Record<string, SourceJson>;
  supportingFiles?: { filePath: string; contentType: string; provenance: Record<string, SourceJson> }[];
  gate?: (label: string) => Promise<void>;
  sourceUrl?: string;
  sourcePath?: string;
  contentType?: string;
  signal: AbortSignal;
  maxFileBytes?: number;
  maxExpandedBytes?: number;
  quarantineReason?: string;
};
export type StageNativeRefreshResult = {
  outcome: "unchanged" | "staged" | "quarantined" | "reused_pending";
  snapshotId: string | null;
  fileSha256: string;
  expectedRows: number;
  reason?: string;
};
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}

export async function countNativeRefreshFile(filePath: string, ingest: SourceIngest, previousColumns: SourceColumn[], signal: AbortSignal,
  maxExpandedBytes = 512 * 1024 * 1024): Promise<NativeRefreshStats> {
  if (ingest.header_rows !== 1) throw new Error("Refresh requires exactly one native header row");
  const reader = new NativeRefreshScanner(ingest.delimiter, previousColumns.map(c => c.label));
  const decoder = new TextDecoder(ingest.encoding, { fatal: true });
  const raw = createReadStream(filePath, { highWaterMark: 64 * 1024, signal });
  const stream = ingest.compression === "gzip" ? raw.pipe(createGunzip()) : raw;
  if (stream !== raw) raw.on("error", error => stream.destroy(error));
  let expanded = 0;
  try {
    for await (const chunk of stream) {
      signal.throwIfAborted();
      expanded += (chunk as Buffer).length;
      if (expanded > maxExpandedBytes) throw new Error("Expanded source exceeds the bounded refresh size");
      reader.write(decoder.decode(chunk as Uint8Array, { stream: true }));
    }
    reader.write(decoder.decode());
    return reader.finish();
  } finally { raw.destroy(); if (stream !== raw) stream.destroy(); }
}

async function describeFile(input: StageNativeRefreshInput): Promise<SourceFileManifest> {
  const size = (await stat(input.filePath)).size;
  if (size > (input.maxFileBytes ?? 256 * 1024 * 1024)) throw new Error("Source file exceeds the bounded refresh size");
  const whole = createHash("sha256");
  const chunks = [];
  const handle = await open(input.filePath, "r");
  let offset = 0;
  try {
    while (offset < size) {
      input.signal.throwIfAborted();
      const buffer = Buffer.allocUnsafe(Math.min(SOURCE_CHUNK_BYTES, size - offset));
      let filled = 0;
      while (filled < buffer.length) {
        const { bytesRead } = await handle.read(buffer, filled, buffer.length - filled, offset + filled);
        if (!bytesRead) throw new Error("Source file changed while hashing");
        filled += bytesRead;
      }
      whole.update(buffer);
      const digest = hash(buffer);
      chunks.push({ index: chunks.length, path: `official/objects/${digest}`, sha256: digest, bytes: buffer.length });
      offset += buffer.length;
    }
  } finally { await handle.close(); }
  if ((await stat(input.filePath)).size !== size) throw new Error("Source file changed while hashing");
  return validateSourceFile({ sha256: whole.digest("hex"), bytes: size,
    content_type: input.contentType ?? (input.template.ingest.compression ? "application/gzip" : "text/csv"), chunks,
    provenance: { ...input.provenance, retrieved_at: input.retrievedAt, refresh_identity_version: "source-1:retrieved_at", previous_snapshot_id: input.template.previousSnapshotId } });
}

async function uploadFile(input: StageNativeRefreshInput, file: SourceFileManifest) {
  await input.gate?.("source-refresh-file-read");
  const existing = await input.sb.from("source_files").select("sha256,bytes,chunks").eq("sha256", file.sha256).maybeSingle();
  if (existing.error) throw new Error(`Read source file: ${existing.error.message}`);
  if (existing.data) {
    if (existing.data.bytes !== file.bytes || canonical(existing.data.chunks) !== canonical(file.chunks)) throw new Error("Existing immutable file definition conflicts with refreshed content");
    // Hash-based file provenance is immutable. New retrieval evidence lives on
    // the new snapshot; never overwrite an older source file's provenance.
    return;
  }
  const handle = await open(input.filePath, "r");
  let offset = 0;
  try {
    for (const chunk of file.chunks) {
      input.signal.throwIfAborted();
      const bytes = Buffer.allocUnsafe(chunk.bytes);
      let filled = 0;
      while (filled < bytes.length) {
        const read = await handle.read(bytes, filled, bytes.length - filled, offset + filled);
        if (!read.bytesRead) throw new Error("Source file changed while uploading");
        filled += read.bytesRead;
      }
      if (hash(bytes) !== chunk.sha256) throw new Error("Source chunk changed after validation");
      await input.gate?.("source-refresh-chunk-upload");
      const saved = await input.sb.storage.from("datasets").upload(chunk.path, bytes, { upsert: false, contentType: "application/octet-stream" });
      if (saved.error) {
        const error = saved.error as { message: string; statusCode?: string | number };
        if (!["409", "400"].includes(String(error.statusCode)) && !/already exists|duplicate/i.test(error.message)) throw new Error(`Store source chunk: ${error.message}`);
        await input.gate?.("source-refresh-chunk-verify");
        const current = await input.sb.storage.from("datasets").download(chunk.path);
        if (current.error || !current.data) throw new Error(`Could not verify existing source chunk: ${current.error?.message}`);
        if (current.data.size !== chunk.bytes || hash(new Uint8Array(await current.data.arrayBuffer())) !== chunk.sha256) throw new Error("Existing content-addressed object has different bytes");
      }
      offset += chunk.bytes;
    }
  } finally { await handle.close(); }
  await input.gate?.("source-refresh-file-register");
  const stored = await input.sb.from("source_files").upsert({ ...file, verified_at: null }, { onConflict: "sha256", ignoreDuplicates: true });
  if (stored.error) throw new Error(`Register refreshed source file: ${stored.error.message}`);
  const actual = await input.sb.from("source_files").select("sha256,bytes,chunks").eq("sha256", file.sha256).single();
  if (actual.error) throw new Error(`Verify registered source file: ${actual.error.message}`);
  if (actual.data.bytes !== file.bytes || canonical(actual.data.chunks) !== canonical(file.chunks)) throw new Error("Racing source file registration has a different immutable definition");
}

/** Does not insert records, update source_datasets, or publish any pointer. */
export async function stageNativeRefresh(input: StageNativeRefreshInput): Promise<StageNativeRefreshResult> {
  input.signal.throwIfAborted();
  if (!Number.isFinite(Date.parse(input.retrievedAt))) throw new Error("An actual retrieval timestamp is required");
  const file = await describeFile(input);
  if (file.sha256 === input.template.previousFileSha256) return { outcome: "unchanged", snapshotId: null, fileSha256: file.sha256, expectedRows: input.template.previousRows };
  let stats: NativeRefreshStats | null = null;
  let quarantineReason = input.quarantineReason;
  try { stats = await countNativeRefreshFile(input.filePath, input.template.ingest, input.template.columns, input.signal, input.maxExpandedBytes); }
  catch (error) {
    input.signal.throwIfAborted();
    quarantineReason = `Native source validation failed: ${(error as Error).message}`;
  }
  if (stats && !stats.headerMatches) quarantineReason = "Native header labels or order changed; schema review is required before publication.";
  if (stats && stats.rows === 0 && input.template.previousRows > 0) quarantineReason = "A previously populated source returned a header without observations; publication requires review.";
  const columns = stats ? refreshColumns(input.template.columns, stats) : input.template.columns;
  const ingest: SourceIngest = quarantineReason ? { ...input.template.ingest, dimensions: {}, composites: undefined, geo_code_format: undefined,
    constants: input.sourceUrl ? { source_url: input.sourceUrl } : {} } : { ...input.template.ingest };
  if (input.sourceUrl && ingest.dimensions.source_url === undefined) ingest.constants = { ...ingest.constants, source_url: input.sourceUrl };
  await input.gate?.("source-refresh-snapshot-read");
  const pending = await input.sb.from("source_snapshots").select("id,ingest,columns,expected_rows").eq("dataset_id", input.template.datasetId)
    .eq("file_sha256", file.sha256).eq("status", "staging").limit(20);
  if (pending.error) throw new Error(`Find pending refresh: ${pending.error.message}`);
  if (!quarantineReason) {
    const matching = (pending.data ?? []).find(p => canonical(p.ingest) === canonical(ingest) && canonical(p.columns) === canonical(columns));
    if (matching) return { outcome: "reused_pending", snapshotId: matching.id, fileSha256: file.sha256, expectedRows: matching.expected_rows };
  }
  const current = await input.sb.from("source_datasets").select("latest_snapshot_id").eq("id", input.template.datasetId).single();
  if (current.error) throw new Error(`Read current dataset: ${current.error.message}`);
  if (current.data.latest_snapshot_id !== input.template.previousSnapshotId) throw new Error("Current snapshot changed during collection; retry against its verified schema");
  await uploadFile(input, file);
  const supportingHashes: string[] = [];
  for (const supporting of input.supportingFiles ?? []) {
    const supportingInput = { ...input, filePath: supporting.filePath, contentType: supporting.contentType, provenance: supporting.provenance };
    const original = await describeFile(supportingInput);
    await uploadFile(supportingInput, original);
    supportingHashes.push(original.sha256);
  }
  const id = hash(`${input.template.datasetId}:${file.sha256}:source-1:${input.retrievedAt}`);
  // Copy only stable source semantics. Counts, vintages, dates and completeness
  // flags are computed for this response instead of borrowed from old coverage.
  const stable = ["source_ids", "entity_type", "entity_id_column", "identity_rule", "period_components", "period_index_is_native_text", "period_frequency", "geography_rule"];
  const coverage = Object.fromEntries(stable.filter(key => input.template.coverage?.[key] !== undefined).map(key => [key, input.template.coverage![key]]));
  const quality: Record<string, SourceJson> = { refresh: true, refresh_identity_version: "source-1:retrieved_at",
    previous_snapshot_id: input.template.previousSnapshotId, native_values_unchanged: true,
    row_width_verified: stats !== null, expected_row_count_known: stats !== null, header_matches_previous: stats?.headerMatches ?? false,
    blank_counts_by_column: stats?.blankCounts ?? [], source_value_policy: "exact_strings_blank_is_empty_string",
    ...(quarantineReason ? { quarantined: true, quarantine_reason: quarantineReason } : {}) };
  for (const key of ["requested_field_count", "returned_field_count", "requested_but_not_returned_fields", "requested_but_not_returned_count", "omission_verified"]) {
    if (input.freshQuality?.[key] !== undefined) quality[key] = input.freshQuality[key];
  }
  const snapshot = { id, dataset_id: input.template.datasetId, file_sha256: file.sha256,
    source_path: input.sourcePath ?? `refresh/${id}.csv${input.template.ingest.compression ? ".gz" : ""}`,
    retrieved_at: input.retrievedAt, published_at: null, status: quarantineReason ? "failed" : "staging",
    expected_rows: stats?.rows ?? 0, loaded_rows: 0, columns, ingest, quality,
    coverage: { ...coverage, ...input.freshCoverage, supporting_source_file_shas: supportingHashes,
      source_urls: input.sourceUrl ? [input.sourceUrl] : [],
      source_retrieval_times: [input.retrievedAt], publication_time_known: false, availability_time_known: false,
      refresh_provenance: input.provenance },
    ...(quarantineReason ? { last_error: quarantineReason.slice(0, 1000) } : {}) };
  await input.gate?.("source-refresh-snapshot-register");
  const staged = await input.sb.from("source_snapshots").upsert(snapshot, { onConflict: "id", ignoreDuplicates: true });
  if (staged.error) throw new Error(`Stage refreshed snapshot: ${staged.error.message}`);
  const actual = await input.sb.from("source_snapshots").select("dataset_id,file_sha256,expected_rows,columns,ingest,quality").eq("id", id).single();
  if (actual.error) throw new Error(`Verify staged source snapshot: ${actual.error.message}`);
  for (const field of ["dataset_id", "file_sha256", "expected_rows", "columns", "ingest"] as const) {
    if (canonical(actual.data[field]) !== canonical(snapshot[field])) throw new Error(`Racing snapshot registration differs at immutable field ${field}`);
  }
  if (Boolean(actual.data.quality?.quarantined) !== Boolean(quarantineReason)) throw new Error("Racing snapshot registration has a different quarantine decision");
  return { outcome: quarantineReason ? "quarantined" : "staged", snapshotId: id, fileSha256: file.sha256,
    expectedRows: stats?.rows ?? 0, ...(quarantineReason ? { reason: quarantineReason } : {}) };
}
