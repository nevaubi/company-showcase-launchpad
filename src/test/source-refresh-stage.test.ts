import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stageNativeRefresh, type NativeRefreshTemplate } from "../../scripts/lib/source-refresh-io";
import type { SupabaseClient } from "@supabase/supabase-js";
import { directRefreshProvenance, refreshEligibility } from "../lib/sources/refresh-plan";
import { FHFA_MASTER_REFRESH_SUPPLEMENT } from "../lib/sources/refresh-supplements";
import type { SourceFileManifest, SourceIngest } from "../lib/sources/schema";

const folders: string[] = [];
afterEach(async () => { await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true }))); });
const template: NativeRefreshTemplate = { datasetId: "test", previousSnapshotId: "old", previousFileSha256: "0".repeat(64), previousRows: 1,
  columns: [{ key: "col0001", label: "FIPS", type: "string" }, { key: "col0002", label: "Index", type: "string", unit: "index" }],
  ingest: { format: "csv", encoding: "utf-8", delimiter: ",", header_rows: 1, dimensions: { geo_code: 0 } },
  coverage: { source_ids: ["FHFA_TEST"], stale_old_row_count: 999, stale_year: 2025 } };

function client(options: {
  existingFile?: Record<string, unknown>;
  registeredRow?: (table: string, row: Record<string, unknown>) => Record<string, unknown>;
} = {}) {
  const writes: { table: string; row: Record<string, unknown> }[] = [];
  const upload = vi.fn(async () => ({ data: {}, error: null }));
  const update = vi.fn(() => { throw new Error("Refresh must not update or publish pointers"); });
  const sb = { storage: { from: () => ({ upload }) }, from(table: string) {
    const query = { select() { return query; }, eq() { return query; },
      limit: async () => ({ data: [], error: null }),
      maybeSingle: async () => ({ data: table === "source_files" ? options.existingFile ?? null : null, error: null }),
      single: async () => {
        const row = table === "source_datasets" ? { latest_snapshot_id: "old" } : [...writes].reverse().find(w => w.table === table)?.row ?? null;
        return { data: row && options.registeredRow ? options.registeredRow(table, row) : row, error: null };
      },
      upsert: async (row: Record<string, unknown>) => { writes.push({ table, row }); return { data: null, error: null }; }, update };
    return query;
  } } as unknown as SupabaseClient;
  return { sb, writes, upload, update };
}
async function localFile(contents: string) {
  const folder = await mkdtemp(join(tmpdir(), "source-refresh-test-")); folders.push(folder);
  const path = join(folder, "native.csv"); await writeFile(path, contents); return path;
}
describe("immutable refresh staging", () => {
  it("stages freshly counted exact bytes with event identity and never updates the current pointer", async () => {
    const contents = "FIPS,Index\n01001,100.00\n";
    const filePath = await localFile(contents), db = client(), gate = vi.fn(async () => undefined);
    const result = await stageNativeRefresh({ sb: db.sb, template: { ...template, ingest: { ...template.ingest, constants: { source_url: "https://fred.stlouisfed.org/graph/fredgraph.csv?id=GDP&coed=2026-11-24" } } },
      filePath, retrievedAt: "2026-11-25T12:00:00Z", provenance: { fixture: true }, sourceUrl: "https://fred.stlouisfed.org/graph/fredgraph.csv?id=GDP&coed=2026-11-25",
      freshCoverage: { reporting_institutions: 1 }, signal: new AbortController().signal, gate });
    expect(result.outcome).toBe("staged");
    const sha = createHash("sha256").update(contents).digest("hex");
    expect(result.snapshotId).toBe(createHash("sha256").update(`test:${sha}:source-1:2026-11-25T12:00:00Z`).digest("hex"));
    const snapshot = db.writes.find(w => w.table === "source_snapshots")!.row;
    expect(snapshot.expected_rows).toBe(1);
    expect(snapshot.status).toBe("staging");
    expect(snapshot.coverage).toMatchObject({ reporting_institutions: 1 });
    expect(snapshot.coverage).not.toHaveProperty("stale_old_row_count");
    expect(snapshot.ingest).toMatchObject({ constants: { source_url: "https://fred.stlouisfed.org/graph/fredgraph.csv?id=GDP&coed=2026-11-25" } });
    expect(db.update).not.toHaveBeenCalled();
    expect(gate).toHaveBeenCalledWith("source-refresh-chunk-upload");
    expect(gate).toHaveBeenCalledWith("source-refresh-snapshot-register");
  });
  it("keeps changed headers quarantined with fresh columns and no copied index unit", async () => {
    const filePath = await localFile("FIPS,Price\n01001,100.00\n"), db = client();
    const result = await stageNativeRefresh({ sb: db.sb, template, filePath, retrievedAt: "2026-11-25T12:00:00Z", provenance: {}, signal: new AbortController().signal });
    expect(result.outcome).toBe("quarantined");
    const snapshot = db.writes.find(w => w.table === "source_snapshots")!.row;
    expect(snapshot.status).toBe("failed");
    expect(snapshot.quality).toMatchObject({ quarantined: true, header_matches_previous: false, expected_row_count_known: true });
    expect(snapshot.columns).toEqual([{ key: "col0001", label: "FIPS", type: "string" }, { key: "col0002", label: "Price", type: "string" }]);
    expect(db.update).not.toHaveBeenCalled();
  });
  it("does not stage or upload an unchanged current source", async () => {
    const contents = "FIPS,Index\n01001,100.00\n", filePath = await localFile(contents), db = client();
    const result = await stageNativeRefresh({ sb: db.sb, template: { ...template, previousFileSha256: createHash("sha256").update(contents).digest("hex") },
      filePath, retrievedAt: "2026-11-25T12:00:00Z", provenance: {}, signal: new AbortController().signal });
    expect(result.outcome).toBe("unchanged"); expect(db.writes).toEqual([]); expect(db.upload).not.toHaveBeenCalled();
  });
  it("records a new A-to-B-to-A event without overwriting the old hash-based file provenance", async () => {
    const contents = "FIPS,Index\n01001,100.00\n", filePath = await localFile(contents);
    const sha = createHash("sha256").update(contents).digest("hex");
    const db = client({ existingFile: { sha256: sha, bytes: Buffer.byteLength(contents),
      chunks: [{ index: 0, path: `official/objects/${sha}`, sha256: sha, bytes: Buffer.byteLength(contents) }],
      provenance: { retrieved_at: "2020-01-01T00:00:00Z", immutable_original: true } } });
    const result = await stageNativeRefresh({ sb: db.sb, template, filePath, retrievedAt: "2026-11-25T12:00:00Z", provenance: { new_retrieval: true }, signal: new AbortController().signal });
    expect(result.outcome).toBe("staged");
    expect(db.writes.map(write => write.table)).toEqual(["source_snapshots"]);
    expect(db.upload).not.toHaveBeenCalled();
    expect(db.writes[0].row.coverage).toMatchObject({ refresh_provenance: { new_retrieval: true } });
  });
  it.each(["source_files", "source_snapshots"])("rejects a racing conflicting immutable %s registration", async (table) => {
    const filePath = await localFile("FIPS,Index\n01001,100.00\n");
    const db = client({ registeredRow: (actualTable, row) => actualTable !== table ? row
      : table === "source_files" ? { ...row, bytes: 999 } : { ...row, expected_rows: 999 } });
    await expect(stageNativeRefresh({ sb: db.sb, template, filePath, retrievedAt: "2026-11-25T12:00:00Z", provenance: {}, signal: new AbortController().signal }))
      .rejects.toThrow(/Racing/);
    expect(db.update).not.toHaveBeenCalled();
  });
  it("allows fresh omission evidence without letting adapter metadata change quarantine decisions", async () => {
    const filePath = await localFile("FIPS,Price\n01001,100.00\n"), db = client();
    const result = await stageNativeRefresh({ sb: db.sb, template, filePath, retrievedAt: "2026-11-25T12:00:00Z", provenance: {},
      freshQuality: { requested_field_count: 3, returned_field_count: 2, requested_but_not_returned_fields: ["legacy"],
        requested_but_not_returned_count: 1, omission_verified: true, quarantined: false, header_matches_previous: true, expected_row_count_known: false },
      signal: new AbortController().signal });
    expect(result.outcome).toBe("quarantined");
    expect(db.writes.find(w => w.table === "source_snapshots")?.row.quality).toMatchObject({
      requested_field_count: 3, returned_field_count: 2, requested_but_not_returned_fields: ["legacy"],
      requested_but_not_returned_count: 1, omission_verified: true, quarantined: true, header_matches_previous: false, expected_row_count_known: true,
    });
  });
  it("retains supplemental original evidence on a new file/snapshot and then uses ordinary direct provenance", async () => {
    const proof = FHFA_MASTER_REFRESH_SUPPLEMENT;
    const baselineFile = { sha256: proof.original_file_sha256, provenance: {} };
    const eligible = refreshEligibility(baselineFile, proof.expected_ingest, new Date("2026-11-25"), proof.dataset_id);
    if (!eligible.eligible) throw new Error("Pinned baseline fixture was not eligible");
    const provenance = directRefreshProvenance(baselineFile, eligible, { url: proof.direct_url, resolvedUrl: proof.direct_url });
    const headers = "hpi_type,hpi_flavor,frequency,level,place_name,place_id,yr,period,index_nsa,index_sa,rstderr,note";
    const filePath = await localFile(`${headers}\ntraditional,all-transactions,quarterly,State,Alabama,01,2026,2,337.12,,,\n`), db = client();
    const result = await stageNativeRefresh({ sb: db.sb, template: { ...template, datasetId: proof.dataset_id,
      previousFileSha256: proof.original_file_sha256, ingest: proof.expected_ingest,
      columns: headers.split(",").map((label, i) => ({ key: `col${String(i + 1).padStart(4, "0")}`, label, type: "string" })) },
      filePath, retrievedAt: "2026-11-25T12:00:00Z", provenance, sourceUrl: proof.direct_url, signal: new AbortController().signal });
    expect(result.outcome).toBe("staged");
    const newFile = db.writes.find(w => w.table === "source_files")!.row as SourceFileManifest;
    const snapshot = db.writes.find(w => w.table === "source_snapshots")!.row;
    expect(newFile.sha256).not.toBe(proof.original_file_sha256);
    expect(newFile.provenance).toMatchObject({ direct_url: proof.direct_url, direct_download_sha256_verified: true,
      supplemental_original_download_evidence: proof });
    expect(snapshot.coverage).toMatchObject({ refresh_provenance: { supplemental_original_download_evidence: proof } });
    // The new file no longer matches the exception. Its own exact-download proof is sufficient.
    const next = refreshEligibility(newFile, snapshot.ingest as SourceIngest, new Date("2026-12-02"));
    expect(next).toMatchObject({ eligible: true, family: "fhfa", url: proof.direct_url });
    expect(next).not.toHaveProperty("supplementalProof");
    if (next.eligible) expect(directRefreshProvenance(newFile, next, { url: proof.direct_url, resolvedUrl: proof.direct_url }))
      .toMatchObject({ supplemental_original_download_evidence: proof });
    expect(baselineFile.provenance).toEqual({});
    expect(db.update).not.toHaveBeenCalled();
  });
});
