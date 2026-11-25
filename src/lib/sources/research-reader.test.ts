import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("./functions", () => ({ listSources: vi.fn(), getSourceDataset: vi.fn(), querySourceRecords: vi.fn() }));
vi.mock("./read.functions", () => ({}));

import { getSourceDataset, querySourceRecords } from "./functions";
import { runOfficialSourceTool } from "./research-reader";
import type { SourceDatasetDetail, SourceRecordQuery } from "./schema";

const SNAP = "a".repeat(64);
const detail = {
  dataset: { id: "fdic", name: "Institutions", sector: "01_financials", agency: "FDIC", source_id: "FDIC", source_url: null, description: "", grain: "certificate / quarter", units: "", notes: "", latest_snapshot_id: SNAP },
  snapshot: {
    id: SNAP, dataset_id: "fdic", file_sha256: "b".repeat(64), source_path: "x.csv", status: "ready", expected_rows: 2, loaded_rows: 2,
    columns: [{ key: "col0001", label: "CERT", type: "string", native_type: "number", unit: "FDIC certificate identifier" }],
    ingest: { format: "csv", encoding: "utf-8", delimiter: ",", header_rows: 1, dimensions: { entity_id: 0 } },
    retrieved_at: null, published_at: null, created_at: "2026-11-25T00:00:00Z", coverage: {}, quality: {},
  },
  file: null,
} as unknown as SourceDatasetDetail;

describe("the assistant's official-source reads go through the app cache (rev-app S3)", () => {
  it("downloads a pinned dictionary once for several tool calls", async () => {
    vi.mocked(getSourceDataset).mockResolvedValue(detail);
    vi.mocked(querySourceRecords).mockImplementation((async ({ data }: { data: SourceRecordQuery }) => ({
      dataset_id: "fdic", snapshot_id: SNAP, total: 2, columns: detail.snapshot!.columns, column_indices: [0],
      rows: [{ row_number: (data.after ?? 0) + 1, values: ["628"], entity_id: "628", entity_name: null, period: null, geo_level: null, geo_code: null, geo_name: null, source_url: null }],
      hasMore: false, nextCursor: null,
    })) as unknown as typeof querySourceRecords);
    const qc = new QueryClient();
    const args = (after: number) => ({ dataset_id: "fdic", snapshot_id: SNAP, fields: ["col0001"], after, limit: 1 });
    await runOfficialSourceTool("inspect_official_source", { dataset_id: "fdic", snapshot_id: SNAP }, qc);
    await runOfficialSourceTool("query_official_records", args(0), qc);
    await runOfficialSourceTool("query_official_records", args(1), qc);
    expect(getSourceDataset).toHaveBeenCalledTimes(1);
    expect(querySourceRecords).toHaveBeenCalledTimes(2);
    // The same page asked again is answered from the cache: the snapshot is immutable.
    await runOfficialSourceTool("query_official_records", args(1), qc);
    expect(querySourceRecords).toHaveBeenCalledTimes(2);
  });

  it("still reads without a cache", async () => {
    vi.mocked(getSourceDataset).mockClear();
    vi.mocked(getSourceDataset).mockResolvedValue(detail);
    await runOfficialSourceTool("inspect_official_source", { dataset_id: "fdic", snapshot_id: SNAP });
    await runOfficialSourceTool("inspect_official_source", { dataset_id: "fdic", snapshot_id: SNAP });
    expect(getSourceDataset).toHaveBeenCalledTimes(2);
  });
});

