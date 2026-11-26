// An in-memory stand-in for the official-source tables and `source_query_records`, answering the selects the company
// reads issue (`alias:values->>N`, `alias:columns->N`, `columns`, eq, in, order, limit) from a fixture of real rows
// (r6-store.json, README.md). For tests and the preview only; it applies no row level security.
import type { OfficialClient, OfficialQuery } from "../official.server";

type Row = Record<string, unknown>;
export interface FixtureSnapshot {
  id: string;
  dataset_id: string;
  status: string;
  retrieved_at: string;
  published_at: string;
  file_sha256: string;
  loaded_rows: number;
  column_count: number;
  /** Descriptors by position; positions the fixture does not keep read as an unnamed field. */
  columns: Record<string, Row>;
}
export interface FixtureRecord {
  snapshot_id: string;
  row_number: number;
  entity_id: string | null;
  period: string | null;
  values: Record<string, string | null>;
}
export interface FixtureStore {
  datasets: { id: string; latest_snapshot_id: string }[];
  snapshots: FixtureSnapshot[];
  records: FixtureRecord[];
}

/** A client over a fixture; `log` receives every select and call, for assertions. */
export function fixtureClient(data: FixtureStore, log?: string[]): OfficialClient {
  const snapshots = new Map(data.snapshots.map(s => [s.id, s]));
  const blank = (i: number): Row => ({ key: `col${String(i + 1).padStart(4, "0")}`, label: `FIELD_${i}`, type: "string" });
  const dense = (s: FixtureSnapshot) => Array.from({ length: s.column_count }, (_, i) => s.columns[String(i)] ?? blank(i));
  const resolve = (row: Row, expr: string, table: string): unknown => {
    const v = /^values->>(\d+)$/.exec(expr);
    if (v) return (row.values as Record<string, unknown>)[v[1]] ?? null;
    const c = /^columns->(\d+)$/.exec(expr);
    if (c) return (row as unknown as FixtureSnapshot).columns[c[1]] ?? null;
    if (expr === "columns" && table === "source_snapshots") return dense(row as unknown as FixtureSnapshot);
    return row[expr] ?? null;
  };
  const base = (table: string): Row[] => (table === "source_datasets" ? data.datasets : table === "source_snapshots" ? data.snapshots : data.records) as unknown as Row[];
  const query = (table: string, columns: string): OfficialQuery => {
    const filters: ((r: Row) => boolean)[] = [];
    let order: { column: string; ascending: boolean } | null = null;
    let limit = Infinity;
    const run = () => {
      log?.push(`${table}:${columns}`);
      let rows = base(table).filter(r => filters.every(f => f(r)));
      if (order) {
        const { column, ascending } = order;
        rows = [...rows].sort((a, b) => String(resolve(a, column, table) ?? "").localeCompare(String(resolve(b, column, table) ?? "")) * (ascending ? 1 : -1));
      }
      const items = columns.split(",").map(c => c.trim()).filter(Boolean).map(c => {
        const i = c.indexOf(":");
        return i > 0 ? { alias: c.slice(0, i), expr: c.slice(i + 1) } : { alias: c, expr: c };
      });
      return { data: rows.slice(0, limit).map(r => Object.fromEntries(items.map(it => [it.alias, resolve(r, it.expr, table)]))), error: null };
    };
    const q: OfficialQuery = {
      eq(column, value) {
        filters.push(r => String(resolve(r, column, table)) === String(value));
        return q;
      },
      in(column, values) {
        const set = new Set(values.map(String));
        filters.push(r => set.has(String(resolve(r, column, table))));
        return q;
      },
      order(column, options) {
        order = { column, ascending: options.ascending };
        return q;
      },
      limit(count) {
        limit = count;
        return q;
      },
      then(onfulfilled, onrejected) {
        return Promise.resolve(run()).then(onfulfilled, onrejected);
      },
    };
    return q;
  };
  return {
    from: table => ({ select: columns => query(table, columns) }),
    rpc: async (fn, args = {}) => {
      log?.push(`rpc:${fn}`);
      const s = snapshots.get(String(args._snapshot_id));
      if (fn !== "source_query_records") return { data: null, error: { message: "Could not find the function in the schema cache", code: "PGRST202" } };
      if (!s || s.dataset_id !== args._dataset_id || s.status !== "ready") return { data: null, error: { message: "published source snapshot not found for this dataset", code: "P0001" } };
      const cols = args._columns as number[];
      const after = Number(args._after ?? 0);
      const rows = data.records.filter(x => x.snapshot_id === s.id && x.row_number > after).sort((a, b) => a.row_number - b.row_number).slice(0, Number(args._limit ?? 50));
      return { data: { dataset_id: s.dataset_id, snapshot_id: s.id, columns: cols.map(i => s.columns[String(i)] ?? blank(i)), rows: rows.map(r => ({ row_number: r.row_number, values: cols.map(i => r.values[String(i)] ?? null) })) }, error: null };
    },
  };
}
