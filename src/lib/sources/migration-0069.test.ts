import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("drizzle/migrations/0069_official_reads.sql", "utf8");
const m68 = readFileSync("drizzle/migrations/0068_official_sources.sql", "utf8");
const NEW_FUNCTIONS = [
  "source_snapshot_ref", "source_count_distinct", "source_compute_snapshot_stats", "source_compute_missing_stats",
  "source_get_snapshot_stats", "source_facets", "source_find", "source_library",
];
const MEMBER_READS = ["source_snapshot_ref", "source_get_snapshot_stats", "source_facets", "source_find", "source_library"];
const fn = (text: string, name: string) => {
  const start = text.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, name).toBeGreaterThanOrEqual(0);
  const ends = [text.indexOf("\n$$;", start), text.indexOf("END $$;", start)].filter(i => i >= 0);
  return text.slice(start, Math.min(...ends));
};
const resultKeys = (body: string) => {
  const ret = body.slice(body.lastIndexOf("RETURN jsonb_build_object("));
  return [...ret.matchAll(/'([A-Za-z_]+)',/g)].map(m => m[1]).filter(k => !["row_number", "values", "entity_id", "entity_name", "period", "geo_level", "geo_code", "geo_name", "source_url"].includes(k));
};

describe("migration 0069 (official reads)", () => {
  it("is registered after 0068 with its own snapshot", () => {
    const j = JSON.parse(readFileSync("drizzle/migrations/meta/_journal.json", "utf8")) as { entries: { idx: number; tag: string; when: number }[] };
    expect(j.entries.find(e => e.idx === 69)).toMatchObject({ idx: 69, tag: "0069_official_reads" });
    expect(j.entries.map(e => e.idx)).toEqual(j.entries.map((_, i) => i));
    expect(j.entries[69].when).toBeGreaterThan(j.entries[68].when);
    const s69 = JSON.parse(readFileSync("drizzle/migrations/meta/0069_snapshot.json", "utf8")) as { id: string; prevId: string };
    const s68 = JSON.parse(readFileSync("drizzle/migrations/meta/0068_snapshot.json", "utf8")) as { id: string };
    expect(s69.prevId).toBe(s68.id);
    expect(s69.id).not.toBe(s68.id);
  });

  it("is plain ASCII without long dashes", () => {
    const outside = [...sql].filter(ch => {
      const code = ch.charCodeAt(0);
      return !(code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126));
    });
    expect(outside).toEqual([]);
  });

  it("can be applied twice: nothing is created without a guard", () => {
    expect(sql).not.toMatch(/^CREATE TABLE (?!IF NOT EXISTS)/m);
    expect(sql).not.toMatch(/^CREATE (UNIQUE )?INDEX /m);
    expect(sql).not.toMatch(/^CREATE FUNCTION /m);
    const policies = [...sql.matchAll(/^CREATE POLICY "([^"]+)" ON ([\w.]+)/gm)];
    expect(policies.map(m => m[1])).toEqual(["Members read statistics of published source snapshots", "Vendor, ops and raw official files are private"]);
    for (const m of policies) expect(sql, m[1]).toContain(`DROP POLICY IF EXISTS "${m[1]}" ON ${m[2]};\nCREATE POLICY "${m[1]}"`);
    expect(sql).toMatch(/^ON CONFLICT \(snapshot_id\) DO NOTHING;$/m);
  });

  it("revokes nothing that existed before it, and starts every new object from no access", () => {
    for (const line of sql.split("\n").filter(l => l.startsWith("REVOKE"))) {
      const target = /^REVOKE ALL ON (?:FUNCTION )?public\.(\w+)/.exec(line)?.[1];
      expect([...NEW_FUNCTIONS, "source_snapshot_stats"], line).toContain(target);
    }
    for (const name of NEW_FUNCTIONS) {
      expect(sql, name).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^)]*\\) FROM PUBLIC, anon, authenticated, service_role;`));
      const grant = new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\) TO (authenticated, service_role|service_role);`).exec(sql);
      expect(grant?.[1], name).toBe(MEMBER_READS.includes(name) ? "authenticated, service_role" : "service_role");
    }
    expect(sql).toContain("REVOKE ALL ON public.source_snapshot_stats FROM PUBLIC, anon, authenticated, service_role;");
    expect(sql).toContain("GRANT SELECT ON public.source_snapshot_stats TO authenticated;");
    expect(sql).toContain("ALTER TABLE public.source_snapshot_stats ENABLE ROW LEVEL SECURITY;");
    expect(sql).not.toMatch(/\bTO [^;\n]*\banon\b(?![^;]*USING)/);
    expect(sql).not.toMatch(/SECURITY DEFINER/);
  });

  it("keeps source_query_records' arguments and result keys, adding only scanned and scanComplete", () => {
    const before = fn(m68, "source_query_records");
    const after = fn(sql, "source_query_records");
    expect(after.slice(0, after.indexOf(")\nRETURNS"))).toBe(before.slice(0, before.indexOf(")\nRETURNS")));
    expect(resultKeys(after)).toEqual([...resultKeys(before), "scanned", "scanComplete"]);
    expect(after).toContain("scan_cap constant integer := 50000;");
  });

  it("bounds every read of source_records by one snapshot and a limit", () => {
    for (const name of ["source_count_distinct", "source_compute_snapshot_stats", "source_facets"]) {
      const body = fn(sql, name);
      for (const scan of body.match(/FROM public\.source_records r2? WHERE[^\n]*/g) ?? []) {
        expect(scan, name).toMatch(/snapshot_id = /);
        expect(scan, name).toMatch(/LIMIT|count\(\*\)|IS NOT NULL\)/);
      }
    }
    expect(fn(sql, "source_library")).not.toContain("source_records");
    expect(fn(sql, "source_find")).not.toContain("source_records");
  });
});
