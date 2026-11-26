/**
 * The energy fixtures (`energy.fixtures.json`: production rows, see `energy-replay.ts`) as the three source tables a
 * fake member client serves (`../../read.fake.ts`), so the board server's own reads can compute the energy tiles in
 * the shared board tests. Pure: the caller passes the parsed fixtures. Dictionaries are as long as production's, each
 * field at its production position; a field no tile reads is named "unread field N", and a cell that was not read on
 * production is null or, past the last cell read, absent (it reads as null). Nothing else is filled in.
 */
import type { SourceColumn } from "../../schema";
import type { EnergyFixtures } from "./energy-replay";

type Row = Record<string, unknown>;

/** What production states about each fixture dataset and its latest snapshot. */
export type EnergyDatasetMeta = {
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

export type EnergyTableFixtures = EnergyFixtures & {
  datasets: Record<string, EnergyDatasetMeta>;
  /** The snapshot's indexed dimensions: field positions, as its ingest states them. */
  dimensions: Record<string, Record<string, number>>;
  /** For a cross-section fixture: the production position of each field it carries. */
  positions: Record<string, Record<string, number>>;
};

const positionOf = (key: string): number => Number(key.slice(3)) - 1;

/** The dictionary at production length: the fixture's entries at their positions, other fields unread. */
function fullColumns(entries: readonly SourceColumn[], fields: number): SourceColumn[] {
  const at = new Map(entries.map((c) => [positionOf(c.key), c] as const));
  return Array.from({ length: fields }, (_, i) => at.get(i) ?? { key: `col${String(i + 1).padStart(4, "0")}`, label: `unread field ${i}`, type: "string" });
}

export function energyFixtureTables(fixtures: EnergyTableFixtures): { source_datasets: Row[]; source_snapshots: Row[]; source_records: Row[] } {
  const datasets: Row[] = [];
  const snapshots: Row[] = [];
  const records: Row[] = [];
  for (const [id, d] of Object.entries(fixtures.datasets)) {
    const dictionary = fixtures.dictionaries[id];
    if (!dictionary) throw new Error(`no fixture dictionary for ${id}`);
    datasets.push({ id, source_id: d.source_id, latest_snapshot_id: d.snapshot, name: d.name, sector: d.sector, agency: d.agency, source_url: d.source_url, grain: d.grain });
    snapshots.push({
      id: d.snapshot,
      dataset_id: id,
      status: "ready",
      columns: fullColumns(dictionary.columns, d.fields),
      ingest: { format: "csv", encoding: "utf-8", delimiter: ",", header_rows: 1, dimensions: fixtures.dimensions[id] ?? {} },
      retrieved_at: d.retrieved_at,
      published_at: d.published_at,
      loaded_rows: d.rows,
      column_count: d.fields,
      file_sha256: "",
    });
  }
  const snapshotOf = (id: string) => {
    const d = fixtures.datasets[id];
    if (!d) throw new Error(`no fixture dataset ${id}`);
    return d;
  };
  for (const [key, series] of Object.entries(fixtures.mer)) {
    const [datasetId, msn] = key.split("|");
    const d = snapshotOf(datasetId);
    if (d.snapshot !== series.snapshotId) throw new Error(`${key}: the series fixture is of another snapshot`);
    for (const [row, period, value] of series.rows)
      records.push({ snapshot_id: d.snapshot, row_number: row, period, values: [msn, period, value, null, series.description, series.unit] });
  }
  for (const [datasetId, cross] of Object.entries(fixtures.rank)) {
    const d = snapshotOf(datasetId);
    if (d.snapshot !== cross.snapshotId) throw new Error(`${datasetId}: the cross-section fixture is of another snapshot`);
    const positions = fixtures.positions[datasetId] ?? {};
    // the array ends at the last cell read: a later element reads as null, as PostgREST reads a missing one
    const width = Math.max(...cross.fields.map((f) => positions[f] ?? -1)) + 1;
    for (const r of cross.rows) {
      const values: (string | null)[] = new Array(width).fill(null);
      cross.fields.forEach((field, i) => {
        const at = positions[field];
        if (at === undefined) throw new Error(`${datasetId}: no position for ${field}`);
        values[at] = r.cells[i] ?? null;
      });
      records.push({
        snapshot_id: d.snapshot,
        row_number: r.row,
        period: r.period,
        entity_id: r.entityId,
        entity_name: r.entityName,
        geo_code: r.geoCode,
        geo_name: r.geoName,
        values,
      });
    }
  }
  for (const [datasetId, table] of Object.entries(fixtures.cells ?? {})) {
    const d = snapshotOf(datasetId);
    if (d.snapshot !== table.snapshotId) throw new Error(`${datasetId}: the cell fixture is of another snapshot`);
    const fields = Object.entries(table.positions);
    if (fields.length !== 1) throw new Error(`${datasetId}: a cell fixture holds one field`);
    const [label, at] = fields[0];
    for (const [row, cell] of table.rows) {
      // the array ends at the cell read: a later element reads as null, as PostgREST reads a missing one
      const values: (string | null)[] = new Array(at + 1).fill(null);
      values[at] = cell;
      records.push({ snapshot_id: d.snapshot, row_number: row, period: null, ...(table.geo === label ? { geo_code: cell } : {}), values });
    }
  }
  return { source_datasets: datasets, source_snapshots: snapshots, source_records: records };
}
