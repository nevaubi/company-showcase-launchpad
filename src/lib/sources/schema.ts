/** Native official records. Values are never parsed or scaled in this layer. */
export type SourceJson = null | boolean | number | string | SourceJson[] | { [key: string]: SourceJson };
export type SourceColumn = {
  key: string;
  label: string;
  type: string;
  /** Unit and scale describe the source's strings; they do not instruct a conversion. */
  unit?: string;
  scale?: number | string;
  basis?: string;
  title?: string;
  description?: string;
  native_type?: string;
  period_basis?: string;
  unit_evidence?: string;
};

export type SourceChunk = { index: number; path: string; sha256: string; bytes: number };
export type SourceFileManifest = {
  sha256: string;
  bytes: number;
  content_type: string;
  chunks: SourceChunk[];
  provenance: Record<string, SourceJson>;
  verified_at?: string | null;
};
export type SourceDimension = "entity_id" | "entity_name" | "period" | "geo_level" | "geo_code" | "geo_name" | "source_url";
export type SourceIngest = {
  format: "csv";
  compression?: "gzip";
  encoding: "utf-8" | "windows-1252" | "utf-16le";
  delimiter: string;
  header_rows: number;
  dimensions: Partial<Record<SourceDimension, number>>;
  constants?: Partial<Record<SourceDimension, string>>;
  /** Only explicitly declared markers become null. Without this, even an empty cell is ''. */
  null_values?: string[];
  composites?: { period?: { indices: [number, number]; separator: string; format: "year_month" } };
  geo_code_format?: "county_fips_5";
};
export type SourceSnapshotSummary = {
  id: string;
  status: "staging" | "ready" | "failed";
  expected_rows: number;
  loaded_rows: number;
  retrieved_at: string | null;
  published_at: string | null;
  coverage: Record<string, SourceJson>;
  quality: Record<string, SourceJson>;
};
export type SourceSnapshot = SourceSnapshotSummary & {
  dataset_id: string;
  file_sha256: string;
  source_path: string;
  columns: SourceColumn[];
  ingest: SourceIngest;
  created_at: string;
};
export type SourceDataset = {
  id: string;
  name: string;
  sector: string;
  agency: string;
  source_id: string | null;
  source_url: string | null;
  description: string;
  grain: string;
  units: string;
  notes: string;
  latest_snapshot_id: string | null;
  latest_snapshot?: SourceSnapshotSummary | null;
};
export type SourceDatasetDetail = { dataset: SourceDataset; snapshot: SourceSnapshot | null; file: SourceFileManifest | null };
export type SourceListFilters = { sector?: string; agency?: string; q?: string; after?: string; limit?: number };
export type SourceDatasetList = { datasets: SourceDataset[]; total: number; sectors: string[]; agencies: string[]; nextCursor?: string | null };
export type SourceRecord = {
  row_number: number;
  values: (string | null)[];
  entity_id: string | null;
  entity_name: string | null;
  period: string | null;
  geo_level: string | null;
  geo_code: string | null;
  geo_name: string | null;
  source_url: string | null;
};
export type SourceRecordQuery = {
  datasetId: string;
  snapshotId?: string;
  entity?: string;
  geography?: string;
  period?: string;
  /** Literal search of native dimension labels; does not scan every source cell. */
  q?: string;
  after?: number;
  limit?: number;
  /** Zero-based positions. Values and returned columns follow this order. Maximum 64. */
  columns?: number[];
};
export type SourceRecordPage = {
  dataset_id: string;
  snapshot_id: string;
  columns: SourceColumn[];
  column_indices: number[];
  rows: SourceRecord[];
  nextCursor: number | null;
  hasMore: boolean;
  /** Total rows in the pinned snapshot, before filters. */
  total: number;
};
export type SourceBundleManifest = {
  version: 1;
  files: SourceFileManifest[];
  datasets?: SourceDataset[];
  snapshots?: SourceSnapshot[];
};
