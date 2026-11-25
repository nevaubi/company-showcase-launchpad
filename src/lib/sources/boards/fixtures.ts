/**
 * Readers of the boards fixtures (real production rows, `src/test/fixtures/sources/boards/README.md`), shared
 * by the tests and the preview builder. Node only: never import this from app code.
 */
import { readFileSync } from "node:fs";
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
