import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const file = readFileSync("drizzle/migrations/0069_official_reads.sql", "utf8");
const m67 = readFileSync("drizzle/migrations/0067_abs_ee.sql", "utf8");
const m68 = readFileSync("drizzle/migrations/0068_official_sources.sql", "utf8");
/** This unit's statements: everything before the parts appended from other units. */
const sql = file.slice(0, file.indexOf("\n-- ============"));
/** The parts appended from other units, by the name of the part file each unit wrote (checked in the migration text alone). */
const PARTS = [
  { unit: "abs", file: "0069_part_abs_read.sql" },
  { unit: "fixw", file: "0069_part_abs.sql" },
  { unit: "fixw", file: "0069_part_sources.sql" },
];
const NEW_FUNCTIONS = [
  "source_snapshot_ref", "source_count_distinct", "source_compute_snapshot_stats", "source_compute_missing_stats",
  "source_get_snapshot_stats", "source_facets", "source_find", "source_library",
];
/** Objects of the part appended from unit `abs` (new in this file as well). */
const ABS_PART = ["abs_filing_periods", "abs_monitor", "abs_deal"];
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

  it("appends the parts of units abs and fixw after its own statements, each under a comment naming its unit and hash", () => {
    const marks = PARTS.map(p => file.indexOf(`-- Part from unit \`${p.unit}\` of round 4, appended verbatim from its part file ${p.file}\n-- (SHA-256 `));
    expect(marks.every(m => m >= 0)).toBe(true);
    expect(marks.every(m => m > sql.length)).toBe(true);
    expect([...marks].sort((a, b) => a - b)).toEqual(marks);
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.source_library() TO authenticated, service_role;");
    for (const name of ABS_PART) expect(file.slice(marks[0], marks[1]), name).toMatch(new RegExp(`CREATE OR REPLACE (VIEW|FUNCTION) public\\.${name}\\b`));
    // fixw replaces three existing service-role functions and keeps their signatures and grants.
    const sig = (text: string, name: string) => text.slice(text.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`)).split("\n")[0];
    const fixw = file.slice(marks[1]);
    expect(sig(fixw, "abs_filing_states")).toBe(sig(m67, "abs_filing_states"));
    expect(sig(fixw, "abs_review")).toBe(sig(m67, "abs_review"));
    expect(sig(fixw, "source_claim_snapshot")).toBe(sig(m68, "source_claim_snapshot"));
    for (const name of ["abs_filing_states(bigint)", "abs_review()", "source_claim_snapshot(text, text, integer, boolean)"])
      expect(fixw, name).toContain(`GRANT EXECUTE ON FUNCTION public.${name} TO service_role;`);
    expect(file.slice(sql.length)).not.toMatch(/GRANT [^;]*TO[^;]*\banon\b/);
  });

  it("is plain ASCII without long dashes", () => {
    const outside = [...file].filter(ch => {
      const code = ch.charCodeAt(0);
      return !(code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126));
    });
    expect(outside).toEqual([]);
  });

  it("can be applied twice: nothing is created without a guard", () => {
    expect(file).not.toMatch(/^CREATE TABLE (?!IF NOT EXISTS)/m);
    expect(file).not.toMatch(/^CREATE (UNIQUE )?INDEX /m);
    expect(file).not.toMatch(/^CREATE (FUNCTION|VIEW) /m);
    expect(file).not.toMatch(/^(DROP (TABLE|FUNCTION|VIEW|INDEX)|TRUNCATE|DELETE) /m);
    const policies = [...file.matchAll(/^CREATE POLICY "([^"]+)" ON ([\w.]+)/gm)];
    expect(policies.map(m => m[1])).toEqual(["Members read statistics of published source snapshots", "Vendor, ops and raw official files are private"]);
    for (const m of policies) expect(file, m[1]).toContain(`DROP POLICY IF EXISTS "${m[1]}" ON ${m[2]};\nCREATE POLICY "${m[1]}"`);
    expect(sql).toMatch(/^ON CONFLICT \(snapshot_id\) DO NOTHING;$/m);
  });

  it("waits at most 5 s for any lock and takes the lock on storage.objects last (review int-code N1)", () => {
    const statements = file.split("\n").filter(l => l.trim() && !l.startsWith("--"));
    expect(statements[0]).toBe("SET lock_timeout = '5s';");
    expect(statements.slice(-3)).toEqual([
      'DROP POLICY IF EXISTS "Vendor, ops and raw official files are private" ON storage.objects;',
      'CREATE POLICY "Vendor, ops and raw official files are private" ON storage.objects AS RESTRICTIVE FOR SELECT TO anon, authenticated',
      "  USING (bucket_id <> 'datasets' OR (name NOT LIKE 'vendor/%' AND name NOT LIKE 'ops/%' AND name NOT LIKE 'official/%'));",
    ]);
    // no other statement touches storage.objects
    expect(statements.filter(l => l.includes("storage.objects"))).toEqual(statements.slice(-3, -1));
  });

  it("leaves sandbox_exec no grant on the new table and view, where that role exists (review int-code N2)", () => {
    const block = file.slice(file.indexOf("DO $$ BEGIN\n  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec')"));
    expect(block.slice(0, block.indexOf("END $$;"))).toContain("REVOKE ALL ON public.source_snapshot_stats FROM sandbox_exec;\n    REVOKE ALL ON public.abs_filing_periods FROM sandbox_exec;");
    expect(file.indexOf("CREATE OR REPLACE VIEW public.abs_filing_periods")).toBeLessThan(file.indexOf("REVOKE ALL ON public.abs_filing_periods FROM sandbox_exec;"));
  });

  it("names no path of the machine it was written on", () => {
    expect(file).not.toMatch(/\/home\/|\/tmp\/|\/var\//);
  });

  it("revokes nothing that existed before it, and starts every new object from no access", () => {
    for (const line of sql.split("\n").filter(l => l.startsWith("REVOKE"))) {
      const target = /^REVOKE ALL ON (?:FUNCTION )?public\.(\w+)/.exec(line)?.[1];
      expect([...NEW_FUNCTIONS, "source_snapshot_stats", ...ABS_PART], line).toContain(target);
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
