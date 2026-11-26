import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { LookCrossRead } from "@/lib/sources/boards/board.functions";
import { GRID_PLACES } from "@/lib/sources/geo/us-states";
import { defineProfile } from "@/lib/sources/profiles/define";
import type { MeasureSpec, Profile, ProfileProof } from "@/lib/sources/profiles";
import type { SourceColumn, SourceIngest, SourceSnapshot } from "@/lib/sources/schema";
import { PlaceView } from "./place-view";
import { RankingView } from "./ranking-view";
import { CompareView } from "./series-view";

/**
 * The table pages' first looks that draw the forms of round 6: the state grid beside the ranking when the places are
 * states, the ranking of a table without a period dimension (read whole, dated by its retrieval), and several series
 * of one unit on one chart. The server reads are answered here with the shapes they return.
 */

const mocks = vi.hoisted(() => ({
  cross: [] as { period: string; by: string; field: string }[],
  crossAnswer: null as unknown,
  series: [] as { address: unknown; field: number }[],
  seriesAnswer: (_input: { address: unknown; field: number }): unknown => null,
}));

vi.mock("@/lib/sources/boards/board.functions", () => ({
  getLookCross: async ({ data }: { data: { period: string; by: string; field: string } }) => {
    mocks.cross.push(data);
    return mocks.crossAnswer;
  },
  getBoard: vi.fn(),
}));
vi.mock("@/lib/sources/read.functions", () => ({
  getSourceSeries: async ({ data }: { data: { address: unknown; field: number } }) => {
    mocks.series.push(data);
    return mocks.seriesAnswer(data);
  },
  getSourcePeriodRange: vi.fn(),
  getSourceEntities: vi.fn(),
  getSourceFacets: vi.fn(),
  getSnapshotStats: vi.fn(),
  getSourceCrossSection: vi.fn(),
  getSourceRecord: vi.fn(),
  getFieldCompleteness: vi.fn(),
  findSources: vi.fn(),
  getLibraryWire: vi.fn(),
}));

beforeAll(() => {
  // jsdom has no layout: the charts' size observer only needs to exist.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(() => {
  cleanup();
  mocks.cross.length = 0;
  mocks.series.length = 0;
});

const proof: ProfileProof = { snapshotId: "s", datasetId: "d", checked: "2026-11-26", documentation: ["https://example.gov/file"] };
const col = (label: string, i: number, extra: Partial<SourceColumn> = {}): SourceColumn => ({ key: `c${i}`, label, type: "string", ...extra });
const snapshot = (id: string, columns: SourceColumn[], dimensions: SourceIngest["dimensions"], rows: number): SourceSnapshot => ({
  id,
  status: "ready",
  expected_rows: rows,
  loaded_rows: rows,
  retrieved_at: "2026-11-25T06:00:00Z",
  published_at: "2026-11-25T06:10:00Z",
  coverage: {},
  quality: {},
  dataset_id: "d",
  file_sha256: "0".repeat(64),
  source_path: "x",
  columns,
  ingest: { format: "csv", encoding: "utf-8", delimiter: ",", header_rows: 1, dimensions },
  created_at: "2026-11-25T06:10:00Z",
});
const wrap = (node: ReactNode) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>;

describe("the places first look", () => {
  // a state table as EPA's eGRID keeps it: one record per state, the two-digit FIPS code as the place, the year as period
  const measure: MeasureSpec = { field: "STNGENAN", label: "State annual net generation", unit: { from: "constant", text: "MWh", evidence: "https://example.gov/file" }, grouping: "none" };
  const profile: Profile = defineProfile(() => true, {
    family: "test-state",
    entityNoun: { one: "state", many: "states" },
    period: { from: "dimension", format: "year" },
    cadence: "year",
    measures: [measure],
    addressing: { by: "geo_code", where: [], scan: "key", rowsScanned: 1, note: "one record a state" },
    defaultSeries: () => null,
    firstLook: "places",
    proof,
  });
  const snap = snapshot("state-snap", [col("YEAR", 0), col("FIPSST", 1), col("STNGENAN", 2)], { period: 0, geo_code: 1 }, 52);
  const cells = GRID_PLACES.map((p, i) => ({ row: i + 1, key: p.fips, name: null, period: "2023", text: String(1000 * (i + 1)) }));

  it("draws every state on the grid beside the ranked bars, named from the FIPS codes", async () => {
    mocks.crossAnswer = { ok: true, data: { snapshotId: "state-snap", period: "2023", format: "year", table: false, cells, skipped: [], retrieved: "25 Nov 2026" } } satisfies LookCrossRead;
    const { container } = render(
      wrap(<PlaceView datasetId="d" collection="05_utilities" snapshot={snap} profile={profile} measure={measure} top={15} setTop={() => undefined} view="chart" onOpen={() => undefined} />),
    );
    await waitFor(() => expect(container.querySelector('[data-section="State grid"]')).not.toBeNull());
    expect(mocks.cross[0]).toMatchObject({ period: "latest", by: "geo_code", field: "STNGENAN" });
    const grid = screen.getByRole("group", { name: "State annual net generation by state, 2023" });
    expect(grid.querySelectorAll("button")).toHaveLength(51);
    const last = GRID_PLACES[GRID_PLACES.length - 1];
    expect(screen.getByRole("button", { name: `${last.name}: ${(1000 * GRID_PLACES.length).toLocaleString("en-US")} MWh, 2023` })).toBeTruthy();
    // the ranking stays beside the grid
    expect(screen.getByText(new RegExp(`^${last.name} had the largest State annual net generation of 51 states in 2023`))).toBeTruthy();
  });

  it("keeps a ranked list alone when the places are not states", async () => {
    const counties = Array.from({ length: 12 }, (_, i) => ({ row: i + 1, key: `county ${i + 1}`, name: `County ${i + 1}`, period: "2023", text: String(10 + i) }));
    mocks.crossAnswer = { ok: true, data: { snapshotId: "state-snap", period: "2023", format: "year", table: false, cells: counties, skipped: [], retrieved: "25 Nov 2026" } } satisfies LookCrossRead;
    const { container } = render(
      wrap(<PlaceView datasetId="d" collection="05_utilities" snapshot={snap} profile={profile} measure={measure} top={15} setTop={() => undefined} view="chart" onOpen={() => undefined} />),
    );
    await waitFor(() => expect(container.querySelector('[data-section="Ranking"]')).not.toBeNull());
    expect(container.querySelector('[data-section="State grid"]')).toBeNull();
  });
});

describe("the ranking first look of a table without a period dimension", () => {
  // a list as the FDIC's failures table keeps it: one record per failed bank, the year in a field, no period index
  const measure: MeasureSpec = { field: "COST", label: "Estimated loss", unit: { from: "constant", text: "Thousands of US Dollars", evidence: "https://example.gov/file" }, grouping: "none" };
  const profile: Profile = defineProfile(() => true, {
    family: "test-failures",
    entityNoun: { one: "failed institution", many: "failed institutions" },
    period: { from: "field", field: "FAILYR", format: "year" },
    measures: [measure],
    addressing: { by: "entity_id", where: [], scan: "key", rowsScanned: 1, note: "one record a failure" },
    defaultSeries: () => null,
    firstLook: "ranking",
    proof,
  });
  const snap = snapshot("failures-snap", [col("CERT", 0), col("NAME", 1), col("FAILYR", 2), col("COST", 3)], { entity_id: 0, entity_name: 1 }, 4);

  it("reads the whole table and dates the ranking by the day it was retrieved", async () => {
    const cells = [
      { row: 1, key: "1", name: "First Bank", period: null, text: "1200" },
      { row: 2, key: "2", name: "Second Bank", period: null, text: "45000" },
      { row: 3, key: "3", name: "Third Bank", period: null, text: "300" },
      { row: 4, key: "4", name: "Fourth Bank", period: null, text: "" },
    ];
    mocks.crossAnswer = { ok: true, data: { snapshotId: "failures-snap", period: null, format: null, table: true, cells, skipped: [], retrieved: "25 Nov 2026" } } satisfies LookCrossRead;
    const { container } = render(
      wrap(<RankingView datasetId="d" collection="01_financials" snapshot={snap} profile={profile} measure={measure} top={15} setTop={() => undefined} view="chart" onOpen={() => undefined} />),
    );
    await waitFor(() => expect(container.querySelector('[data-section="Ranking"]')).not.toBeNull());
    expect(mocks.cross[0]).toMatchObject({ period: "table", by: "entity_id", field: "COST" });
    const headline = container.querySelector('[data-section="Ranking"] p')?.textContent ?? "";
    expect(headline).toMatch(/^Second Bank had the largest Estimated loss of 3 failed institutions/);
    expect(headline).toContain("25 Nov 2026");
    expect(container.textContent).toContain("1 without a figure are left out");
  });
});

describe("the compare first look", () => {
  // two series of one table in one unit, each reached through the entity index
  const measure: MeasureSpec = { field: "Value", label: "Sales", unit: { from: "constant", text: "Millions of Dollars", evidence: "https://example.gov/file" }, grouping: "none" };
  const profile: Profile = defineProfile(() => true, {
    family: "test-compare",
    period: { from: "dimension", format: "yyyy-mm" },
    cadence: "month",
    measures: [measure],
    addressing: { by: "entity_id", where: [], scan: "key", rowsScanned: 40, note: "one key a series" },
    defaultSeries: () => ({ by: "entity_id", key: "A" }),
    compareSeries: () => [
      { label: "Stores", series: { by: "entity_id", key: "A" } },
      { label: "Online", series: { by: "entity_id", key: "B" } },
    ],
    firstLook: "compare",
    proof,
  });
  const snap = snapshot("compare-snap", [col("Code", 0), col("Month", 1), col("Value", 2)], { entity_id: 0, period: 1 }, 48);
  const months = Array.from({ length: 24 }, (_, i) => `${2024 + Math.floor((i + 10) / 12)}-${String(((i + 10) % 12) + 1).padStart(2, "0")}`);

  it("reads each listed series and draws them on one chart, each named, its last value at its end", async () => {
    mocks.seriesAnswer = (input) => {
      const key = (input.address as { key: string }).key;
      const base = key === "A" ? 500 : 100;
      const points = months.map((m, i) => ({ row: (key === "A" ? 0 : 100) + i + 1, period: m, text: String(base + i) }));
      return { ok: true, data: { snapshot: {}, field: {}, address: input.address, where: [], points, next: null } };
    };
    const { container } = render(
      wrap(
        <CompareView
          datasetId="d"
          collection="08_consumer_discretionary"
          snapshot={snap}
          profile={profile}
          measure={measure}
          series={profile.compareSeries!({ id: "d", source_id: null })!}
          range="all"
          view="chart"
          onOpen={() => undefined}
        />,
      ),
    );
    await waitFor(() => expect(container.querySelector('[data-section="Series compared"]')).not.toBeNull());
    expect(mocks.series.map((s) => (s.address as { key: string }).key).sort()).toEqual(["A", "B"]);
    const panel = container.querySelector('[data-section="Series compared"]')!;
    expect(panel.querySelector("p")?.textContent).toBe("Stores was 523 Millions of Dollars in Oct 2026.");
    expect(panel.textContent).toContain("2 series of this table, each read whole");
    // a legend row names both series; the value at each line's end is on the chart
    for (const name of ["Stores", "Online"]) expect(panel.textContent).toContain(name);
    for (const end of ["523", "123"]) expect(panel.querySelector("svg")?.textContent).toContain(end);
  });
});
