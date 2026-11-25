import { z } from "zod";
import type { SourceDimension, SourceFileManifest, SourceIngest, SourceRecord } from "./schema";

export const SOURCE_CHUNK_BYTES = 32 * 1024 * 1024;
export const sourceHash = z.string().regex(/^[0-9a-f]{64}$/, "Expected a lowercase SHA-256");
const nativeFilter = z.string().min(1).max(512);
const datasetId = z.string().min(1).max(1024);
export const sourceListInput = z.object({
  sector: nativeFilter.optional(), agency: nativeFilter.optional(), q: z.string().max(200).optional(),
  after: datasetId.optional(), limit: z.number().int().min(1).max(1000).default(1000),
});
export const sourceDetailInput = z.object({ id: datasetId, snapshotId: sourceHash.optional() });
export const recordInput = z.object({
  datasetId, snapshotId: sourceHash.optional(), entity: nativeFilter.optional(),
  geography: nativeFilter.optional(), period: nativeFilter.optional(), q: z.string().max(200).optional(),
  after: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  limit: z.number().int().min(1).max(100).default(50),
  columns: z.array(z.number().int().min(0).max(16383)).min(1).max(64)
    .refine(a => new Set(a).size === a.length, "Column positions must be unique").optional(),
});
const fileInput = z.object({
  sha256: sourceHash, bytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  content_type: z.string().min(1).max(200), provenance: z.record(z.unknown()).default({}),
  verified_at: z.string().nullable().optional(),
  chunks: z.array(z.object({
    index: z.number().int().min(0), path: z.string(), sha256: sourceHash,
    bytes: z.number().int().min(1).max(SOURCE_CHUNK_BYTES, "A chunk must not exceed 32 MiB"),
  })),
});
export function validateSourceFile(value: unknown): SourceFileManifest {
  const file = fileInput.parse(value);
  let bytes = 0;
  for (const [i, chunk] of file.chunks.entries()) {
    if (chunk.index !== i) throw new Error("Chunk indexes must be contiguous in file order");
    if (chunk.path !== `official/objects/${chunk.sha256}`) throw new Error("Chunk path must be its content-addressed official object");
    bytes += chunk.bytes;
  }
  if (bytes !== file.bytes) throw new Error("Chunk bytes do not equal the file length");
  return file;
}
const dimensionNames: SourceDimension[] = ["entity_id", "entity_name", "period", "geo_level", "geo_code", "geo_name", "source_url"];
const nativeDimension = z.string().nullable().default(null);
const rowInput = z.object({
  row_number: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  values: z.array(z.string().nullable()),
  entity_id: nativeDimension, entity_name: nativeDimension, period: nativeDimension,
  geo_level: nativeDimension, geo_code: nativeDimension, geo_name: nativeDimension, source_url: nativeDimension,
});
export const ingestInput = z.object({
  format: z.literal("csv"), compression: z.literal("gzip").optional(),
  encoding: z.enum(["utf-8", "windows-1252", "utf-16le"]),
  delimiter: z.string().length(1).refine(v => !/[\r\n"]/u.test(v), "Invalid CSV delimiter"),
  header_rows: z.number().int().min(0).max(100),
  dimensions: z.object(Object.fromEntries(dimensionNames.map(n => [n, z.number().int().min(0).max(16383).optional()])) as Record<SourceDimension, z.ZodOptional<z.ZodNumber>>),
  constants: z.record(z.string()).optional(), null_values: z.array(z.string()).optional(),
});
export function validateSourceRow(value: unknown, width: number): SourceRecord {
  const row = rowInput.parse(value);
  if (row.values.length !== width) throw new Error(`Source row ${row.row_number} width ${row.values.length} does not match ${width} columns`);
  return row;
}
export function projectSourceRow(values: string[], row_number: number, ingest: SourceIngest): SourceRecord {
  const nulls = new Set(ingest.null_values ?? []);
  const row = { row_number, values: values.map(v => nulls.has(v) ? null : v) } as SourceRecord;
  for (const name of dimensionNames) {
    const index = ingest.dimensions[name];
    if (index !== undefined && (index < 0 || index >= values.length)) throw new Error(`Dimension ${name} is outside the source row`);
    row[name] = index === undefined ? ingest.constants?.[name] ?? null : row.values[index];
  }
  return row;
}
