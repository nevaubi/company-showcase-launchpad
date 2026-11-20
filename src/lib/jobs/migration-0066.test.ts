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
});
