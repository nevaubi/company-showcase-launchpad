import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("drizzle/migrations/0067_abs_ee.sql", "utf8");
const TABLES = [
  "abs_deals",
  "abs_filings",
  "abs_documents",
  "abs_loads",
  "abs_cmbs_assets",
  "abs_cmbs_properties",
  "abs_pool_metrics",
];
const VIEWS = ["abs_cmbs_assets_live", "abs_cmbs_properties_live", "abs_pool_metrics_live"];
const fn = (name: string) => {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, name).toBeGreaterThan(0);
  return sql.slice(start, sql.indexOf("\n$$;", start));
};

describe("migration 0067 (ABS-EE store)", () => {
  it("keeps its journal entry and snapshot chain", () => {
    const j = JSON.parse(readFileSync("drizzle/migrations/meta/_journal.json", "utf8")) as {
      entries: { idx: number; tag: string }[];
    };
    expect(j.entries.find((e) => e.idx === 67)).toMatchObject({ idx: 67, tag: "0067_abs_ee" });
    // one entry per number, in order, none skipped
    expect(j.entries.map((e) => e.idx)).toEqual(j.entries.map((_, i) => i));
    const s67 = JSON.parse(readFileSync("drizzle/migrations/meta/0067_snapshot.json", "utf8")) as {
      id: string;
      prevId: string;
    };
    const s66 = JSON.parse(readFileSync("drizzle/migrations/meta/0066_snapshot.json", "utf8")) as {
      id: string;
    };
    expect(s67.prevId).toBe(s66.id);
    expect(s67.id).not.toBe(s66.id);
  });

  it("starts every table from no access: members read, the service role writes, the ledger is the service role's alone", () => {
    for (const t of TABLES) {
      expect(sql, t).toContain(`CREATE TABLE IF NOT EXISTS public.${t} (`);
      expect(sql, t).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
    }
    const revoke =
      sql.split("\n").find((l) => l.startsWith("REVOKE ALL ON public.abs_deals")) ?? "";
    for (const t of TABLES) expect(revoke, t).toContain(`public.${t}`);
    expect(revoke).toMatch(/FROM PUBLIC, anon, authenticated;$/);
    const read =
      sql.split("\n").find((l) => l.startsWith("GRANT SELECT ON public.abs_deals")) ?? "";
    expect(read).toMatch(/TO authenticated;$/);
    expect(read).not.toContain("abs_loads");
    expect(sql).not.toMatch(/CREATE POLICY[^\n]*ON public\.abs_loads/);
    const policies = [
      ...sql.matchAll(
        /CREATE POLICY "[^"]+" ON public\.(\w+) FOR SELECT TO authenticated USING \(public\.has_app_access\(auth\.uid\(\)\)\);/g,
      ),
    ].map((m) => m[1]);
    expect(policies.sort()).toEqual(TABLES.filter((t) => t !== "abs_loads").sort());
    // nothing is ever granted to anonymous visitors, and members never write
    expect(sql).not.toMatch(/\bTO [^;\n]*\banon\b/);
    expect(sql).not.toMatch(/GRANT (?!SELECT)[A-Z, ]+ON[^;]*TO[^;]*authenticated/);
  });

  it("gives readers views that show only the rows of a loaded filing's committed load, under the tables' own row security", () => {
    for (const v of VIEWS) {
      const start = sql.indexOf(
        `CREATE OR REPLACE VIEW public.${v} WITH (security_invoker = true) AS`,
      );
      expect(start, v).toBeGreaterThan(0);
      const body = sql.slice(start, sql.indexOf(";", start));
      expect(body, v).toMatch(/f\.load_id = \w\.load_id AND f\.status = 'loaded'/);
    }
  });

  it("lets only the service role run the functions", () => {
    const names = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(([^)]*)\)/g)].map(
      (m) => m[1],
    );
    expect(names.length).toBe(17);
    for (const n of names) {
      expect(sql, n).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION public\\.${n}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`,
        ),
      );
      expect(sql, n).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${n}\\([^)]*\\) TO service_role;`),
      );
    }
    expect(sql).not.toMatch(/GRANT EXECUTE[^;]*TO[^;]*(anon|authenticated)/);
  });

  it("allows one open and one committed load per filing, by index, not by convention", () => {
    expect(sql).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS abs_loads_one_open ON public.abs_loads (accession) WHERE status = 'open';",
    );
    expect(sql).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS abs_loads_one_committed ON public.abs_loads (accession) WHERE status = 'committed';",
    );
  });

  it("opens a load only after closing a cut-off one, and skips a filing already stored from the same bytes by the same reader", () => {
    const b = fn("abs_begin_load");
    expect(b).toMatch(/FROM abs_filings WHERE accession = _accession FOR UPDATE;/);
    expect(b).toMatch(
      /have\.parser = _parser AND have\.source_sha256 = _sha256 THEN\s+RETURN jsonb_build_object\('skip', true/,
    );
    const close = b.indexOf("UPDATE abs_loads SET status = 'abandoned'");
    expect(b.indexOf("DELETE FROM abs_cmbs_assets WHERE load_id = stale;")).toBeLessThan(close);
    expect(close).toBeLessThan(b.indexOf("INSERT INTO abs_loads"));
  });

  it("takes the load and accession of a row from the ledger, refuses unknown columns, and makes a repeated chunk harmless", () => {
    const p = fn("abs_put_rows");
    expect(p).toMatch(/IF NOT FOUND OR l\.status <> 'open' THEN\s+RAISE EXCEPTION/);
    for (const [kind, table] of [
      ["cmbs_assets", "abs_cmbs_assets"],
      ["cmbs_properties", "abs_cmbs_properties"],
      ["metrics", "abs_pool_metrics"],
    ]) {
      expect(p, kind).toContain(`PERFORM abs_require_columns('${table}', _rows);`);
      expect(p, kind).toMatch(
        new RegExp(
          `INSERT INTO ${table} SELECT \\* FROM abs_rows_${kind}\\(l\\.load_id, l\\.accession, _rows\\) ON CONFLICT DO NOTHING;`,
        ),
      );
      expect(fn(`abs_rows_${kind}`), kind).toContain(
        "jsonb_build_object('load_id', _load_id, 'accession', _accession",
      );
    }
    expect(fn("abs_require_columns")).toMatch(/RAISE EXCEPTION 'abs: % has no column "%"'/);
  });

  it("commits only when the stored rows equal the reader's count, and replaces the old load in the same transaction", () => {
    const c = fn("abs_commit_load");
    const count = c.indexOf(
      "RAISE EXCEPTION 'abs_commit_load: load % holds % but the reader counted %'",
    );
    const committed = c.indexOf("UPDATE abs_loads SET status = 'committed'");
    const loaded = c.indexOf("status = 'loaded', status_detail = NULL, load_id = _load_id");
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(committed);
    expect(c.indexOf("UPDATE abs_loads SET status = 'replaced' WHERE load_id = old;")).toBeLessThan(
      committed,
    );
    expect(committed).toBeLessThan(loaded);
    // revisions: the filing SEC accepted last is the current one of its deal and cover period
    expect(c).toMatch(
      /f\.deal_id = h\.deal_id AND f\.period_end IS NOT DISTINCT FROM h\.period_end\s+ORDER BY f\.accepted_at DESC NULLS LAST, f\.accession DESC LIMIT 1;/,
    );
    expect(c).toMatch(/superseded_by = CASE WHEN f\.accession = cur THEN NULL ELSE cur END/);
  });

  it("can be applied twice: nothing is created without a guard", () => {
    expect(sql).not.toMatch(/^CREATE TABLE (?!IF NOT EXISTS)/m);
    expect(sql).not.toMatch(/^CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/m);
    expect(sql).not.toMatch(/^CREATE VIEW /m);
    expect(sql).not.toMatch(/^CREATE FUNCTION /m);
    const made = [...sql.matchAll(/^CREATE POLICY "([^"]+)" ON public\.(\w+)/gm)];
    expect(made.length).toBe(6);
    for (const m of made)
      expect(sql, m[1]).toContain(
        `DROP POLICY IF EXISTS "${m[1]}" ON public.${m[2]};\nCREATE POLICY "${m[1]}"`,
      );
    expect(sql).toMatch(
      /IF NOT EXISTS \(SELECT 1 FROM pg_constraint WHERE conname = 'abs_filings_load_fk'/,
    );
  });

  it("stores a whole filing in one transaction for the scheduled job, and counts an attempt before the work", () => {
    const st = fn("abs_store_filing");
    expect(st.indexOf("abs_begin_load(_accession, _parser, _sha256, _bytes, false)")).toBeLessThan(
      st.indexOf("abs_put_rows(id, 'cmbs_assets'"),
    );
    expect(st.indexOf("abs_put_rows(id, 'metrics'")).toBeLessThan(
      st.indexOf("abs_commit_load(id, _filing, _documents, _expect)"),
    );
    const cl = fn("abs_claim_next");
    expect(cl).toMatch(
      /ORDER BY f\.attempts, f\.filed, f\.accession\s+LIMIT 1\s+FOR UPDATE OF f SKIP LOCKED;/,
    );
    expect(cl).toMatch(
      /f\.status = 'listed' OR \(f\.status = 'failed' AND f\.attempts < _max_attempts\)/,
    );
    expect(cl).toMatch(/UPDATE abs_filings SET status = 'failed', attempts = attempts \+ 1/);
    expect(fn("abs_release_filing")).toMatch(
      /attempts = greatest\(attempts - 1, 0\)[\s\S]*WHERE accession = _accession AND status = 'failed'/,
    );
  });

  it("never downgrades a loaded filing when a later attempt fails", () => {
    expect(fn("abs_mark_filing")).toContain(
      "status = CASE WHEN status = 'loaded' THEN status ELSE _status END",
    );
  });

  it("checks the store against the source like for like", () => {
    const v = fn("abs_verify_rows");
    for (const kind of ["cmbs_assets", "cmbs_properties", "metrics"])
      expect(v, kind).toMatch(
        new RegExp(
          `SELECT \\* FROM abs_rows_${kind}\\(id, _accession, _rows\\) EXCEPT SELECT \\* FROM`,
        ),
      );
    expect(v).toMatch(
      /l\.status = 'committed' WHERE f\.accession = _accession AND f\.status = 'loaded'/,
    );
  });
});
