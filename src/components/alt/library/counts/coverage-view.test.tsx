import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceFacetValue } from "@/lib/sources/read-types";
import type { SourceSnapshot } from "@/lib/sources/schema";

/**
 * "What this table holds" on three real-shaped tables: an MSHA-like state table (27 years by state), an Orange Book
 * like small table with categories, and a 60,000-record table whose fields are not counted. The reads are replaced
 * here; the charts are the real ones.
 */
const mocks = vi.hoisted(() => ({ facets: vi.fn(), categories: vi.fn(), stats: vi.fn() }));
vi.mock("@/lib/sources/read.functions", () => ({
  getSourceFacets: (o: { data: unknown }) => mocks.facets(o.data),
  getSnapshotStats: (o: { data: unknown }) => mocks.stats(o.data),
}));
vi.mock("./counts.functions", () => ({
  getCategoryCounts: (o: { data: unknown }) => mocks.categories(o.data),
  getTablePeriods: vi.fn(),
}));

const { CoverageView } = await import("../coverage-view");

class NoResize {
  observe() {}
  disconnect() {}
  unobserve() {}
}
globalThis.ResizeObserver ??= NoResize as unknown as typeof ResizeObserver;

const H = (n: number) => n.toString(16).padStart(64, "0");
const STATES = ["AK", "AL", "AR", "AZ", "CA", "CO", "KY", "PA", "TX", "WV", "WY", "US"];
const col = (key: string, title?: string) => ({ key, label: key, type: "string", ...(title ? { title } : {}) });
function snap(id: string, rows: number, columns: ReturnType<typeof col>[], dimensions: Record<string, number>, blanks?: number[]): SourceSnapshot {
  return {
    id, dataset_id: "d", status: "ready", expected_rows: rows, loaded_rows: rows, retrieved_at: null, published_at: null, coverage: {},
    quality: blanks ? { blank_counts_by_column: blanks } : {}, file_sha256: H(9), source_path: "x", created_at: "2026-11-25T00:00:00Z",
    columns, ingest: { format: "csv", encoding: "utf-8", delimiter: ",", header_rows: 1, dimensions },
  };
}
const ok = (values: SourceFacetValue[], dimension: string) => ({ ok: true, data: { snapshot: {}, dimension, values, complete: true, nextAfter: null } });
const v = (value: string, rows: number, label: string | null = null): SourceFacetValue => ({ value, label, rows, exact: true });

function mount(snapshot: SourceSnapshot, varies: { entity: boolean; geo: boolean; period: boolean }, format: "year" | "yyyy-mm" | "text" = "year") {
  const handlers = { onPeriod: vi.fn(), onEntity: vi.fn(), onGeography: vi.fn(), onOpen: vi.fn() };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const fills = snapshot.quality?.blank_counts_by_column
    ? (snapshot.quality.blank_counts_by_column as number[]).map((blank, position) => ({ position, key: snapshot.columns[position].key, label: snapshot.columns[position].label, filled: snapshot.loaded_rows - blank, blank, share: (snapshot.loaded_rows - blank) / snapshot.loaded_rows }))
    : null;
  render(
    <QueryClientProvider client={client}>
      <div className="@container">
        <CoverageView datasetId="d" snapshot={snapshot} fills={fills} columns={[0, 1]} format={format} entities={null} entityNoun={null} varies={varies} view="chart" {...handlers} />
      </div>
    </QueryClientProvider>,
  );
  return handlers;
}

beforeEach(() => {
  mocks.facets.mockReset();
  mocks.categories.mockReset().mockResolvedValue({ ok: true, data: { snapshot: {}, fields: [] } });
  mocks.stats.mockReset().mockResolvedValue({ ok: false, reason: "unavailable", message: "x" });
});

describe("What this table holds", () => {
  it("draws records per period and the state grid of an MSHA-like table, and both open their records", async () => {
    mocks.facets.mockImplementation(async (d: { dimension: string }) =>
      d.dimension === "period"
        ? ok(Array.from({ length: 27 }, (_, i) => v(String(2000 + i), 20 + i)), "period")
        : ok(STATES.map((s, i) => v(s, s === "US" ? 27 : 10 + i)), "geo_code"),
    );
    const h = mount(snap(H(1), 891, [col("year"), col("state"), col("employees")], { period: 0, geo_code: 1 }, [0, 0, 3]), { entity: false, geo: true, period: true });
    const columns = await screen.findByRole("list", { name: "Records per period" });
    const buttons = within(columns).getAllByRole("button");
    expect(buttons).toHaveLength(10);
    fireEvent.click(buttons[9]);
    expect(h.onPeriod).toHaveBeenCalledWith("2026");
    expect(screen.getByText("891 records from 2000 to 2026; most in 2026.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "All" }));
    expect(within(screen.getByRole("list", { name: "Records per period" })).getAllByRole("button")).toHaveLength(27);
    const grid = await screen.findByRole("group", { name: "Records by state" });
    fireEvent.click(within(grid).getByRole("button", { name: "Texas: 18 records" }));
    expect(h.onGeography).toHaveBeenCalledWith("TX");
    expect(screen.getByText(/27 more records are national totals/)).toBeInTheDocument();
    expect(mocks.categories).toHaveBeenCalledWith({ datasetId: "d", snapshotId: H(1), fields: [2] });
  });

  it("opens a year of a monthly table and goes back", async () => {
    const months: SourceFacetValue[] = [];
    for (let y = 1960; y <= 2024; y++) for (let m = 1; m <= 12; m++) months.push(v(`${y}-${String(m).padStart(2, "0")}`, 2));
    mocks.facets.mockImplementation(async () => ok(months, "period"));
    const h = mount(snap(H(2), 1560, [col("month"), col("value")], { period: 0 }), { entity: false, geo: false, period: true }, "yyyy-mm");
    const years = await screen.findByRole("list", { name: "Records per period" });
    const y2023 = within(years).getByRole("button", { name: "2023: 24 records in 12 periods. Opens its periods." });
    fireEvent.click(y2023);
    const back = await screen.findByRole("button", { name: /Back to years/ });
    const may = within(screen.getByRole("list", { name: "Records per period" })).getByRole("button", { name: /^May 2023/ });
    fireEvent.click(may);
    expect(h.onPeriod).toHaveBeenCalledWith("2023-05");
    fireEvent.click(back);
    expect(within(screen.getByRole("list", { name: "Records per period" })).getAllByRole("button")).toHaveLength(10);
  });

  it("draws the categories of a small table, and a value opens its first record", async () => {
    mocks.facets.mockResolvedValue({ ok: false, reason: "unavailable", message: "x" });
    mocks.categories.mockResolvedValue({
      ok: true,
      data: {
        snapshot: {},
        fields: [
          { position: 1, filled: 2462, blank: 0, missing: 0, distinct: 2, top: [{ value: "N", rows: 2382, row: 2 }, { value: "A", rows: 80, row: 1 }], otherRows: 0, otherValues: 0 },
          { position: 2, filled: 2462, blank: 0, missing: 0, distinct: 900, top: [{ value: "x", rows: 3, row: 5 }], otherRows: 2459, otherValues: 899 },
        ],
      },
    });
    const h = mount(snap(H(3), 2462, [col("Appl_No"), col("Appl_Type", "Application type"), col("Patent_No")], { entity_id: 0 }, [0, 0, 0]), { entity: true, geo: false, period: false });
    const list = await screen.findByRole("list", { name: "Records by Application type" });
    fireEvent.click(within(list).getByRole("button", { name: /Application type A: 80 records/ }));
    expect(h.onOpen).toHaveBeenCalledWith(1);
    expect(screen.queryByText("Records by Patent_No")).not.toBeInTheDocument();
    expect(screen.getByText("No period field: the records are not counted by period.")).toBeInTheDocument();
    expect(mocks.categories).toHaveBeenCalledWith({ datasetId: "d", snapshotId: H(3), fields: [1, 2] });
  });

  it("does not count the fields of a large table, and says so in one line", async () => {
    mocks.facets.mockResolvedValue({ ok: false, reason: "unavailable", message: "x" });
    mount(snap(H(4), 60000, [col("id"), col("type")], { entity_id: 0 }, [0, 0]), { entity: true, geo: false, period: false });
    expect(await screen.findByText(/Values inside the fields are counted on tables of up to 5,000 records; this one holds 60,000\./)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Counts by period and by entity arrive with the next database update.")).toBeInTheDocument());
    expect(mocks.categories).not.toHaveBeenCalled();
    expect(screen.getByRole("group", { name: /Share of records with a value/ })).toBeInTheDocument();
  });
});
