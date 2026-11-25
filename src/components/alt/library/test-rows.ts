// Small slim rows for the library helpers' tests, shaped like `getLibrary()`'s (unit `reads`).
import type { SourceLibrary, SourceLibraryRow } from "@/lib/sources/read-types";

export function libRow(patch: Partial<SourceLibraryRow> & Pick<SourceLibraryRow, "id">): SourceLibraryRow {
  return {
    title: patch.id,
    code: null,
    storedName: null,
    publisherId: "fdic",
    collectionId: "01_financials",
    kind: "native",
    parentId: null,
    sector: patch.collectionId ?? "01_financials",
    agency: "Federal Deposit Insurance Corporation",
    sourceId: null,
    grain: "One row per institution and quarter",
    rows: 100,
    fields: 10,
    publishedAt: "2026-11-25T05:30:00Z",
    retrievedAt: "2026-11-24T20:00:00Z",
    dimensions: ["entity_id", "period"],
    versions: 1,
    refreshFamily: null,
    hidden: false,
    ...patch,
  };
}

export function lib(datasets: SourceLibraryRow[], patch: Partial<SourceLibrary> = {}): SourceLibrary {
  return {
    totals: { datasets: datasets.length, hiddenDatasets: 0, publishers: 0, rows: 0, fields: 0, newestPublication: null, refreshable: 0 },
    collections: [],
    publishers: [],
    changes: [],
    datasets,
    via: "direct",
    builtAt: "2026-11-25T13:00:00Z",
    ...patch,
  };
}
