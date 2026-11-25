import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceDatasetDetail } from "@/lib/sources/schema";
import { fakeReadClient } from "./record-read.fake";
import type { DatasetSearch } from "./dataset-search";

/**
 * The table page on a small bank panel: 3 certificates x 4 quarters (12 records), plus a 60,000-row name table for
 * the bounded search. The reads of unit `reads` and the original server functions are replaced here; the direct
 * reads go through the in-memory PostgREST stand-in.
 */
const S = "a".repeat(64);
const NAMES = "c".repeat(64);
const mocks = vi.hoisted(() => ({
  detail: vi.fn(),
  facets: vi.fn(),
  rows: [] as Record<string, unknown>[],
  navigate: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => fakeReadClient({ source_records: () => mocks.rows, source_snapshots: [], source_files: [], source_datasets: [] }).from(table) },
}));
vi.mock("@/lib/sources/functions", () => ({
  getSourceDataset: (o: { data: { id: string; snapshotId?: string } }) => mocks.detail(o.data),
  listSources: vi.fn(),
  querySourceRecords: vi.fn(),
}));
vi.mock("@/lib/sources/read.functions", () => ({
  getSourcePeriodRange: async (o: { data: { datasetId: string } }) =>
    o.data.datasetId === "names"
      ? { ok: true, data: { snapshot: {}, range: null } }
      : { ok: true, data: { snapshot: {}, range: { first: { period: "20250930", row: 1 }, last: { period: "20260630", row: 12 } } } },
  getSourceEntities: async () => ({
    ok: true,
    data: { snapshot: {}, dimension: "entity", period: "20260630", periodRule: "greatest", rowsRead: 3, complete: true, entities: [{ id: "628", name: "JPMORGAN CHASE BANK NA", row: 4 }, { id: "3510", name: "BANK OF AMERICA NA", row: 8 }, { id: "7213", name: "CITIBANK NATIONAL ASSN", row: 12 }] },
  }),
  getSourceFacets: (o: { data: unknown }) => mocks.facets(o.data),
  getSnapshotStats: async () => ({ ok: false, reason: "unavailable", message: "not applied" }),
  getSourceSeries: async () => ({ ok: false, reason: "unavailable", message: "not applied" }),
  getSourceCrossSection: async () => ({ ok: false, reason: "unavailable", message: "not applied" }),
  getSourceRecord: vi.fn(),
  getFieldCompleteness: vi.fn(),
  findSources: vi.fn(),
  getLibraryWire: vi.fn(),
}));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useRouter: () => ({ navigate: mocks.navigate }),
}));

const { DatasetPage } = await import("./dataset-page");
const { SourceProvider } = await import("@/components/source/source-context");
const { TooltipProvider } = await import("@/components/ui/tooltip");

// jsdom has no ResizeObserver; the page only needs it to exist
class NoResize {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof NoResize }).ResizeObserver ??= NoResize;

const columns = [
  { key: "col0001", label: "CERT", type: "string", unit: "FDIC certificate identifier" },
  { key: "col0002", label: "REPDTE", type: "string" },
  { key: "col0003", label: "NAME", type: "string" },
  { key: "col0004", label: "ASSET", type: "string", native_type: "number", unit: "USD thousands (monetary measures)" },
];

function bankDetail(): SourceDatasetDetail {
  return {
    dataset: {
      id: "bank",
      name: "FDIC bank financial statements — all reported quarters",
      sector: "01_financials",
      agency: "FDIC",
      source_id: "BANK_TEST",
      source_url: "https://api.fdic.gov/banks/financials",
      description: "Institution-quarter observations.",
      grain: "FDIC certificate / reporting quarter",
      units: "",
      notes: "Fixed cohort.",
      latest_snapshot_id: S,
    },
    snapshot: {
      id: S,
      dataset_id: "bank",
      file_sha256: "f".repeat(64),
      source_path: "01_financials/bank.csv",
      status: "ready",
      expected_rows: 12,
      loaded_rows: 12,
      retrieved_at: "2026-11-24T10:14:39Z",
      published_at: "2026-11-25T05:47:34Z",
      created_at: "2026-11-25T05:00:00Z",
      columns,
      coverage: { entity_type: "FDIC_certificate", identity_rule: "CERT identifies the insured institution." },
      quality: { blank_counts_by_column: [0, 0, 0, 3], row_width_verified: true },
      ingest: { format: "csv", encoding: "utf-8", delimiter: ",", header_rows: 1, dimensions: { entity_id: 0, period: 1, entity_name: 2 } },
    },
    file: { sha256: "f".repeat(64), bytes: 1000, content_type: "text/csv", chunks: [], provenance: {} },
  } as unknown as SourceDatasetDetail;
}

function bankRows() {
  const certs: [string, string][] = [
    ["628", "JPMORGAN CHASE BANK NA"],
    ["3510", "BANK OF AMERICA NA"],
    ["7213", "CITIBANK NATIONAL ASSN"],
  ];
  const quarters = ["20250930", "20251231", "20260331", "20260630"];
  let n = 0;
  return certs.flatMap(([cert, name]) =>
    quarters.map((q) => {
      n += 1;
      return { snapshot_id: S, row_number: n, values: [cert, q, name, n % 4 === 0 ? "" : `${n}000`], entity_id: cert, entity_name: name, period: q, geo_level: null, geo_code: null, geo_name: null, source_url: null };
    }),
  );
}

function namesDetail(): SourceDatasetDetail {
  const d = bankDetail();
  return {
    ...d,
    dataset: { ...d.dataset, id: "names", latest_snapshot_id: NAMES },
    snapshot: { ...d.snapshot!, id: NAMES, dataset_id: "names", loaded_rows: 60_000, expected_rows: 60_000, ingest: { ...d.snapshot!.ingest, dimensions: { entity_id: 0, entity_name: 2 } } },
  } as SourceDatasetDetail;
}

function page(search: DatasetSearch, datasetId = "bank") {
  const setSearch = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <SourceProvider>
        <TooltipProvider>
          <DatasetPage datasetId={datasetId} search={search} setSearch={setSearch} />
        </TooltipProvider>
      </SourceProvider>
    </QueryClientProvider>,
  );
  return { setSearch, view };
}

beforeEach(() => {
  mocks.rows = bankRows();
  mocks.detail.mockImplementation(async (d: { id: string; snapshotId?: string }) => {
    if (d.id === "names") return namesDetail();
    if (d.id !== "bank") throw new Error("Published source dataset not found");
    if (d.snapshotId && d.snapshotId !== S) throw new Error("published source snapshot not found for this dataset");
    return bankDetail();
  });
  mocks.facets.mockResolvedValue({ ok: false, reason: "unavailable", message: "The function source_facets is not in the database yet." });
});
afterEach(() => vi.clearAllMocks());

const recordsTable = async () => {
  const section = await screen.findByRole("region", { name: "Records" }).catch(() => null);
  return section ?? (document.querySelector('[data-section="Records"]') as HTMLElement);
};

describe("the table page", () => {
  it("opens on the newest period, with the catalogue title and no em dash, and pages forward with the order written", async () => {
    const { setSearch } = page({});
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("FDIC bank financial statements, all reported quarters");
    const table = await recordsTable();
    await waitFor(() => expect(within(table).getAllByRole("button", { name: /Open record/ })).toHaveLength(12));
    const rows = within(table).getAllByRole("button", { name: /Open record/ }).map((b) => b.textContent);
    // newest period first: the three certificates of 20260630, highest row first
    expect(rows.slice(0, 3)).toEqual(["12", "8", "4"]);
    expect(within(table).getByRole("button", { name: /Next/ })).toBeDisabled();
    fireEvent.click(within(table).getByRole("button", { name: "Open record 8" }));
    expect(setSearch).toHaveBeenCalledWith({ row: 8 });
  });

  it("goes back from a page reached by a link, without a remembered trail (rev-app M3)", async () => {
    const { setSearch } = page({ after: 4, order: "file" });
    const table = await recordsTable();
    await waitFor(() => expect(within(table).getAllByRole("button", { name: /Open record/ })[0]).toHaveTextContent("5"));
    const previous = within(table).getByRole("button", { name: /Previous/ });
    expect(previous).toBeEnabled();
    fireEvent.click(previous);
    expect(setSearch).toHaveBeenCalledWith({ before: 5, after: undefined, order: "file" });
  });

  it("offers only the filters the snapshot can answer (rev-app S6)", async () => {
    page({});
    const table = await recordsTable();
    await within(table).findByRole("button", { name: /Filter by fdic certificate/i });
    expect(within(table).getByRole("button", { name: /Filter by period/ })).toBeInTheDocument();
    // no place dimension: no place input
    expect(within(table).queryByPlaceholderText("Place code or name")).toBeNull();
  });

  it("says how far a name search read, and keeps searching from there", async () => {
    mocks.rows = Array.from({ length: 60_000 }, (_, i) => ({ snapshot_id: NAMES, row_number: i + 1, values: [String(i + 1), "", "Other bank", "1"], entity_id: String(i + 1), entity_name: i + 1 === 55_000 ? "First Citizens" : "Other bank", period: null, geo_level: null, geo_code: null, geo_name: null, source_url: null }));
    const { setSearch } = page({ q: "citizens" }, "names");
    const table = await recordsTable();
    expect(await within(table).findByText(/No match up to row 50,000 of 60,000/, {}, { timeout: 15_000 })).toBeInTheDocument();
    fireEvent.click(within(table).getByRole("button", { name: /Keep searching/ }));
    expect(setSearch).toHaveBeenCalledWith({ after: 50_000, before: undefined, order: undefined });
  }, 30_000);

  it("works before migration 0069 with one quiet line, and draws records per period once the counts exist", async () => {
    const first = page({});
    expect(await screen.findByText(/Counts by period and by entity arrive with the next database update/)).toBeInTheDocument();
    first.view.unmount();
    mocks.facets.mockImplementation(async (d: { dimension: string }) =>
      d.dimension === "period"
        ? { ok: true, data: { snapshot: {}, dimension: "period", complete: true, nextAfter: null, values: ["20250930", "20251231", "20260331", "20260630"].map((value) => ({ value, label: null, rows: 3, exact: true })) } }
        : { ok: false, reason: "unavailable", message: "x" },
    );
    const { setSearch } = page({});
    const bars = await screen.findByRole("list", { name: "Records per period" });
    fireEvent.click(within(bars).getAllByRole("button")[3]);
    expect(setSearch).toHaveBeenCalledWith({ period: "20260630", after: undefined, before: undefined, row: undefined });
  });

  it("is not a dead end at a wrong address or a wrong version (rev-app S15)", async () => {
    const wrong = page({}, "nothing");
    expect(await screen.findByRole("heading", { name: "No published table at this address" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the Data library" })).toHaveAttribute("href", "/app/alt-data/library");
    wrong.view.unmount();
    const { setSearch } = page({ snapshot: "b".repeat(64) });
    fireEvent.click(await screen.findByRole("button", { name: "Open the latest version" }));
    expect(setSearch).toHaveBeenCalledWith({ snapshot: undefined, after: undefined, before: undefined, row: undefined, cols: undefined, look: undefined });
    // the read is not retried: one call for the pinned version
    expect(mocks.detail).toHaveBeenCalledTimes(2);
  });
});
