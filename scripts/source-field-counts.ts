/**
 * Field counts of published source snapshots (migration 0070), computed once per snapshot from its stored file with
 * the importer's own reader and row projection (scripts/lib/source-field-counts.ts). The official-source worker runs
 * it when FIELD_COUNTS_ENABLED=1 (scripts/lib/field-counts-step.ts):
 *   bun scripts/source-field-counts.ts --all --max-snapshots=25 --max-bytes=2147483648 --max-runtime-seconds=420 [--skip=<id>,<id>]
 *   bun scripts/source-field-counts.ts --snapshot=<sha256>    one published snapshot, counted again even when complete
 * --receipt=<file> (the worker passes it): what the run did, as JSON, for job_runs; written before each snapshot, so
 * the receipt of a stopped run names the snapshot it was counting, and at the end.
 * Reads source_snapshots, source_files, source_field_counts and the snapshot's objects in the datasets bucket as the
 * service role, writes source_field_counts only, and never reads source_records. It exits 0 when it ran: a snapshot that
 * failed is in the receipt (`failed`, `error`), never a failed run of the import lane.
 */
import type { SourceFileManifest, SourceSnapshot } from "../src/lib/sources/schema";
import { writeRunReceipt } from "./lib/run-receipt";
import { runFieldCounts, type FieldCountsCandidate, type FieldCountsStore } from "./lib/source-field-counts";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, "").split("=");
  return [k, v.join("=") || "true"];
}));
if ((!args.all && !args.snapshot) || (args.all && args.snapshot)) throw new Error("Use exactly one of --all or --snapshot=<sha256>");
if (args.snapshot && !/^[0-9a-f]{64}$/.test(args.snapshot)) throw new Error("Invalid snapshot SHA-256");
const maxSnapshots = Number(args["max-snapshots"] ?? (args.snapshot ? 1 : 25));
const maxBytes = Number(args["max-bytes"] ?? 2 * 1024 ** 3);
const seconds = Number(args["max-runtime-seconds"] ?? 420);
const skip = new Set((args.skip && args.skip !== "true" ? args.skip : "").split(",").filter(Boolean));
if (!Number.isSafeInteger(maxSnapshots) || maxSnapshots < 1 || maxSnapshots > 1000 || !Number.isSafeInteger(maxBytes) || maxBytes < 1
    || !Number.isFinite(seconds) || seconds < 15 || seconds > 7200 || [...skip].some((id) => !/^[0-9a-f]{64}$/.test(id)))
  throw new Error("Invalid field counts bounds");
// A single stalled transfer must leave time for the worker's 480-second window.
process.env.DB_FETCH_TIMEOUT_MS ??= "60000";
process.env.DB_STORAGE_TIMEOUT_MS ??= "90000";
const { sb, dbGate } = await import("./lib/supa");
const deadline = Date.now() + seconds * 1000;
const log = (data: Record<string, unknown>) => console.log(JSON.stringify(data));
/** A database error as an Error that keeps its code, so a missing table is told apart from a failure. */
const failure = (e: { code?: string; message: string }) => Object.assign(new Error(e.message), { code: e.code });
const SNAPSHOT_COLUMNS = "id,dataset_id,file_sha256,source_path,status,expected_rows,loaded_rows,retrieved_at,published_at,coverage,quality,columns,ingest,created_at";
type Listed = { id: string; column_count: number; file: { bytes: number } | null; source_field_counts: { position: number }[] | null };

const store: FieldCountsStore = {
  async pending() {
    await dbGate("official-field-counts");
    const probe = await sb.from("source_field_counts").select("snapshot_id").limit(1);
    if (probe.error) throw failure(probe.error);
    const out: FieldCountsCandidate[] = [];
    // published snapshots with the row of their last field, if any, newest first: ids and sizes only, paged
    for (let from = 0; from < 50_000; from += 1000) {
      let q = sb.from("source_snapshots").select("id,column_count,file:source_files(bytes),source_field_counts(position)").eq("status", "ready");
      if (args.snapshot) q = q.eq("id", args.snapshot);
      const page = await q
        .order("published_at", { ascending: false, nullsFirst: false })
        .order("id")
        .order("position", { referencedTable: "source_field_counts", ascending: false })
        .limit(1, { referencedTable: "source_field_counts" })
        .range(from, from + 999);
      if (page.error) throw failure(page.error);
      const rows = (page.data ?? []) as unknown as Listed[];
      for (const r of rows) {
        const last = r.source_field_counts?.[0]?.position;
        if (!args.snapshot && last === r.column_count - 1) continue;
        out.push({ id: r.id, bytes: Number(r.file?.bytes ?? 0) });
      }
      if (rows.length < 1000) break;
    }
    return out;
  },
  async load(id) {
    await dbGate("official-field-counts");
    const s = await sb.from("source_snapshots").select(SNAPSHOT_COLUMNS).eq("id", id).eq("status", "ready").single();
    if (s.error || !s.data) throw new Error(`Snapshot ${id.slice(0, 12)} unavailable: ${s.error?.message ?? "missing"}`);
    const snapshot = s.data as unknown as SourceSnapshot;
    const f = await sb.from("source_files").select("sha256,bytes,content_type,chunks,provenance,verified_at").eq("sha256", snapshot.file_sha256).single();
    if (f.error || !f.data) throw new Error(`Source manifest unavailable: ${f.error?.message ?? "missing"}`);
    return { snapshot, file: f.data as unknown as SourceFileManifest };
  },
  async readChunk(chunk) {
    await dbGate("official-field-counts-download");
    const result = await sb.storage.from("datasets").download(chunk.path);
    if (result.error || !result.data) throw new Error(`Source chunk ${chunk.index} download failed: ${result.error?.message ?? "empty response"}`);
    return new Uint8Array(await result.data.arrayBuffer());
  },
  async put(rows) {
    await dbGate("official-field-counts-store");
    const computed_at = new Date().toISOString();
    const { error } = await sb.from("source_field_counts").upsert(rows.map((r) => ({ ...r, computed_at })), { onConflict: "snapshot_id,position" });
    if (error) throw failure(error);
  },
};

const receipt = await runFieldCounts(store, {
  maxSnapshots,
  maxBytes,
  deadline,
  skip,
  progress: (partial) => writeRunReceipt(args.receipt, partial),
  log,
});
log({ event: "field_counts_finished", counted: receipt.items, failed: receipt.failed.length, left: receipt.left, skipped: receipt.skipped,
  bytes: receipt.bytes, ...(receipt.stopped ? { stopped: receipt.stopped } : {}), ...(receipt.not_installed ? { not_installed: true } : {}),
  ...(receipt.error ? { error: receipt.error } : {}) });
writeRunReceipt(args.receipt, receipt);
