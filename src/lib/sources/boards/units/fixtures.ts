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

/** The store's exact counts of one indexed dimension of a dataset, as production's `source_facets` answered them. */
export type FixtureFacet = {
  dimension: string;
  complete: boolean;
  scanned?: number;
  /** In production's order (the index order of the values). */
  values: { value: string; label: string | null; rows: number; exact: boolean }[];
};
/** Facets by "<datasetId>|<dimension>". */
export type FixtureFacets = Record<string, FixtureFacet>;
export type UnitFixture = Partial<FixtureTables> & { facets?: FixtureFacets };

/** The units' fixture files in unit order (the order of `./index.ts`). */
const UNIT_FIXTURES: readonly { unit: string; tables: UnitFixture }[] = [
  { unit: "forms", tables: forms as UnitFixture },
  { unit: "finance", tables: finance as UnitFixture },
  { unit: "energy", tables: energy as UnitFixture },
  { unit: "sectors", tables: sectors as UnitFixture },
  { unit: "industry", tables: industry as UnitFixture },
];

/**
 * The core tables with every unit's rows added after them. A snapshot or a record (by snapshot and row number) already
 * held is kept as it is: snapshots are immutable, so the core rows win and an earlier unit wins over a later one. A
 * dataset's row is its pointer to the published snapshot: a unit read production later than the core fixtures, so the
 * first unit that holds a dataset moves its pointer to the snapshot that unit read (the core tests read the core
 * tables alone and keep their own snapshots).
 */
export function withUnitFixtures(core: FixtureTables, units: readonly { unit: string; tables: UnitFixture }[] = UNIT_FIXTURES): FixtureTables & { facets: FixtureFacets } {
  const out: FixtureTables & { facets: FixtureFacets } = {
    source_datasets: [...core.source_datasets],
    source_snapshots: [...core.source_snapshots],
    source_records: [...core.source_records],
    facets: {},
  };
  const datasets = new Set(out.source_datasets.map((d) => String(d.id)));
  const snapshots = new Set(out.source_snapshots.map((s) => String(s.id)));
  const records = new Set(out.source_records.map((r) => `${String(r.snapshot_id)}|${String(r.row_number)}`));
  const moved = new Set<string>();
  for (const { tables } of units) {
    for (const d of tables.source_datasets ?? []) {
      const id = String(d.id);
      if (!datasets.has(id)) (datasets.add(id), moved.add(id), out.source_datasets.push(d));
      else if (!moved.has(id)) {
        moved.add(id);
        out.source_datasets = out.source_datasets.map((x) => (String(x.id) === id ? d : x));
      }
    }
    for (const s of tables.source_snapshots ?? []) if (!snapshots.has(String(s.id))) (snapshots.add(String(s.id)), out.source_snapshots.push(s));
    for (const r of tables.source_records ?? []) {
      const key = `${String(r.snapshot_id)}|${String(r.row_number)}`;
      if (!records.has(key)) (records.add(key), out.source_records.push(r));
    }
    for (const [key, facet] of Object.entries(tables.facets ?? {})) if (!out.facets[key]) out.facets[key] = facet;
  }
  return out;
}

type PgAnswer = { data: unknown; error: { code?: string; message: string } | null };

/**
 * A fake client's answer to `source_facets` (migration 0069) from the fixtures' facets: the values after `_after` in
 * production's order, at most `_limit`, `nextAfter` the last one when more remain, complete only when the fixture's
 * counts were and nothing remains. Any other function, or a dataset without facets, is missing (PGRST202).
 */
export function facetsAnswer(tables: FixtureTables & { facets?: FixtureFacets }) {
  return (fn: string, args?: Record<string, unknown>): PgAnswer => {
    const missing: PgAnswer = { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
    if (fn !== "source_facets" || !args) return missing;
    const datasetId = String(args._dataset_id);
    const dimension = String(args._dimension);
    const facet = tables.facets?.[`${datasetId}|${dimension}`];
    const dataset = tables.source_datasets.find((d) => d.id === datasetId);
    const snapshot = tables.source_snapshots.find((x) => x.id === (args._snapshot_id ?? dataset?.latest_snapshot_id));
    if (!facet || !snapshot) return missing;
    const after = args._after == null ? null : String(args._after);
    const limit = Number(args._limit ?? 200);
    const at = after === null ? 0 : facet.values.findIndex((v) => v.value === after) + 1 || facet.values.findIndex((v) => v.value > after);
    const rest = at < 0 ? [] : facet.values.slice(at);
    const page = rest.slice(0, limit);
    const more = rest.length > limit;
    return {
      data: {
        snapshot: {
          datasetId,
          snapshotId: snapshot.id,
          publishedAt: snapshot.published_at ?? null,
          retrievedAt: snapshot.retrieved_at ?? null,
          fileSha256: snapshot.file_sha256 ?? "",
          rows: Number(snapshot.loaded_rows),
          fields: Number(snapshot.column_count),
        },
        dimension,
        scanLimit: 250000,
        scanned: facet.scanned ?? page.reduce((s, v) => s + v.rows, 0),
        complete: facet.complete && !more,
        nextAfter: more ? page[page.length - 1].value : null,
        values: page,
      },
      error: null,
    };
  };
}
