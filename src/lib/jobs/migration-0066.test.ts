import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("drizzle/migrations/0066_data_freshness_ingest.sql", "utf8");
const line = (key: string) => sql.split("\n").find((l) => l.includes(`SELECT '${key}'`)) ?? "";

describe("migration 0066", () => {
  it("ages alt_contracts by when rows were stored or re-checked, never by a (future) award date (X3)", () => {
    const l = line("alt_contracts");
    expect(l).toMatch(/max\(created_at\)/);
    expect(l).toMatch(/meta->>'as_of'/);
    // a malformed stamp cannot make the whole function fail, and nothing reads later than now
    expect(l).toMatch(/CASE WHEN meta->>'as_of' ~ '\^\\d\{4\}-\\d\{2\}-\\d\{2\}' THEN \(meta->>'as_of'\)::timestamptz END/);
    expect(l).toMatch(/^\s*UNION ALL SELECT 'alt_contracts', \(SELECT least\(now\(\), /);
    expect(l).not.toMatch(/max\(date\)/);
    expect(l).toMatch(/dataset = 'contracts'/);
  });
  it("keeps its journal entry and snapshot chain", () => {
    const j = JSON.parse(readFileSync("drizzle/migrations/meta/_journal.json", "utf8")) as { entries: { idx: number; tag: string }[] };
    expect(j.entries.at(-1)).toMatchObject({ idx: 66, tag: "0066_data_freshness_ingest" });
    const s66 = JSON.parse(readFileSync("drizzle/migrations/meta/0066_snapshot.json", "utf8")) as { id: string; prevId: string };
    const s65 = JSON.parse(readFileSync("drizzle/migrations/meta/0065_snapshot.json", "utf8")) as { id: string };
    expect(s66.prevId).toBe(s65.id);
  });
  it("replaces supply signals in one transaction, refuses empty or foreign rows, and only the service role may run it (F16)", () => {
    const body = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.replace_supply_signals"));
    expect(body).toMatch(/LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS \$\$/);
    expect(body).toMatch(/jsonb_array_length\(_rows\) = 0 THEN\s+RAISE EXCEPTION/);
    expect(body).toMatch(/IS DISTINCT FROM _ticker OR e->>'source_kind' IS DISTINCT FROM _source_kind\) THEN\s+RAISE EXCEPTION/);
    // delete and insert in the same function body (one transaction), the delete scoped to the pair
    expect(body.indexOf("DELETE FROM supply_signals WHERE ticker = _ticker AND source_kind = _source_kind;")).toBeLessThan(body.indexOf("INSERT INTO supply_signals"));
    expect(body).toMatch(/jsonb_populate_recordset\(NULL::supply_signals, _rows\)/);
    const revoke = body.indexOf("REVOKE ALL ON FUNCTION public.replace_supply_signals(text, text, jsonb) FROM PUBLIC, anon, authenticated;");
    const grant = body.indexOf("GRANT EXECUTE ON FUNCTION public.replace_supply_signals(text, text, jsonb) TO service_role;");
    expect(revoke).toBeGreaterThan(0);
    expect(grant).toBeGreaterThan(revoke);
    expect(body).not.toMatch(/TO (anon|authenticated)/);
  });
  it("counts the failure streak over finished runs only (review R9)", () => {
    const body = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.job_health"), sql.indexOf("CREATE OR REPLACE FUNCTION public.data_coverage"));
    expect(body).toMatch(/CASE WHEN j\.finished_at IS NOT NULL THEN row_number\(\) OVER \(PARTITION BY j\.job, \(j\.finished_at IS NOT NULL\) ORDER BY j\.started_at DESC\) END AS frn/);
    expect(body).toMatch(/coalesce\(min\(r\.frn\) FILTER \(WHERE r\.ok IS TRUE\) - 1, count\(\*\) FILTER \(WHERE r\.finished_at IS NOT NULL\)\)::int/);
  });
});
