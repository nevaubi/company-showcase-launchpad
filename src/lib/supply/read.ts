// The one read path for `supply_links`. Every reader in the app, the jobs and the scripts goes through here, so a row's
// amount, single-source flag and regions are always the ones its own sentence states (`trustLink`, claims.ts) and never the
// model's raw output. Rows are stored as the model returned them; only this file (and the writers on the allow list in
// read.test.ts) names the table. Works with any Supabase client (browser, server, service role, scripts).
import type { Database } from "@/integrations/supabase/types";
import { trustLink } from "./claims";

export const SUPPLY_LINKS = "supply_links" as const;
/** A stored row as the database types describe it (before verification adds `flow_usd`, `amount_kind`, `nature`...). */
export type SupplyLinkRow = Database["public"]["Tables"][typeof SUPPLY_LINKS]["Row"];

/** The part of a PostgREST query this file uses: filters, ordering, ranges, and the awaited result. */
export interface LinkQuery extends PromiseLike<{ data: unknown[] | null; error: { message: string } | null; count?: number | null }> {
  eq(column: string, value: unknown): LinkQuery;
  in(column: string, values: readonly unknown[]): LinkQuery;
  gte(column: string, value: unknown): LinkQuery;
  lte(column: string, value: unknown): LinkQuery;
  not(column: string, operator: string, value: unknown): LinkQuery;
  or(filters: string): LinkQuery;
  order(column: string, options?: { ascending?: boolean }): LinkQuery;
  limit(count: number): LinkQuery;
  range(from: number, to: number): LinkQuery;
}
/** Any Supabase client (typed or not). Kept structural and loose on purpose: comparing the generated client types is costly. */
type Db = object;
const table = (db: Db) =>
  (db as { from(t: string): { select(columns: string, options?: { count?: "exact" | "estimated"; head?: boolean }): LinkQuery } }).from(SUPPLY_LINKS);
type Filter = (q: LinkQuery) => LinkQuery;
type Result<T> = { data: T[] | null; error: { message: string } | null };

/** Columns the model fills in and the app verifies against the quote. */
const CLAIMS = ["amount_usd", "single_source", "regions"];
/** Columns `trustLink` reads to verify them. */
const BASIS = ["quote", "detail", "relation", "counterparty"];

/** The select list to send, and whether its rows carry claims that must be verified before anyone sees them. */
export function linkColumns(columns: string): { select: string; screen: boolean } {
  const cols = columns.split(",").map((c) => c.trim()).filter(Boolean);
  if (cols.includes("*")) return { select: "*", screen: true };
  const screen = cols.some((c) => CLAIMS.includes(c));
  if (!screen) return { select: cols.join(","), screen };
  return { select: [...cols, ...BASIS.filter((c) => !cols.includes(c))].join(","), screen };
}

/** Rows as the app may show them: claims verified against each row's own sentence; rows without claims pass unchanged. */
export function screenRows<T>(rows: T[], screen: boolean): T[] {
  return screen ? rows.map((r) => trustLink(r as never) as T) : rows;
}

/** One request (the filter sets any range or limit). Same `{ data, error }` shape as a Supabase call. */
export async function selectSupplyLinks<T = Record<string, unknown>>(db: Db, columns: string, filter: Filter = (q) => q): Promise<Result<T>> {
  const { select, screen } = linkColumns(columns);
  const { data, error } = await filter(table(db).select(select));
  return { data: data ? screenRows(data as unknown as T[], screen) : null, error };
}

/** Every matching row, 1,000 a page; the first page also returns the total, then the rest load a few pages at a time. */
export async function pageSupplyLinks<T extends object = Record<string, unknown>>(db: Db, columns: string, filter: Filter = (q) => q): Promise<T[]> {
  const { select, screen } = linkColumns(columns);
  const first = await filter(table(db).select(select, { count: "exact" })).range(0, 999);
  if (first.error) throw first.error;
  const out = [...((first.data ?? []) as unknown as T[])];
  const total = first.count ?? out.length;
  const starts: number[] = [];
  for (let from = 1000; from < total; from += 1000) starts.push(from);
  for (let i = 0; i < starts.length; i += 4) {
    const pages = await Promise.all(starts.slice(i, i + 4).map((from) => filter(table(db).select(select)).range(from, from + 999)));
    for (const pg of pages) {
      if (pg.error) throw pg.error;
      out.push(...((pg.data ?? []) as unknown as T[]));
    }
  }
  // rows added between the count and the last page would repeat; ids dedupe any overlap
  const seen = new Set<string>();
  const idOf = (r: T) => (r as { id?: string }).id;
  const rows = out.filter((r) => { const id = idOf(r); return id == null ? true : seen.has(id) ? false : (seen.add(id), true); });
  return screenRows(rows, screen);
}

/** One link by id, verified. */
export async function supplyLinkById<T = Record<string, unknown>>(db: Db, id: string): Promise<{ data: T | null; error: { message: string } | null }> {
  const { data, error } = await selectSupplyLinks<T>(db, "*", (q) => q.eq("id", id).limit(1));
  return { data: data?.[0] ?? null, error };
}

/** Estimated row count (no row data). */
export async function countSupplyLinks(db: Db): Promise<number | null> {
  const { count, error } = await table(db).select("*", { count: "estimated", head: true });
  return error ? null : count ?? null;
}
