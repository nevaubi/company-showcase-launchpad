/**
 * Register a reviewed bundle after its exact objects have been uploaded.
 *   bun scripts/source-register.ts --manifest=/tmp/manifest.json --expect-project=gdhfpihswzvelbmmrzmm
 * Metadata registration never publishes rows, resets a current pointer, or overwrites an existing
 * snapshot. Native records become readable only through the importer's atomic publish operation.
 */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { validateSourceFile, ingestInput } from "../src/lib/sources/validation";
import type { SourceBundleManifest } from "../src/lib/sources/schema";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [key, ...value] = a.replace(/^--/, "").split("=");
    return [key, value.join("=") || "true"];
  }),
);
if (!args.manifest) throw new Error("--manifest=<reviewed bundle JSON> is required");
const body = await readFile(args.manifest, "utf8");
const manifest = JSON.parse(body) as SourceBundleManifest;
if (
  manifest.version !== 1 ||
  !Array.isArray(manifest.files) ||
  !Array.isArray(manifest.datasets) ||
  !Array.isArray(manifest.snapshots)
) {
  throw new Error("Expected bundle version 1 with files, datasets and snapshots");
}
const files = manifest.files.map(validateSourceFile);
const hashes = new Set(files.map((f) => f.sha256));
if (hashes.size !== files.length) throw new Error("Duplicate file identity in bundle");
const datasets = new Set(manifest.datasets.map((d) => d.id));
if (datasets.size !== manifest.datasets.length)
  throw new Error("Duplicate dataset identity in bundle");
const ids = new Set<string>();
for (const s of manifest.snapshots) {
  const id = createHash("sha256").update(`${s.dataset_id}:${s.file_sha256}:source-1`).digest("hex");
  if (s.id !== id || ids.has(id))
    throw new Error("Invalid or duplicate immutable snapshot identity");
  ids.add(id);
  if (!datasets.has(s.dataset_id) || !hashes.has(s.file_sha256))
    throw new Error("Bundle has an unresolved dataset/file reference");
  if (
    !Number.isSafeInteger(s.expected_rows) ||
    s.expected_rows < 0 ||
    !s.columns?.length ||
    s.columns.length > 16384
  )
    throw new Error("Invalid source shape");
  const names = new Set(s.columns.map((c) => c.key));
  if (
    names.size !== s.columns.length ||
    s.columns.some((c) => !c.key || typeof c.label !== "string" || typeof c.type !== "string")
  )
    throw new Error("Invalid column dictionary");
  ingestInput.parse(s.ingest);
  const quarantined =
    s.status === "failed" &&
    s.quality?.quarantined === true &&
    typeof s.quality?.quarantine_reason === "string";
  if ((s.status !== "staging" && !quarantined) || s.loaded_rows !== 0 || s.published_at != null)
    throw new Error("A registration manifest cannot claim publication");
}
const summary = {
  manifest_sha256: createHash("sha256").update(body).digest("hex"),
  files: files.length,
  datasets: datasets.size,
  snapshots: ids.size,
  quarantined: manifest.snapshots.filter((s) => s.status === "failed").length,
  expected_rows: manifest.snapshots.reduce((n, s) => n + s.expected_rows, 0),
};
if (args["dry-run"] === "true") {
  console.log(JSON.stringify({ ...summary, dry_run: true }));
  process.exit(0);
}
const project = new URL(process.env.SUPABASE_URL ?? "http://missing").hostname.split(".")[0];
if (!args["expect-project"] || project !== args["expect-project"])
  throw new Error("Configured backend does not match --expect-project");
const { sb, dbGate } = await import("./lib/supa");

async function insert(table: string, rows: unknown[], conflict: string, size: number) {
  for (let i = 0; i < rows.length; i += size) {
    await dbGate("source-register");
    const result = await sb
      .from(table)
      .upsert(rows.slice(i, i + size), { onConflict: conflict, ignoreDuplicates: true });
    if (result.error)
      throw new Error(`Could not register ${table} batch ${i}: ${result.error.message}`);
  }
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
// Retry only the same immutable definitions. A hash match alone must not silently reuse a
// different delimiter, field order or dimension projection under an existing snapshot identity.
async function checkExisting(
  table: string,
  rows: Record<string, unknown>[],
  key: string,
  fields: string[],
) {
  for (let i = 0; i < rows.length; i += 20) {
    await dbGate("source-register-compare");
    const batch = rows.slice(i, i + 20);
    const current = await sb
      .from(table)
      .select([key, ...fields].join(","))
      .in(
        key,
        batch.map((r) => r[key]),
      );
    if (current.error)
      throw new Error(`Could not compare existing ${table}: ${current.error.message}`);
    const expected = new Map(batch.map((r) => [r[key], r]));
    for (const value of (current.data ?? []) as unknown as Record<string, unknown>[]) {
      const wanted = expected.get(value[key])!;
      for (const field of fields)
        if (canonical(value[field]) !== canonical(wanted[field])) {
          throw new Error(
            `Immutable ${table} definition differs at ${String(value[key])}, field ${field}; use a new parser version after review`,
          );
        }
    }
  }
}
await checkExisting("source_files", files, "sha256", ["bytes", "chunks"]);
await checkExisting("source_snapshots", manifest.snapshots, "id", [
  "dataset_id",
  "file_sha256",
  "expected_rows",
  "columns",
  "ingest",
]);
await insert(
  "source_files",
  files.map((f) => ({ ...f, verified_at: null })),
  "sha256",
  50,
);
await insert(
  "source_datasets",
  manifest.datasets.map(({ latest_snapshot, latest_snapshot_id, ...d }) => ({
    ...d,
    latest_snapshot_id: null,
  })),
  "id",
  50,
);
// A dictionary can have thousands of columns. Keep each request bounded by byte length, not just rows.
let batch: unknown[] = [];
let bytes = 0;
for (const s of manifest.snapshots) {
  const row = {
    id: s.id,
    dataset_id: s.dataset_id,
    file_sha256: s.file_sha256,
    source_path: s.source_path,
    retrieved_at: s.retrieved_at,
    status: s.status,
    expected_rows: s.expected_rows,
    loaded_rows: 0,
    columns: s.columns,
    coverage: s.coverage,
    quality: s.quality,
    ingest: s.ingest,
    ...(s.status === "failed"
      ? { last_error: String(s.quality.quarantine_reason).slice(0, 1000) }
      : {}),
  };
  const length = Buffer.byteLength(JSON.stringify(row));
  if (batch.length && (bytes + length > 2 * 1024 * 1024 || batch.length >= 50)) {
    await insert("source_snapshots", batch, "id", 50);
    batch = [];
    bytes = 0;
  }
  batch.push(row);
  bytes += length;
}
if (batch.length) await insert("source_snapshots", batch, "id", 50);
// A second comparison closes the check-then-insert race with a concurrent registration.
await checkExisting("source_files", files, "sha256", ["bytes", "chunks"]);
await checkExisting("source_snapshots", manifest.snapshots, "id", [
  "dataset_id",
  "file_sha256",
  "expected_rows",
  "columns",
  "ingest",
]);
// Successful registration is distinct from successful ingestion. The publication pointer is untouched.
console.log(JSON.stringify({ ...summary, registered: true, published_by_this_step: false }));
