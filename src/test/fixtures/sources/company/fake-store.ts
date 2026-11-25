// An in-memory stand-in for the official-source tables and member functions, answering the selects the company
// panels issue (`alias:values->>N`, `alias:columns->N`, eq, in, order, limit) and `source_record` /
// `source_query_records`, from real rows copied with the checksum transfer (store.json, README.md).
import data from "./store.json";
import type { OfficialClient, OfficialQuery } from "@/lib/sources/company/official.server";

type Row = Record<string, unknown>;
type Snapshot = { id: string; dataset_id: string; status: string; retrieved_at: string; published_at: string; file_sha256: string; loaded_rows: number; column_count: number; columns: Record<string, Row> };
type Rec = { snapshot_id: string; row_number: number; entity_id: string | null; period: string | null; values: Record<string, string | null> };

export interface FakeStoreOptions {
  /** Member functions that answer "could not find the function" (migration 0069 not applied). */
  missing?: Set<string>;
  /** Overrides of a dataset's latest snapshot (to simulate a newer file). */
  latest?: Record<string, string>;
  /** Extra snapshots (a newer file). */
  snapshots?: Snapshot[];
  /** Row numbers to hide in a snapshot (a missing row). */
  hide?: { snapshot: string; row: number }[];
  /** Positions whose descriptors moved (the probe then fails and the whole dictionary is read). */
  shift?: { snapshot: string; from: number; to: number }[];
  /** Every select issued, for assertions. */
  log?: string[];
}

export function fakeStore(opts: FakeStoreOptions = {}): OfficialClient {
  const snapshots = new Map<string, Snapshot>([...(data.snapshots as unknown as Snapshot[]), ...(opts.snapshots ?? [])].map(s => [s.id, structuredClone(s)]));
  for (const sh of opts.shift ?? []) {
    const s = snapshots.get(sh.snapshot)!;
    s.columns[String(sh.to)] = s.columns[String(sh.from)];
    delete s.columns[String(sh.from)];
  }
  const hidden = new Set((opts.hide ?? []).map(h => `${h.snapshot}#${h.row}`));
  const records = (structuredClone(data.records) as unknown as Rec[]).filter(r => !hidden.has(`${r.snapshot_id}#${r.row_number}`));
  for (const sh of opts.shift ?? [])
    for (const r of records)
      if (r.snapshot_id === sh.snapshot && String(sh.from) in r.values) {
        r.values[String(sh.to)] = r.values[String(sh.from)];
        delete r.values[String(sh.from)];
      }
  const datasets = (data.datasets as { id: string; latest_snapshot_id: string }[]).map(d => ({ ...d, latest_snapshot_id: opts.latest?.[d.id] ?? d.latest_snapshot_id }));
  const dense = (s: Snapshot) => Array.from({ length: s.column_count }, (_, i) => s.columns[String(i)] ?? { key: `col${String(i + 1).padStart(4, "0")}`, label: `FIELD_${i}`, type: "string" });

  const resolve = (row: Row, expr: string, table: string): unknown => {
    const v = expr.match(/^values->>(\d+)$/);
    if (v) return (row.values as Record<string, unknown>)[v[1]] ?? null;
    const c = expr.match(/^columns->(\d+)$/);
    if (c) return (row as unknown as Snapshot).columns[c[1]] ?? null;
    if (expr === "columns" && table === "source_snapshots") return dense(row as unknown as Snapshot);
    return row[expr] ?? null;
  };
  const query = (table: string, columns: string): OfficialQuery => {
    const filters: ((r: Row) => boolean)[] = [];
    let order: { column: string; ascending: boolean } | null = null;
    let limit = Infinity;
    const base = (): Row[] => (table === "source_datasets" ? (datasets as unknown as Row[]) : table === "source_snapshots" ? ([...snapshots.values()] as unknown as Row[]) : (records as unknown as Row[]));
    const run = () => {
      opts.log?.push(`${table}:${columns}`);
      let rows = base().filter(r => filters.every(f => f(r)));
      if (order) {
        const { column, ascending } = order;
        rows = [...rows].sort((a, b) => String(resolve(a, column, table) ?? "").localeCompare(String(resolve(b, column, table) ?? "")) * (ascending ? 1 : -1));
      }
      rows = rows.slice(0, limit);
      const items = columns.split(",").map(c => c.trim()).filter(Boolean).map(c => {
        const i = c.indexOf(":");
        return i > 0 ? { alias: c.slice(0, i), expr: c.slice(i + 1) } : { alias: c, expr: c };
      });
      return { data: rows.map(r => Object.fromEntries(items.map(it => [it.alias, resolve(r, it.expr, table)]))), error: null };
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
  const missing = { message: "Could not find the function public.x in the schema cache", code: "PGRST202" };
  return {
    from: table => ({ select: columns => query(table, columns) }),
    rpc: async (fn, args = {}) => {
      opts.log?.push(`rpc:${fn}`);
      if (opts.missing?.has(fn)) return { data: null, error: missing };
      const s = snapshots.get(String(args._snapshot_id));
      if (!s || s.dataset_id !== args._dataset_id || s.status !== "ready") return { data: null, error: { message: "published source snapshot not found for this dataset", code: "P0001" } };
      if (fn === "source_record") {
        const r = records.find(x => x.snapshot_id === s.id && x.row_number === Number(args._row_number));
        const values = r ? Array.from({ length: s.column_count }, (_, i) => r.values[String(i)] ?? null) : null;
        return { data: { dataset_id: s.dataset_id, snapshot_id: s.id, snapshot_rows: s.loaded_rows, field_count: s.column_count, record: r ? { row_number: r.row_number, values } : null }, error: null };
      }
      if (fn === "source_query_records") {
        const cols = args._columns as number[];
        const after = Number(args._after ?? 0);
        const rows = records.filter(x => x.snapshot_id === s.id && x.row_number > after).sort((a, b) => a.row_number - b.row_number).slice(0, Number(args._limit ?? 50));
        return { data: { dataset_id: s.dataset_id, snapshot_id: s.id, columns: cols.map(i => s.columns[String(i)] ?? { key: `col${i + 1}`, label: `FIELD_${i}`, type: "string" }), column_indices: cols, rows: rows.map(r => ({ row_number: r.row_number, values: cols.map(i => r.values[String(i)] ?? null) })), nextCursor: null, hasMore: false, total: s.loaded_rows }, error: null };
      }
      return { data: null, error: missing };
    },
  };
}

/** The snapshots of the fixture, by dataset id. */
export const FIXTURE_SNAPSHOTS = Object.fromEntries((data.datasets as { id: string; latest_snapshot_id: string }[]).map(d => [d.id, d.latest_snapshot_id]));
