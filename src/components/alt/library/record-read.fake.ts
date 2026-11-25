/**
 * An in-memory stand-in for the PostgREST builder, applying the filters, `or` lists, ordering and limits that
 * `record-read.ts` sends, the way PostgREST and PostgreSQL apply them. Used by the tests and the preview.
 */
import type { ReadClient, Select } from "./record-read";

type Row = Record<string, unknown>;
type Answer = { data: unknown; error: { message: string; code?: string } | null };

const cmp = (a: unknown, b: unknown): number => {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const x = String(a);
  const y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
};

/** Reads `values->>3`, `coverage->refresh_provenance->>family`, or a plain column. */
function path(row: Row, expr: string): unknown {
  const parts = expr.split(/->>?/);
  let v: unknown = row[parts[0]];
  for (const key of parts.slice(1)) {
    if (v == null || typeof v !== "object") return null;
    v = Array.isArray(v) ? v[Number(key)] : (v as Row)[key];
  }
  if (expr.includes("->>") && v != null && typeof v !== "string") return typeof v === "object" ? JSON.stringify(v) : String(v);
  return v === undefined ? null : v;
}

function likeRegex(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i];
    if (c === "\\" && i + 1 < pattern.length) {
      out += pattern[i + 1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i += 1;
    } else if (c === "*" || c === "%") out += ".*";
    else if (c === "_") out += ".";
    else out += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`, "is");
}

/** Splits `a.eq."x,y",b.ilike."*z*"` at top-level commas, unquoting values. */
export function parseOr(expr: string): { column: string; op: string; value: string }[] {
  const out: { column: string; op: string; value: string }[] = [];
  let i = 0;
  while (i < expr.length) {
    const dot1 = expr.indexOf(".", i);
    const dot2 = expr.indexOf(".", dot1 + 1);
    const column = expr.slice(i, dot1);
    const op = expr.slice(dot1 + 1, dot2);
    let j = dot2 + 1;
    let value = "";
    if (expr[j] === '"') {
      j += 1;
      while (j < expr.length && expr[j] !== '"') {
        if (expr[j] === "\\") j += 1;
        value += expr[j];
        j += 1;
      }
      j += 1;
    } else {
      while (j < expr.length && expr[j] !== ",") value += expr[j++];
    }
    out.push({ column, op, value });
    i = j + 1;
  }
  return out;
}

class FakeSelect implements Select {
  private tests: ((r: Row) => boolean)[] = [];
  private orders: { column: string; ascending: boolean }[] = [];
  private count: number | null = null;
  private projection: { alias: string; expr: string }[] | null = null;
  constructor(
    private rowsOf: () => Row[],
    private log: string[],
    private table: string,
  ) {}
  private test(f: (r: Row) => boolean) {
    this.tests.push(f);
    return this;
  }
  select(columns: string) {
    this.projection = columns.split(",").map((part) => {
      const [alias, expr] = part.includes(":") ? part.split(":") : [part.split(/->>?/).pop() as string, part];
      return { alias, expr };
    });
    return this;
  }
  eq(c: string, v: string | number) {
    return this.test((r) => path(r, c) != null && cmp(path(r, c), v) === 0);
  }
  neq(c: string, v: string | number) {
    return this.test((r) => path(r, c) != null && cmp(path(r, c), v) !== 0);
  }
  gt(c: string, v: string | number) {
    return this.test((r) => path(r, c) != null && cmp(path(r, c), v) > 0);
  }
  lt(c: string, v: string | number) {
    return this.test((r) => path(r, c) != null && cmp(path(r, c), v) < 0);
  }
  gte(c: string, v: string | number) {
    return this.test((r) => path(r, c) != null && cmp(path(r, c), v) >= 0);
  }
  lte(c: string, v: string | number) {
    return this.test((r) => path(r, c) != null && cmp(path(r, c), v) <= 0);
  }
  in(c: string, values: readonly (string | number)[]) {
    return this.test((r) => values.some((v) => cmp(path(r, c), v) === 0));
  }
  not(c: string, op: string, v: unknown) {
    if (op !== "is" || v !== null) throw new Error(`fake: not.${op} is not supported`);
    return this.test((r) => path(r, c) != null);
  }
  or(filters: string) {
    const parts = parseOr(filters);
    return this.test((r) =>
      parts.some(({ column, op, value }) => {
        const cell = path(r, column);
        if (cell == null) return false;
        if (op === "eq") return String(cell) === value;
        if (op === "ilike") return likeRegex(value).test(String(cell));
        throw new Error(`fake: or ${op} is not supported`);
      }),
    );
  }
  order(column: string, options: { ascending: boolean }) {
    this.orders.push({ column, ascending: options.ascending });
    return this;
  }
  limit(n: number) {
    this.count = n;
    return this;
  }
  abortSignal() {
    return this;
  }
  run(): Answer {
    this.log.push(this.table);
    let out = this.rowsOf().filter((r) => this.tests.every((t) => t(r)));
    if (this.orders.length)
      out = [...out].sort((a, b) => {
        for (const o of this.orders) {
          // PostgreSQL puts nulls last in ascending order and first in descending order
          const x = path(a, o.column);
          const y = path(b, o.column);
          const d = x == null && y == null ? 0 : x == null ? 1 : y == null ? -1 : cmp(x, y);
          if (d) return o.ascending ? d : -d;
        }
        return 0;
      });
    if (this.count != null) out = out.slice(0, this.count);
    const projection = this.projection;
    const data = projection ? out.map((r) => Object.fromEntries(projection.map((p) => [p.alias, path(r, p.expr)]))) : out;
    return { data, error: null };
  }
  then<A = Answer, B = never>(ok?: ((v: Answer) => A | PromiseLike<A>) | null, fail?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.run()).then(ok, fail);
  }
}

/** A client over in-memory tables. `calls` lists the table of every request, in order. */
export function fakeReadClient(tables: Record<string, Row[] | (() => Row[])>): ReadClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    from(table: string) {
      const src = tables[table];
      return new FakeSelect(() => (typeof src === "function" ? src() : (src ?? [])), calls, table);
    },
  };
}
