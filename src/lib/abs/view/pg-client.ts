// A stand-in for the PostgREST query builder over a plain PostgreSQL connection, for tests and the
// fixture script only (nothing in the app imports it). It runs the very reads of ../read.server.ts on a
// local database the real importer filled, as the signed-in member (role `authenticated`, the stubbed
// auth.uid()), so row security is in force; each result is serialised by PostgreSQL's own json_agg, as
// PostgREST does, so numbers, dates and times arrive in the shapes the app receives.
//
// It understands exactly what the reads use: explicit columns (with `::text` casts), one embedded
// child table, eq, in, not ... is null, order, range, limit, and exact counts with head.
import type { AbsQuery, AbsReadClient } from "../read.server";

type Sql = {
  begin<T>(fn: (tx: { unsafe(query: string, params?: unknown[]): Promise<unknown[]> }) => Promise<T>): Promise<T>;
};

/** Embedded children this stand-in knows: child table and the column pair that ties it to its parent. */
const EMBEDS: Record<string, { parentKey: string; childKey: string; order: string }> = {
  abs_documents: { parentKey: "accession", childKey: "accession", order: "seq" },
};

const ident = (name: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`unsupported column name: ${name}`);
  return `"${name}"`;
};

type Filter = { column: string; sql: (p: (v: unknown) => string) => string };

class Query implements AbsQuery<unknown> {
  private filters: Filter[] = [];
  private orders: string[] = [];
  private window: { from: number; to: number } | null = null;
  private max: number | null = null;

  constructor(
    private sql: Sql,
    private member: string,
    private table: string,
    private columns: string,
    private count: boolean,
    private calls: string[],
  ) {}

  eq(column: string, value: string | number | boolean) {
    this.filters.push({ column, sql: (p) => `${this.col(column)} = ${p(value)}` });
    return this;
  }
  in(column: string, values: readonly (string | number)[]) {
    this.filters.push({ column, sql: (p) => `${this.col(column)} = any(${p(values)})` });
    return this;
  }
  not(column: string, operator: string, value: unknown) {
    if (operator !== "is" || value !== null) throw new Error(`unsupported not filter: ${operator} ${String(value)}`);
    this.filters.push({ column, sql: () => `${this.col(column)} is not null` });
    return this;
  }
  order(column: string, options?: { ascending?: boolean }) {
    this.orders.push(`${ident(column)} ${options?.ascending === false ? "desc" : "asc"}`);
    return this;
  }
  range(from: number, to: number) {
    this.window = { from, to };
    return this;
  }
  limit(count: number) {
    this.max = count;
    return this;
  }

  /** A column of this table, or of the embedded child when the name is qualified. */
  private col(column: string) {
    const [a, b] = column.split(".");
    return b == null ? `t.${ident(a)}` : `c.${ident(b)}`;
  }

  private build(params: unknown[]): string {
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    const own = this.filters.filter((f) => !f.column.includes("."));
    const child = this.filters.filter((f) => f.column.includes("."));
    const select: string[] = [];
    // split the column list at top-level commas
    let depth = 0;
    let part = "";
    const parts: string[] = [];
    for (const ch of this.columns) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) {
        parts.push(part.trim());
        part = "";
      } else part += ch;
    }
    if (part.trim()) parts.push(part.trim());
    for (const c of parts) {
      const embed = /^([a-z_]+)\((.*)\)$/.exec(c);
      if (embed) {
        const spec = EMBEDS[embed[1]];
        if (!spec) throw new Error(`unsupported embed: ${embed[1]}`);
        const cols = embed[2].split(",").map((x) => x.trim());
        const where = [`c.${ident(spec.childKey)} = t.${ident(spec.parentKey)}`, ...child.map((f) => f.sql(p))];
        select.push(
          `(select coalesce(json_agg(json_build_object(${cols.map((x) => `'${x}', c.${ident(x)}`).join(", ")}) order by c.${ident(spec.order)}), '[]'::json) from public.${ident(embed[1])} c where ${where.join(" and ")}) as ${ident(embed[1])}`,
        );
        continue;
      }
      const cast = /^([a-z_]+)::text$/.exec(c);
      if (cast) select.push(`t.${ident(cast[1])}::text as ${ident(cast[1])}`);
      else select.push(`t.${ident(c)}`);
    }
    const where = own.map((f) => f.sql(p));
    let q = `select ${select.join(", ")} from public.${ident(this.table)} t`;
    if (where.length) q += ` where ${where.join(" and ")}`;
    if (this.orders.length) q += ` order by ${this.orders.map((o) => `t.${o}`).join(", ")}`;
    if (this.window) q += ` limit ${this.window.to - this.window.from + 1} offset ${this.window.from}`;
    else if (this.max != null) q += ` limit ${this.max}`;
    return q;
  }

  then<R1, R2 = never>(
    ok?: ((value: { data: unknown[] | null; error: { message: string } | null; count?: number | null }) => R1 | PromiseLike<R1>) | null,
    fail?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    const params: unknown[] = [];
    const body = this.build(params);
    const text = this.count
      ? `select count(*)::int as n from (${body}) q`
      : `select coalesce(json_agg(q), '[]'::json)::text as rows from (${body}) q`;
    this.calls.push(body);
    const run = this.sql.begin(async (tx) => {
      await tx.unsafe("set local role authenticated");
      await tx.unsafe(`set local request.jwt.claim.sub = '${this.member}'`);
      const out = (await tx.unsafe(text, params)) as { n?: number; rows?: string }[];
      return this.count
        ? { data: null, error: null, count: out[0].n ?? 0 }
        : { data: JSON.parse(out[0].rows ?? "[]") as unknown[], error: null, count: null };
    });
    return run.then(ok, fail);
  }
}

/** A read client over `sql`, acting as the member `member` (a uuid the local has_app_access() admits). */
export function pgReadClient(sql: Sql, member: string): AbsReadClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    from(table: string) {
      return {
        select(columns: string, options?: { count?: "exact"; head?: boolean }) {
          return new Query(sql, member, table, columns, !!options?.head, calls);
        },
      };
    },
  };
}
