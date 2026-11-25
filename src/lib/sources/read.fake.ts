/**
 * A stand-in for the member's PostgREST client over the three source tables, for tests and for building the
 * read fixtures. It applies row-level security as 0068 does (ready snapshots only; a dataset only while its latest
 * snapshot is ready; embedded rows under the same rules) and refuses what the read rules forbid: a select on
 * source_records that does not start with one snapshot, a select without a limit, or a limit above 1,000 (PostgREST's
 * row cap). `values->>N` paths read element N of the stored array as PostgREST does (null for a JSON null or a missing
 * element). Embedded resources follow PostgREST: `alias:table!constraint(columns)`, filtered, ordered and limited per
 * parent row through `alias.column` filters and `referencedTable` options. Text is compared by code point; production
 * compares with the database collation, which agrees for the digits and capitals the fixtures use.
 */
import type { PgError, PgResult, SourceDirectClient, SourceSelect, SourceTable } from "./read.server";

export type FakeRow = Record<string, unknown>;
type Row = FakeRow;
type Embed = { filters: string[]; orders: string[]; limit: number | null };
export type FakeCall = { table: SourceTable; columns: string; filters: string[]; orders: string[]; limit: number | null; embeds: Record<string, Embed> };

/** The two relationships the reads embed, as 0068 declares them. */
const RELATIONS: Record<string, { from: SourceTable; to: SourceTable; many: boolean; match: (parent: Row, child: Row) => boolean }> = {
  source_datasets_latest_fk: { from: "source_datasets", to: "source_snapshots", many: false, match: (d, s) => s.dataset_id === d.id && s.id === d.latest_snapshot_id },
  source_snapshots_dataset_id_fkey: { from: "source_datasets", to: "source_snapshots", many: true, match: (d, s) => s.dataset_id === d.id },
};

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
    const own = new Set(this.tables.source_snapshots.filter(s => ready.has(s.id)).map(s => `${s.dataset_id}|${s.id}`));
    return this.tables.source_datasets.filter(d => own.has(`${d.id}|${d.latest_snapshot_id}`));
  }
}

/** A column or a PostgREST JSON path (`values->>3`, `ingest->dimensions`, `coverage->refresh_provenance->>family`). */
function cell(row: Row, column: string): unknown {
  const parts = column.split(/(->>?)/);
  let v: unknown = row[parts[0]];
  for (let i = 1; i < parts.length; i += 2) {
    const [op, key] = [parts[i], parts[i + 1]];
    if (v === null || v === undefined) return null;
    if (Array.isArray(v) && /^-?\d+$/.test(key)) v = v[Number(key) < 0 ? v.length + Number(key) : Number(key)];
    else if (typeof v === "object" && !Array.isArray(v)) v = (v as Row)[key];
    else return null;
    if (v === undefined) return null;
    if (op === "->>") return v === null ? null : typeof v === "string" ? v : JSON.stringify(v);
  }
  return v;
}
const cmp = (a: unknown, b: unknown) => (typeof a === "number" && typeof b === "number" ? a - b : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);

type Item = { alias: string; path: string } | { alias: string; table: SourceTable; relation: string; items: Item[] };
/** Splits a select list at top-level commas and reads embeds `alias:table!constraint(...)`. */
function parseSelect(text: string): Item[] {
  const parts: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") depth--;
    else if (text[i] === "," && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts.map(p => {
    const embed = /^(?:(\w+):)?(\w+)!(\w+)\((.*)\)$/.exec(p);
    if (embed) {
      const [, alias, table, relation, inner] = embed;
      if (!RELATIONS[relation]) throw new Error(`unknown relationship ${relation}`);
      return { alias: alias ?? table, table: table as SourceTable, relation, items: parseSelect(inner) };
    }
    const colon = p.indexOf(":");
    return colon > 0 ? { alias: p.slice(0, colon), path: p.slice(colon + 1) } : { alias: p, path: p };
  });
}

type Test = (r: Row) => boolean;
class FakeSelect implements SourceSelect {
  private tests: Test[] = [];
  private embedTests: Record<string, Test[]> = {};
  private sorts: [string, boolean][] = [];
  private embedSorts: Record<string, [string, boolean][]> = {};
  private embedLimits: Record<string, number> = {};
  private call: FakeCall;
  constructor(private db: FakeSourceDb, table: SourceTable, columns: string) {
    this.call = { table, columns, filters: [], orders: [], limit: null, embeds: {} };
  }
  private embed(alias: string): Embed {
    return (this.call.embeds[alias] ??= { filters: [], orders: [], limit: null });
  }
  private filter(column: string, op: string, test: (v: unknown) => boolean) {
    const dot = column.indexOf(".");
    if (dot > 0 && !column.includes("->")) {
      const [alias, col] = [column.slice(0, dot), column.slice(dot + 1)];
      this.embed(alias).filters.push(`${col}=${op}`);
      (this.embedTests[alias] ??= []).push(r => test(cell(r, col)));
    } else {
      this.call.filters.push(`${column}=${op}`);
      this.tests.push(r => test(cell(r, column)));
    }
    return this;
  }
  eq(column: string, value: string | number) {
    return this.filter(column, "eq", v => v === value);
  }
  gt(column: string, value: string | number) {
    return this.filter(column, "gt", v => v != null && cmp(v, value) > 0);
  }
  lt(column: string, value: string | number) {
    return this.filter(column, "lt", v => v != null && value !== "-infinity" && (typeof v === "string" && /^\d{4}-/.test(v) ? Date.parse(v) < Date.parse(String(value)) : cmp(v, value) < 0));
  }
  not(column: string, _operator: "is", _value: null) {
    return this.filter(column, "not.is.null", v => v != null);
  }
  order(column: string, options: { ascending: boolean; referencedTable?: string }) {
    const tag = `${column}.${options.ascending ? "asc" : "desc"}`;
    if (options.referencedTable) {
      this.embed(options.referencedTable).orders.push(tag);
      (this.embedSorts[options.referencedTable] ??= []).push([column, options.ascending]);
    } else {
      this.call.orders.push(tag);
      this.sorts.push([column, options.ascending]);
    }
    return this;
  }
  limit(count: number, options?: { referencedTable?: string }) {
    if (options?.referencedTable) {
      this.embed(options.referencedTable).limit = count;
      this.embedLimits[options.referencedTable] = count;
    } else this.call.limit = count;
    return this;
  }
  then<A = PgResult, B = never>(ok?: ((v: PgResult) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve(this.run()).then(ok, bad);
  }
  private sorted(rows: Row[], sorts: [string, boolean][]): Row[] {
    return [...rows].sort((a, b) => {
      for (const [col, asc] of sorts) {
        const d = cmp(cell(a, col), cell(b, col));
        if (d) return asc ? d : -d;
      }
      return 0;
    });
  }
  private project(row: Row, items: Item[]): Row {
    const out: Row = {};
    for (const item of items) {
      if ("path" in item) {
        out[item.alias] = cell(row, item.path) ?? null;
        continue;
      }
      const rel = RELATIONS[item.relation];
      let children = this.db.visible(item.table).filter(c => rel.match(row, c)).filter(c => (this.embedTests[item.alias] ?? []).every(t => t(c)));
      children = this.sorted(children, this.embedSorts[item.alias] ?? []);
      if (this.embedLimits[item.alias] !== undefined) children = children.slice(0, this.embedLimits[item.alias]);
      const projected = children.map(c => this.project(c, item.items));
      out[item.alias] = rel.many ? projected : projected[0] ?? null;
    }
    return out;
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
    const items = parseSelect(c.columns);
    for (const alias of Object.keys(c.embeds))
      if (!items.some(i => !("path" in i) && i.alias === alias)) return { data: null, error: { code: "PGRST108", message: `"${alias}" is not an embedded resource in this request` } };
    const out = this.sorted(this.db.visible(c.table).filter(r => this.tests.every(t => t(r))), this.sorts);
    return { data: out.slice(0, c.limit).map(r => this.project(r, items)), error: null };
  }
}
