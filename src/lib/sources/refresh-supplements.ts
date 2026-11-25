/** Reviewed retrieval evidence omitted from an immutable canonical file by alias deduplication.
 * This is an exact baseline exception, never an alternate user-provided URL registry.
 */
import type { SourceIngest } from "./schema";

export const FHFA_MASTER_REFRESH_SUPPLEMENT = {
  version: 1,
  id: "fhfa_master_original_download_2026_11_24_v1",
  dataset_id: "official_11_real_estate_hpi_master_all_0755e8292e",
  original_file_sha256: "5b60e562c74211475d6bad8f59d24c74316f31f956d922f6e9d97065393b0feb",
  direct_url: "https://www.fhfa.gov/hpi/download/monthly/hpi_master.csv",
  expected_ingest: {
    format: "csv", encoding: "utf-8", delimiter: ",", header_rows: 1,
    dimensions: { period: 6, geo_code: 5, geo_level: 3, geo_name: 4 },
    constants: { source_url: "https://www.fhfa.gov/data/hpi/datasets" },
  },
  evidence: {
    artifact_path: "sector_data/11_real_estate/workbook_final_portable.json",
    artifact_sha256: "398cdcdad667cfe92f369c6a4818225f383c49fe6eb5f89c09b88fe71d598bce",
    record: 'raw_files[path="11_real_estate/raw/hpi_master.csv"]',
    original_source_path: "11_real_estate/raw/hpi_master.csv",
    original_retrieved_at: "2026-11-24T09:59:18.460907+00:00",
    original_bytes: 17157179,
    expected_ingest_sha256: "56ad1d31e9050cf95581395c11adb6f54a345aa5f48e4b1a58ce5a150793a34c",
    reason: "The canonical hpi_master_all.csv and retained raw download are byte-identical; alias deduplication omitted the raw retrieval record from the registered file provenance.",
  },
} as const;

export type SupplementalRefreshProof = typeof FHFA_MASTER_REFRESH_SUPPLEMENT;

/** Structural JSON equality tolerates key order only; extra keys and null policies differ. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function supplementalRefreshProof(datasetId: string | undefined, fileSha256: string | undefined,
  ingest: SourceIngest): SupplementalRefreshProof | null {
  const contract = FHFA_MASTER_REFRESH_SUPPLEMENT;
  if (datasetId !== contract.dataset_id || fileSha256 !== contract.original_file_sha256
      || canonical(ingest) !== canonical(contract.expected_ingest)) return null;
  return structuredClone(contract);
}
