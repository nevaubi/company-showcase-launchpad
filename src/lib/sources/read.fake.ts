/**
 * A stand-in for the member's PostgREST client over the three source tables, for tests and for building the
 * read fixtures. It applies row-level security as 0068 does (ready snapshots only; a dataset only while its latest
 * snapshot is ready) and refuses what the read rules forbid: a select on source_records that does not start with
 * one snapshot, a select without a limit, or a limit above 1,000 (PostgREST's row cap). `values->>N` paths read
 * element N of the stored array as PostgREST does (null for a JSON null or a missing element). Text is compared by
 * code point; production compares with the database collation, which agrees for the digits and capitals the
 * fixtures use.
 */
import type { PgError, PgResult, SourceDirectClient, SourceSelect, SourceTable } from "./read.server";

export type FakeRow = Record<string, unknown>;
type Row = FakeRow;
export type FakeCall = { table: SourceTable; columns: string; filters: string[]; orders: string[]; limit: number | null };

export class FakeSourceDb implements SourceDirectClient {
  calls: FakeCall[] = [];
  rpcs: { fn: string; args?: Record<string, unknown> }[] = [];
  rpcAnswer: (fn: string, args?: Record<string, unknown>) => PgResult = () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
  failNext: PgError | null = null;
  constructor(public tables: Record<SourceTable, Row[]>) {}
  from(table: SourceTable) {
    return { select: (columns: string) => new FakeSelect(this, table, columns) };
  }
  rpc(fn: string, args?: Record<string, unknown>) {
    this.rpcs.push({ fn, args });
    return Promise.resolve(this.rpcAnswer(fn, args));
  }
  visible(table: SourceTable): Row[] {
    const ready = new Set(this.tables.source_snapshots.filter(s => s.status === "ready").map(s => s.id));
    if (table === "source_snapshots") return this.tables.source_snapshots.filter(s => ready.has(s.id));
    if (table === "source_records") return this.tables.source_records.filter(r => ready.has(r.snapshot_id));
    return this.tables.source_datasets.filter(d => ready.has(d.latest_snapshot_id));
  }
}
function cell(row: Row, column: string): unknown {
  const m = /^values->>(\d+)$/.exec(column);
  if (m) {
    const v = (row.values as unknown[])[Number(m[1])];
    return v === undefined ? null : v;
  }
  return row[column];
}
const cmp = (a: unknown, b: unknown) => (typeof a === "number" && typeof b === "number" ? a - b : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);
class FakeSelect implements SourceSelect {
  private tests: ((r: Row) => boolean)[] = [];
  private call: FakeCall;
  private sorts: [string, boolean][] = [];
  constructor(private db: FakeSourceDb, table: SourceTable, columns: string) {
    this.call = { table, columns, filters: [], orders: [], limit: null };
  }
  eq(column: string, value: string | number) {
    this.call.filters.push(`${column}=eq`);
    this.tests.push(r => cell(r, column) === value);
    return this;
  }
  gt(column: string, value: string | number) {
    this.call.filters.push(`${column}=gt`);
    this.tests.push(r => cell(r, column) != null && cmp(cell(r, column), value) > 0);
    return this;
  }
  not(column: string, _operator: "is", _value: null) {
    this.call.filters.push(`${column}=not.is.null`);
    this.tests.push(r => cell(r, column) != null);
    return this;
  }
  order(column: string, options: { ascending: boolean }) {
    this.call.orders.push(`${column}.${options.ascending ? "asc" : "desc"}`);
    this.sorts.push([column, options.ascending]);
    return this;
  }
  limit(count: number) {
    this.call.limit = count;
    return this;
  }
  then<A = PgResult, B = never>(ok?: ((v: PgResult) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve(this.run()).then(ok, bad);
  }
  private run(): PgResult {
    this.db.calls.push(this.call);
    if (this.db.failNext) {
      const error = this.db.failNext;
      this.db.failNext = null;
      return { data: null, error };
    }
    const c = this.call;
    if (c.limit === null || c.limit > 1000) return { data: null, error: { code: "TEST", message: "unbounded or over-limit select" } };
    if (c.table === "source_records" && c.filters[0] !== "snapshot_id=eq") return { data: null, error: { code: "TEST", message: "records select without one snapshot" } };
    let out = this.db.visible(c.table).filter(r => this.tests.every(t => t(r)));
    out = [...out].sort((a, b) => {
      for (const [col, asc] of this.sorts) {
        const d = cmp(cell(a, col), cell(b, col));
        if (d) return asc ? d : -d;
      }
      return 0;
    });
    const fields = c.columns.split(",").map(f => {
      const [alias, path] = f.includes(":") ? f.split(":") : [f, f];
      return [alias, path] as const;
    });
    return { data: out.slice(0, c.limit).map(r => Object.fromEntries(fields.map(([alias, path]) => [alias, cell(r, path) ?? null]))), error: null };
  }
}
