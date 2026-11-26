import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("drizzle/migrations/0070_field_counts.sql", "utf8");
const m69 = readFileSync("drizzle/migrations/0069_official_reads.sql", "utf8");
/** The statements, without comment lines. */
const code = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");
const NEW = ["public.source_field_counts", "public.source_field_top_valid"];

describe("migration 0070 (field counts)", () => {
  it("is registered after 0069 with its own snapshot", () => {
    const j = JSON.parse(readFileSync("drizzle/migrations/meta/_journal.json", "utf8")) as { entries: { idx: number; tag: string; when: number }[] };
    expect(j.entries.find((e) => e.idx === 70)).toMatchObject({ idx: 70, tag: "0070_field_counts" });
    expect(j.entries.map((e) => e.idx)).toEqual(j.entries.map((_, i) => i));
    expect(j.entries[70].when).toBeGreaterThan(j.entries[69].when);
    const s70 = JSON.parse(readFileSync("drizzle/migrations/meta/0070_snapshot.json", "utf8")) as { id: string; prevId: string };
    const s69 = JSON.parse(readFileSync("drizzle/migrations/meta/0069_snapshot.json", "utf8")) as { id: string };
    expect(s70.prevId).toBe(s69.id);
    expect(s70.id).not.toBe(s69.id);
  });

  it("is additive: it alters, drops and revokes nothing but its own new objects", () => {
    expect(code).not.toMatch(/\bALTER\s+(?!TABLE public\.source_field_counts ENABLE ROW LEVEL SECURITY)/);
    for (const m of code.matchAll(/\bDROP\s+[^;]*;/g)) expect(m[0]).toBe('DROP POLICY IF EXISTS "Members read field counts of published source snapshots" ON public.source_field_counts;');
    for (const m of code.matchAll(/\bREVOKE\s+[^;]*;/g)) expect(NEW.some((name) => m[0].includes(name)), m[0]).toBe(true);
    expect(code).not.toMatch(/^\s*(?:UPDATE|DELETE|INSERT|TRUNCATE|COPY)\b/im);
    // the one reference to an existing table is the foreign key and the policy's lookup of published snapshots
    expect(code).toContain("snapshot_id text NOT NULL REFERENCES public.source_snapshots(id) ON DELETE CASCADE,");
    expect(code).toMatch(/^SET lock_timeout = '5s';$/m);
  });

  it("grants members SELECT under a policy like the statistics of 0069, and the service role writes", () => {
    expect(code).toContain("REVOKE ALL ON public.source_field_counts FROM PUBLIC, anon, authenticated, service_role;");
    expect(code).toContain("GRANT SELECT ON public.source_field_counts TO authenticated;");
    expect(code).toContain("GRANT SELECT, INSERT, UPDATE ON public.source_field_counts TO service_role;");
    expect(code).not.toMatch(/GRANT [^;]*\banon\b/);
    expect(code).not.toMatch(/GRANT [^;]*\bDELETE\b/);
    const policy = (text: string, table: string) => text.match(new RegExp(`CREATE POLICY "[^"]+" ON public\\.${table} FOR SELECT TO authenticated USING \\((.*)\\);`))?.[1];
    const ours = policy(code, "source_field_counts");
    expect(ours).toBeTruthy();
    expect(ours!.replaceAll("source_field_counts", "T")).toBe(policy(m69, "source_snapshot_stats")!.replaceAll("source_snapshot_stats", "T"));
    expect(code).toContain("GRANT EXECUTE ON FUNCTION public.source_field_top_valid(jsonb, bigint, bigint, integer, integer) TO service_role;");
    expect(code).toContain("REVOKE ALL ON public.source_field_counts FROM sandbox_exec;");
  });

  it("keys one row per snapshot and field and checks every row's list", () => {
    expect(code).toContain("PRIMARY KEY (snapshot_id, position)");
    expect(code).toContain("CHECK (public.source_field_top_valid(top, filled, other_rows, distinct_values, other_values))");
    expect(code).toContain("CHECK (capped IN ('values', 'memory'))");
    expect(code).toContain("CHECK ((distinct_values IS NULL) = (capped IS NOT NULL))");
  });
});
