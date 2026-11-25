import type { SourceDatasetDetail, SourceDatasetList, SourceListFilters, SourceRecordPage, SourceRecordQuery } from "./schema";

/** The caller's user-scoped client, never the admin client. SQL enforces RLS again. */
export type SourceReadClient = { rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }> };
async function call<T>(db: SourceReadClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}
export function readSourceDatasets(db: SourceReadClient, filters: SourceListFilters): Promise<SourceDatasetList> {
  return call(db, "source_list_datasets", { _sector: filters.sector ?? null, _agency: filters.agency ?? null,
    _q: filters.q || null, _after: filters.after ?? null, _limit: filters.limit ?? 1000 });
}
export async function readSourceDataset(db: SourceReadClient, id: string, snapshotId?: string): Promise<SourceDatasetDetail> {
  const result = await call<SourceDatasetDetail | null>(db, "source_get_dataset", { _id: id, _snapshot_id: snapshotId ?? null });
  if (!result) throw new Error("Published source dataset not found");
  return result;
}
export function readSourceRecords(db: SourceReadClient, query: SourceRecordQuery): Promise<SourceRecordPage> {
  return call(db, "source_query_records", { _dataset_id: query.datasetId, _snapshot_id: query.snapshotId ?? null,
    _entity: query.entity ?? null, _geography: query.geography ?? null, _period: query.period ?? null,
    _q: query.q || null, _after: query.after ?? 0, _limit: query.limit ?? 50, _columns: query.columns ?? null });
}
