import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./functions", () => ({
  listSources: vi.fn(),
  getSourceDataset: vi.fn(),
  querySourceRecords: vi.fn(),
}));

import { getSourceDataset, listSources, querySourceRecords } from "./functions";
import {
  fetchSourceDataset,
  LATEST_STALE_MS,
  normalizeRecordQuery,
  RECORD_PAGE_SIZE,
  sameRecordScope,
  sourceKeys,
  sourceQueries,
  sourceReadFailure,
} from "./queries";
import type { SourceDatasetDetail, SourceRecordPage } from "./schema";

const SNAPSHOT = "cc6fa800".padEnd(64, "0");
const FDIC = "official_01_financials_data_fdic_top500_all_native_quarterly_2000_latest_f5f72a5b7b";
const listMock = vi.mocked(listSources);
const detailMock = vi.mocked(getSourceDataset);
const recordsMock = vi.mocked(querySourceRecords);

const page = (after: number): SourceRecordPage => ({
  dataset_id: FDIC,
  snapshot_id: SNAPSHOT,
  columns: [{ key: "col0001", label: "CERT", type: "string", native_type: "number", unit: "FDIC certificate identifier" }],
  column_indices: [0],
  rows: [
    {
      row_number: after + 1,
      values: ["628"],
      entity_id: "628",
      entity_name: "JPMORGAN CHASE BANK NA",
      period: "20260630",
      geo_level: null,
      geo_code: null,
      geo_name: null,
      source_url: null,
    },
  ],
  nextCursor: after + 1,
  hasMore: true,
  total: 51_453,
});

const detail = (snapshotId: string): SourceDatasetDetail =>
  ({ dataset: { id: FDIC, latest_snapshot_id: snapshotId }, snapshot: { id: snapshotId }, file: null }) as unknown as SourceDatasetDetail;

beforeEach(() => {
  listMock.mockReset();
  detailMock.mockReset();
  recordsMock.mockReset();
});

describe("keys", () => {
  it("names one answer by one key: absent, undefined and empty arguments are the same", () => {
    expect(sourceKeys.records({ datasetId: FDIC })).toEqual(
      sourceKeys.records({ datasetId: FDIC, snapshotId: "", entity: undefined, q: "  ", after: 0, limit: RECORD_PAGE_SIZE }),
    );
    expect(sourceKeys.records({ datasetId: FDIC, entity: "628" })).not.toEqual(sourceKeys.records({ datasetId: FDIC }));
    expect(sourceKeys.dataset(FDIC)).toEqual(["sources", "dataset", FDIC, "latest"]);
    expect(sourceKeys.dataset(FDIC, SNAPSHOT)).toEqual(["sources", "dataset", FDIC, SNAPSHOT]);
    expect(sourceKeys.list({ q: "" })).toEqual(sourceKeys.list({}));
  });

  it("keeps a key equal after a JSON round trip", () => {
    const key = sourceKeys.records({ datasetId: FDIC, entity: "628", columns: [0, 7] });
    expect(JSON.parse(JSON.stringify(key))).toEqual(key);
  });

  it("puts every read of a dataset under its scope", () => {
    const scope = sourceKeys.datasetScope(FDIC);
    expect(sourceKeys.dataset(FDIC, SNAPSHOT).slice(0, scope.length)).toEqual([...scope]);
    const records = sourceKeys.recordsScope(FDIC);
    expect(sourceKeys.records({ datasetId: FDIC, period: "20260630" }).slice(0, records.length)).toEqual([...records]);
  });
});

describe("normalizeRecordQuery", () => {
  it("states the cursor and the page size and drops empty filters", () => {
    expect(normalizeRecordQuery({ datasetId: FDIC, entity: "", q: " jp ", columns: [] })).toEqual({
      datasetId: FDIC,
      snapshotId: undefined,
      entity: undefined,
      geography: undefined,
      period: undefined,
      q: "jp",
      after: 0,
      limit: RECORD_PAGE_SIZE,
      columns: undefined,
    });
  });
});

describe("factories", () => {
  it("never lets a pinned snapshot go stale and trusts the latest for five minutes", () => {
    expect(sourceQueries.dataset(FDIC, SNAPSHOT).staleTime).toBe(Infinity);
    expect(sourceQueries.dataset(FDIC).staleTime).toBe(LATEST_STALE_MS);
    expect(sourceQueries.records({ datasetId: FDIC, snapshotId: SNAPSHOT }).staleTime).toBe(Infinity);
    expect(sourceQueries.records({ datasetId: FDIC }).staleTime).toBe(LATEST_STALE_MS);
  });

  it("does not retry a read that scans or names a snapshot that may not exist (rev-app M4, S15)", () => {
    expect(sourceQueries.dataset(FDIC).retry).toBe(false);
    expect(sourceQueries.records({ datasetId: FDIC }).retry).toBe(false);
  });

  it("sends the normalised arguments and the query's abort signal", async () => {
    recordsMock.mockResolvedValue(page(0));
    const client = new QueryClient();
    await client.fetchQuery(sourceQueries.records({ datasetId: FDIC, snapshotId: SNAPSHOT, entity: "628", q: "" }));
    expect(recordsMock).toHaveBeenCalledTimes(1);
    const [call] = recordsMock.mock.calls[0] as unknown as [{ data: unknown; signal: AbortSignal }];
    expect(call.data).toEqual(normalizeRecordQuery({ datasetId: FDIC, snapshotId: SNAPSHOT, entity: "628" }));
    expect(call.signal).toBeInstanceOf(AbortSignal);
  });

  it("reads the list with its filters and the abort signal", async () => {
    listMock.mockResolvedValue({ datasets: [], total: 0, sectors: [], agencies: [] });
    const client = new QueryClient();
    await client.fetchQuery(sourceQueries.list({ sector: "01_financials", q: " fdic " }));
    const [call] = listMock.mock.calls[0] as unknown as [{ data: unknown; signal: AbortSignal }];
    expect(call.data).toEqual({ sector: "01_financials", agency: undefined, q: "fdic", after: undefined, limit: 1000 });
    expect(call.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("placeholder while the next page loads (rev-app S1)", () => {
  it("keeps the page of the same dataset and snapshot, never another table's rows", () => {
    const first = sourceKeys.records({ datasetId: FDIC, snapshotId: SNAPSHOT });
    expect(sameRecordScope(first, sourceKeys.records({ datasetId: FDIC, snapshotId: SNAPSHOT, after: 25 }))).toBe(true);
    expect(sameRecordScope(first, sourceKeys.records({ datasetId: FDIC, snapshotId: SNAPSHOT, entity: "628" }))).toBe(true);
    expect(sameRecordScope(first, sourceKeys.records({ datasetId: FDIC }))).toBe(false);
    expect(sameRecordScope(first, sourceKeys.records({ datasetId: "other", snapshotId: SNAPSHOT }))).toBe(false);
    expect(sameRecordScope(first, sourceKeys.dataset(FDIC, SNAPSHOT))).toBe(false);
  });

  it("shows the previous page as a placeholder through an observer", async () => {
    recordsMock.mockImplementation(async ({ data }) => page((data as { after: number }).after));
    const client = new QueryClient();
    const observer = new QueryObserver(client, sourceQueries.records({ datasetId: FDIC, snapshotId: SNAPSHOT }));
    const unsubscribe = observer.subscribe(() => undefined);
    await vi.waitFor(() => expect(observer.getCurrentResult().data?.rows[0].row_number).toBe(1));
    observer.setOptions(sourceQueries.records({ datasetId: FDIC, snapshotId: SNAPSHOT, after: 25 }));
    const during = observer.getCurrentResult();
    expect(during.isPlaceholderData).toBe(true);
    expect(during.data?.rows[0].row_number).toBe(1);
    await vi.waitFor(() => expect(observer.getCurrentResult().data?.rows[0].row_number).toBe(26));
    observer.setOptions(sourceQueries.records({ datasetId: "another_dataset", snapshotId: SNAPSHOT }));
    expect(observer.getCurrentResult().data).toBeUndefined();
    unsubscribe();
  });
});

describe("fetchSourceDataset (rev-app S3)", () => {
  it("files a latest read under its pinned key, so a pinned read does not download it again", async () => {
    detailMock.mockResolvedValue(detail(SNAPSHOT));
    const client = new QueryClient();
    await fetchSourceDataset(client, FDIC);
    expect(client.getQueryData(sourceKeys.dataset(FDIC, SNAPSHOT))).toEqual(detail(SNAPSHOT));
    await fetchSourceDataset(client, FDIC, SNAPSHOT);
    expect(detailMock).toHaveBeenCalledTimes(1);
  });
});

describe("sourceReadFailure", () => {
  it("names why a read failed from the database's message", () => {
    expect(sourceReadFailure(new Error("Published source dataset not found"))).toBe("not-found");
    expect(sourceReadFailure(new Error("canceling statement due to statement timeout"))).toBe("timeout");
    expect(sourceReadFailure(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }))).toBe("cancelled");
    expect(sourceReadFailure(new Error("Invalid source dataset id"))).toBe("invalid");
    expect(sourceReadFailure(new Error("connection reset"))).toBe("error");
    expect(sourceReadFailure("not found")).toBe("not-found");
    expect(sourceReadFailure(undefined)).toBe("error");
  });
});
