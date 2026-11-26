/**
 * Fixture rows of the units' tiles, one JSON per unit (`./<unit>.fixtures.json`), each in the shape of the three
 * source tables a fake member client serves (`../../read.fake.ts`): `source_datasets`, `source_snapshots` (the
 * dictionary at production length: a field no tile reads is "unread field N"), `source_records` (`values` as stored, a
 * cell not read on production null). A unit fills its own file from production rows (small selects, the rows its tiles
 * read) and nothing else; the board tests merge them after the core rows of `../fixtures.ts`, the core winning where
 * both hold a row, so every tile on every board computes in the shared tests. Node only, like `../fixtures.ts`.
 */
import forms from "./forms.fixtures.json";
import finance from "./finance.fixtures.json";
import energy from "./energy.fixtures.json";
import sectors from "./sectors.fixtures.json";
import industry from "./industry.fixtures.json";

type Row = Record<string, unknown>;
export type FixtureTables = { source_datasets: Row[]; source_snapshots: Row[]; source_records: Row[] };

/** The units' fixture files in unit order (the order of `./index.ts`). */
const UNIT_FIXTURES: readonly { unit: string; tables: Partial<FixtureTables> }[] = [
  { unit: "forms", tables: forms as Partial<FixtureTables> },
  { unit: "finance", tables: finance as Partial<FixtureTables> },
  { unit: "energy", tables: energy as Partial<FixtureTables> },
  { unit: "sectors", tables: sectors as Partial<FixtureTables> },
  { unit: "industry", tables: industry as Partial<FixtureTables> },
];

/**
 * The core tables with every unit's rows added after them: a dataset, snapshot or record (by snapshot and row number)
 * already held is kept as it is, so the core rows win and an earlier unit wins over a later one.
 */
export function withUnitFixtures(core: FixtureTables, units: readonly { unit: string; tables: Partial<FixtureTables> }[] = UNIT_FIXTURES): FixtureTables {
  const out: FixtureTables = { source_datasets: [...core.source_datasets], source_snapshots: [...core.source_snapshots], source_records: [...core.source_records] };
  const datasets = new Set(out.source_datasets.map((d) => String(d.id)));
  const snapshots = new Set(out.source_snapshots.map((s) => String(s.id)));
  const records = new Set(out.source_records.map((r) => `${String(r.snapshot_id)}|${String(r.row_number)}`));
  for (const { tables } of units) {
    for (const d of tables.source_datasets ?? []) if (!datasets.has(String(d.id))) (datasets.add(String(d.id)), out.source_datasets.push(d));
    for (const s of tables.source_snapshots ?? []) if (!snapshots.has(String(s.id))) (snapshots.add(String(s.id)), out.source_snapshots.push(s));
    for (const r of tables.source_records ?? []) {
      const key = `${String(r.snapshot_id)}|${String(r.row_number)}`;
      if (!records.has(key)) (records.add(key), out.source_records.push(r));
    }
  }
  return out;
}
