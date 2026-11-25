/**
 * Readers of the boards fixtures (real production rows, `src/test/fixtures/sources/boards/README.md`), shared
 * by the tests and the preview builder. Node only: never import this from app code.
 */
import { readFileSync } from "node:fs";
import type { SourceColumn } from "../schema";
import type { CellInput, RankCellInput } from "./compute";

const DIR = "src/test/fixtures/sources/boards";

function lines(file: string): string[][] {
  return readFileSync(`${DIR}/${file}`, "utf8")
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => l.split("|"));
}

const cell = (v: string): string | null => (v === "<null>" ? null : v);

export type FixtureDataset = {
  id: string;
  name: string;
  sector: string;
  agency: string;
  source_id: string;
  source_url: string;
  grain: string;
  snapshot: string;
  retrieved_at: string;
  published_at: string;
  rows: number;
  fields: number;
};

export function fixtureDatasets(): FixtureDataset[] {
  return JSON.parse(readFileSync(`${DIR}/datasets.json`, "utf8")) as FixtureDataset[];
}

/** One FRED series: row, period (the observation date) and the value cell. */
export function fredCells(code: string): CellInput[] {
  return lines("fred.txt")
    .filter((l) => l[0] === code)
    .map((l) => ({ row: Number(l[1]), period: cell(l[2]), text: cell(l[3]) }));
}

const MER_UNITS: Record<string, { unit: string; description: string }> = {
  TETCBUS: { unit: "Quadrillion Btu", description: "Total Primary Energy Consumption" },
  PAPRPUS: { unit: "Thousand Barrels per Day", description: "Crude Oil Production, Total" },
  ELETPUS: { unit: "Billion Kilowatthours", description: "Electricity Net Generation, Total" },
  RMRTUUS: { unit: "Dollars per Gallon Including Taxes", description: "Regular Motor Gasoline, All Areas, Retail Price" },
};

/** One MER series with its unit and description cells (one value per table in every row read, README). */
export function merCells(msn: string): CellInput[] {
  const stated = MER_UNITS[msn];
  return lines("mer.txt")
    .filter((l) => l[0] === msn)
    .map((l) => ({ row: Number(l[1]), period: cell(l[2]), text: cell(l[3]), unit: stated.unit, check: stated.description }));
}

/** The FDIC CB series of one field: ASSET (3), DEP (4) or NETINC (5), with STNAME as the check cell. */
export function fdicSummaryCells(field: "ASSET" | "DEP" | "NETINC"): CellInput[] {
  const at = { ASSET: 3, DEP: 4, NETINC: 5 }[field];
  return lines("fdic-summary-cb.txt").map((l) => ({ row: Number(l[1]), period: cell(l[2]), text: cell(l[at]), check: cell(l[6]) }));
}

/** Every institution of 30 Sep 2026 with one field, named where the names fixture has the name. */
export function fdicCrossSection(field: "ASSET" | "DEP"): RankCellInput[] {
  const names = new Map(lines("fdic-q3-names.txt").map((l) => [l[0], l[3]] as const));
  const at = field === "ASSET" ? 2 : 3;
  return lines("fdic-q3-cross-section.txt").map((l) => ({
    row: Number(l[1]),
    key: l[0],
    name: names.get(l[0]) ?? null,
    period: "20260930",
    text: cell(l[at]),
  }));
}

/** FHFA United States purchase-only monthly records, the period composed from yr and period. */
export function fhfaCells(field: "index_sa" | "index_nsa"): CellInput[] {
  return lines("fhfa-usa-purchase-only.txt").map((l) => ({
    row: Number(l[3]),
    period: `${l[4]}-${l[5].padStart(2, "0")}`,
    text: cell(field === "index_sa" ? l[7] : l[6]),
  }));
}

/** The raw FHFA lines, for the server test's fake records. */
export function fhfaLines(): string[][] {
  return lines("fhfa-usa-purchase-only.txt");
}

export function merLines(): string[][] {
  return lines("mer.txt");
}

export function fredLines(): string[][] {
  return lines("fred.txt");
}

export function fdicSummaryLines(): string[][] {
  return lines("fdic-summary-cb.txt");
}

export function fdicCrossLines(): { cross: string[][]; names: string[][] } {
  return { cross: lines("fdic-q3-cross-section.txt"), names: lines("fdic-q3-names.txt") };
}

type Row = Record<string, unknown>;
const col = (label: string, i: number, extra: Partial<SourceColumn> = {}): SourceColumn => ({
  key: `col${String(i + 1).padStart(4, "0")}`,
  label,
  type: "string",
  ...extra,
});
const FDIC_MONEY = { unit: "USD thousands (monetary measures)", native_type: "number" };

/**
 * The fixture rows as the three source tables, for `FakeSourceDb` (`read.fake.ts`). Dictionaries carry the
 * labels, units and native types production stores for the fields the tiles read; a field no tile reads is
 * named "unread field N" and a cell that was not transferred is null. Nothing else is filled in.
 */
export function fixtureTables(): { source_datasets: Row[]; source_snapshots: Row[]; source_records: Row[] } {
  const datasets: Row[] = [];
  const snapshots: Row[] = [];
  const records: Row[] = [];
  const meta = new Map(fixtureDatasets().map((d) => [d.id, d] as const));
  const add = (id: string, columns: SourceColumn[], dimensions: Record<string, number>, rows: Row[]) => {
    const d = meta.get(id);
    if (!d) throw new Error(`no fixture dataset ${id}`);
    datasets.push({ id, source_id: d.source_id, latest_snapshot_id: d.snapshot, name: d.name, sector: d.sector, agency: d.agency, source_url: d.source_url, grain: d.grain });
    snapshots.push({
      id: d.snapshot,
      dataset_id: id,
      status: "ready",
      columns,
      ingest: { format: "csv", encoding: "utf-8", delimiter: ",", header_rows: 1, dimensions },
      retrieved_at: d.retrieved_at,
      published_at: d.published_at,
      loaded_rows: d.rows,
      column_count: d.fields,
      file_sha256: "",
    });
    for (const r of rows) records.push({ snapshot_id: d.snapshot, ...r });
  };

  const fredRows = new Map<string, string[][]>();
  for (const l of fredLines()) fredRows.set(l[0], [...(fredRows.get(l[0]) ?? []), l]);
  for (const d of meta.values()) {
    if (!d.source_id.startsWith("FRED_")) continue;
    const code = d.source_id.slice(5);
    add(d.id, [col("observation_date", 0), col(code, 1)], { period: 0 }, (fredRows.get(code) ?? []).map((l) => ({
      row_number: Number(l[1]),
      period: cell(l[2]),
      values: [cell(l[2]), cell(l[3])],
    })));
  }

  const merTable: Record<string, string> = {
    TETCBUS: "official_04_energy_raw_mer_t01_01_50b683cd84",
    PAPRPUS: "official_04_energy_raw_mer_t03_01_7b9fc216c5",
    ELETPUS: "official_04_energy_raw_mer_t07_01_2030412788",
    RMRTUUS: "official_04_energy_raw_mer_t09_04_63383fa9ac",
  };
  const merColumns = ["MSN", "YYYYMM", "Value", "Column_Order", "Description", "Unit"].map((l, i) => col(l, i));
  for (const [msn, id] of Object.entries(merTable)) {
    const stated = MER_UNITS[msn];
    add(id, merColumns, { period: 1 }, merLines()
      .filter((l) => l[0] === msn)
      .map((l) => ({ row_number: Number(l[1]), period: l[2], values: [msn, l[2], cell(l[3]), null, stated.description, stated.unit] })));
  }

  const summaryLabels = ["YEAR", "STNAME", "CB_SI", "BANKS", "ASSET", "DEP", "DEPDOM", "EQ", "LNLSNET", "NETINC", "INTINC", "EINTEXP", "NIM", "NONII", "NONIX", "OFFICES", "BRANCHES", "NUMEMP"];
  add(
    "official_01_financials_data_fdic_annual_historical_national_core_ffa805e556",
    summaryLabels.map((l, i) => col(l, i, i >= 4 && i <= 14 ? FDIC_MONEY : {})),
    { period: 0 },
    fdicSummaryLines().map((l) => ({
      row_number: Number(l[1]),
      period: l[2],
      values: [l[2], l[6], l[0], null, l[3], l[4], null, null, null, l[5], null, null, null, null, null, null, null, null],
    })),
  );

  const named: Record<number, string> = { 0: "CERT", 1: "REPDTE", 35: "ASSET", 235: "DEP", 1175: "NAME", 2049: "STALP" };
  const fdicColumns = Array.from({ length: 2378 }, (_, i) =>
    col(named[i] ?? `unread field ${i}`, i, i === 35 || i === 235 ? FDIC_MONEY : i === 0 ? { native_type: "number", unit: "FDIC certificate identifier" } : {}),
  );
  const { cross, names } = fdicCrossLines();
  const nameOf = new Map(names.map((l) => [l[0], l[3]] as const));
  add(
    "official_fdic_2026q2_cohort500_native_current_quarter",
    fdicColumns,
    { entity_id: 0, entity_name: 1175, geo_code: 2049, period: 1 },
    cross.map((l) => {
      const values: (string | null)[] = new Array(2378).fill(null);
      values[0] = l[0];
      values[1] = "20260930";
      values[35] = cell(l[2]);
      values[235] = cell(l[3]);
      values[1175] = nameOf.get(l[0]) ?? null;
      return { row_number: Number(l[1]), period: "20260930", entity_id: l[0], entity_name: nameOf.get(l[0]) ?? null, values };
    }),
  );

  const fhfaLabels = ["hpi_type", "hpi_flavor", "frequency", "level", "place_name", "place_id", "yr", "period", "index_nsa", "index_sa", "rstderr", "note"];
  add(
    "official_11_real_estate_hpi_master_all_0755e8292e",
    fhfaLabels.map((l, i) => col(l, i)),
    { geo_code: 5, geo_level: 3, geo_name: 4, period: 6 },
    fhfaLines().map((l) => ({
      row_number: Number(l[3]),
      period: l[8],
      geo_code: "USA",
      values: [l[0], l[1], l[2], null, null, "USA", l[4], l[5], cell(l[6]), cell(l[7]), null, null],
    })),
  );

  return { source_datasets: datasets, source_snapshots: snapshots, source_records: records };
}
