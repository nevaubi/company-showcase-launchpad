// Runs migration 0069 on a real PostgreSQL: applied twice over 0067 and 0068 (its appended abs part reads 0067), every new read as a member under row-level
// security and as the service role, the bounds, the scan limit continuation, unpublished snapshots, grants, the
// storage policy, and the replacement records function against the 0068 one. Set SOURCE_DB_URL to a local database
// whose name contains test or proof; nothing here connects to a hosted project.
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildLibrary, type LibrarySource } from "../lib/sources/read.server";

const url = process.env.SOURCE_DB_URL ?? "";
const local = /^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost)(?::\d+)?\/[\w-]*(?:proof|test)[\w-]*$/.test(url);
const MEMBER = "00000000-0000-0000-0000-0000000000aa";
const OUTSIDER = "00000000-0000-0000-0000-0000000000bb";
const FILE = "f".repeat(64);
const PANEL = "1".repeat(64), PANEL_NEXT = "2".repeat(64), BIG = "3".repeat(64);
const STUBS = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth; CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
CREATE TABLE IF NOT EXISTS storage.objects(bucket_id text,name text,metadata jsonb);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE OR REPLACE FUNCTION public.has_app_access(_user uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT _user='${MEMBER}'::uuid $$;
GRANT USAGE ON SCHEMA public,auth,storage TO anon,authenticated,service_role;
GRANT SELECT ON storage.objects TO anon,authenticated,service_role;
DROP POLICY IF EXISTS "Members read datasets" ON storage.objects;
CREATE POLICY "Members read datasets" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'datasets' AND public.has_app_access(auth.uid()));
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon,authenticated,service_role;
`;
const M67 = readFileSync("drizzle/migrations/0067_abs_ee.sql", "utf8");
const M68 = readFileSync("drizzle/migrations/0068_official_sources.sql", "utf8");
const M69 = readFileSync("drizzle/migrations/0069_official_reads.sql", "utf8");
/** The 0068 records function under another name, to compare the replacement with. */
function old68(): string {
  const start = M68.indexOf("CREATE OR REPLACE FUNCTION public.source_query_records(");
  const end = M68.indexOf("END $$;", start) + "END $$;".length;
  return M68.slice(start, end).replace("public.source_query_records(", "public.source_query_records_0068(") +
    "\nGRANT EXECUTE ON FUNCTION public.source_query_records_0068(text,text,text,text,text,text,bigint,integer,integer[]) TO authenticated;";
}
// Answers of the functions are JSON objects whose shape each test states; nested reads stay untyped on purpose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const columns = (labels: string[]) => JSON.stringify(labels.map((label, i) => ({ key: `col${i}`, label, type: "string" })));

describe.skipIf(!local)("official reads of migration 0069 on PostgreSQL", () => {
  let sql: postgres.Sql;
  const one = async (q: string, p: unknown[] = []) => Object.values((await sql.unsafe(q, p as never[]))[0] ?? {})[0];
  /** Runs work in a transaction as a role (and a signed-in user), always rolled back. */
  const as = async <T,>(role: string, uid: string | null, work: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> => {
    let out: T | undefined;
    let failure: unknown = null;
    await sql.begin(async tx => {
      await tx.unsafe(`SET LOCAL ROLE ${role}`);
      if (uid) await tx.unsafe("select set_config('request.jwt.claim.sub',$1,true)", [uid]);
      try { out = await work(tx); } catch (e) { failure = e; }
      throw new Error("rollback");
    }).catch(e => { if (!(e instanceof Error && e.message === "rollback")) throw e; });
    if (failure) throw failure;
    return out as T;
  };
  const call = (role: string, uid: string | null, fn: string, args: unknown[]) =>
    as(role, uid, async tx => Object.values((await tx.unsafe(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(",")}) as r`, args as never[]))[0])[0] as Row);
  const member = (fn: string, args: unknown[]) => call("authenticated", MEMBER, fn, args);

  beforeAll(async () => {
    sql = postgres(url, { max: 1, onnotice: () => undefined });
    await sql.unsafe(STUBS);
    await sql.unsafe(M67);
    await sql.unsafe(M68);
    await sql.unsafe(M69);
    await sql.unsafe(M69);
    await sql.unsafe(old68());
    await sql.unsafe("TRUNCATE public.source_snapshot_stats, public.source_records, public.source_snapshots, public.source_datasets, public.source_files CASCADE; DELETE FROM storage.objects;");
    await sql.unsafe(`insert into source_files(sha256,bytes,content_type,chunks,verified_at) values('${FILE}',3,'text/csv','[{"index":0,"path":"official/objects/${FILE}","sha256":"${FILE}","bytes":3}]',now())`);
    await sql.unsafe(`insert into source_datasets(id,name,sector,agency,source_id,grain,description) values
      ('fdic_panel','FDIC bank panel','01_financials','Federal Deposit Insurance Corporation','FDIC_FIN','One row per bank per quarter','Quarterly call report lines'),
      ('big_table','Monthly plant generation','05_utilities','US EIA','EIA_923','One row per plant per month','Net generation')`);
    // The bank panel: 3 banks x 4 quarters; a later staging snapshot of the same dataset; a 60,000-row table.
    await sql.unsafe(`insert into source_snapshots(id,dataset_id,file_sha256,source_path,expected_rows,columns,ingest,retrieved_at) values
      ('${PANEL}','fdic_panel','${FILE}','panel.csv',12,'${columns(["CERT", "Institution name", "Report date", "Total assets"])}','{"format":"csv","dimensions":{"entity_id":0,"entity_name":1,"period":2}}','2026-11-24T09:00:00Z'),
      ('${PANEL_NEXT}','fdic_panel','${FILE}','panel.csv',1,'${columns(["CERT", "Institution name", "Report date", "Total assets"])}','{"format":"csv","dimensions":{"entity_id":0,"entity_name":1,"period":2}}','2026-11-25T09:00:00Z'),
      ('${BIG}','big_table','${FILE}','big.csv',60000,'${columns(["Plant", "Month", "Net generation"])}','{"format":"csv","dimensions":{"entity_id":0,"period":1}}','2026-11-24T10:00:00Z')`);
    await sql.unsafe(`insert into source_records(snapshot_id,row_number,"values",entity_id,entity_name,period)
      select '${PANEL}', n, jsonb_build_array(b.cert, b.name, q.p, (1000 + n)::text), b.cert, b.name, q.p
      from (values (1,'2025Q4'),(2,'2026Q1'),(3,'2026Q2'),(4,'2026Q3')) q(i,p)
      cross join (values (1,'628','JPMorgan Chase Bank'),(2,'3510','Bank of America'),(3,'7213','Citibank')) b(j,cert,name)
      cross join lateral (select (q.i - 1) * 3 + b.j as n) k`);
    await sql.unsafe(`insert into source_records(snapshot_id,row_number,"values",entity_id,entity_name,period) values ('${PANEL_NEXT}',1,'["628","JPMorgan Chase Bank","2026Q4","secret"]','628','JPMorgan Chase Bank','2026Q4')`);
    await sql.unsafe(`insert into source_records(snapshot_id,row_number,"values",entity_id,period)
      select '${BIG}', n, jsonb_build_array('P' || (n % 700), '2026-' || lpad(((n % 12) + 1)::text, 2, '0'), (n * 7 % 1000)::text), 'P' || (n % 700), '2026-' || lpad(((n % 12) + 1)::text, 2, '0')
      from generate_series(1, 60000) n`);
    await sql.unsafe(`update source_snapshots set status='ready', loaded_rows=expected_rows, published_at='2026-11-25T05:30:00Z' where id in ('${PANEL}','${BIG}')`);
    await sql.unsafe(`update source_snapshots set loaded_rows=1 where id='${PANEL_NEXT}'`);
    await sql.unsafe(`update source_datasets set latest_snapshot_id = case id when 'fdic_panel' then '${PANEL}' else '${BIG}' end`);
    await sql.unsafe(`insert into storage.objects(bucket_id,name) values ('datasets','companies/AAPL.json'),('datasets','universe.json'),('datasets','vendor/fiscal-ai/x.json'),('datasets','ops/state.json'),('datasets','official/objects/${FILE}')`);
    // Applied once more over the data: the backfill fills labels and the current snapshots' period ranges.
    await sql.unsafe(M69);
  }, 120_000);
  afterAll(async () => { await sql?.end(); });

  it("applies twice over 0068 and revokes nothing members had", async () => {
    expect(await one("select count(*)::int from pg_policies where tablename='source_snapshot_stats'")).toBe(1);
    expect(await one("select count(*)::int from pg_policies where policyname='Vendor, ops and raw official files are private'")).toBe(1);
    for (const t of ["source_records", "source_snapshots", "source_datasets", "source_files"])
      expect(await one(`select has_table_privilege('authenticated','public.${t}','SELECT')`), t).toBe(true);
    expect(await one("select reloptions::text from pg_class where relname='source_records'")).toContain("autovacuum_vacuum_insert_threshold=200000");
  });

  it("gives the reads to members and the computing to the service role, nothing to anon", async () => {
    const reads = ["source_get_snapshot_stats(text,text)", "source_facets(text,text,text,text,text,integer,integer)", "source_find(text,integer)", "source_library()",
      "source_query_records(text,text,text,text,text,text,bigint,integer,integer[])", "source_snapshot_ref(public.source_snapshots)"];
    const service = ["source_count_distinct(text,text,integer)", "source_compute_snapshot_stats(text,integer)", "source_compute_missing_stats(integer,integer)"];
    for (const f of reads) {
      expect(await one(`select has_function_privilege('authenticated','public.${f}','EXECUTE')`), f).toBe(true);
      expect(await one(`select has_function_privilege('anon','public.${f}','EXECUTE')`), f).toBe(false);
    }
    for (const f of service) {
      expect(await one(`select has_function_privilege('service_role','public.${f}','EXECUTE')`), f).toBe(true);
      expect(await one(`select has_function_privilege('authenticated','public.${f}','EXECUTE')`), f).toBe(false);
    }
    expect(await one("select has_table_privilege('authenticated','public.source_snapshot_stats','INSERT')")).toBe(false);
    expect(await one("select has_table_privilege('anon','public.source_snapshot_stats','SELECT')")).toBe(false);
    await expect(member("source_compute_snapshot_stats", [PANEL, 1000])).rejects.toThrow(/permission denied/);
  });

  it("returns the same pages as the 0068 records function wherever the scan finishes", async () => {
    const cases: unknown[][] = [];
    const ents = [null, "628", "Citibank", "P5", "P699", "nope"], periods = [null, "2026Q1", "2026-03", "1999"], qs = [null, "bank", "2026", "p1"];
    let seed = 7;
    const pick = <T,>(a: T[]) => a[(seed = (seed * 1103515245 + 12345) % 2147483648) % a.length];
    for (let i = 0; i < 120; i++) {
      const ds = pick(["fdic_panel", "big_table"]);
      cases.push([ds, null, pick(ents), null, pick(periods), pick(qs), pick([0, 0, 3, 1000, 59990]), pick([1, 5, 50, 100]), pick([null, [0], [2, 0]])]);
    }
    let compared = 0;
    for (const c of cases) {
      const now = await member("source_query_records", c);
      if (now.scanComplete === false) continue;
      const before = await member("source_query_records_0068", c);
      const { scanned, scanComplete, ...rest } = now;
      expect(scanComplete).toBe(true);
      expect(scanned).toBeGreaterThanOrEqual(0);
      expect(rest, JSON.stringify(c)).toEqual(before);
      compared++;
    }
    expect(compared).toBeGreaterThan(80);
  });

  it("stops a search at 50,000 rows and continues it from the cursor without losing a row", async () => {
    const first = await member("source_query_records", ["big_table", null, null, null, null, "zzz", 0, 50, null]);
    expect(first).toMatchObject({ rows: [], hasMore: true, nextCursor: 50000, scanned: 50000, scanComplete: false });
    const second = await member("source_query_records", ["big_table", null, null, null, null, "zzz", 50000, 50, null]);
    expect(second).toMatchObject({ rows: [], hasMore: false, nextCursor: null, scanned: 10000, scanComplete: true });
    // A search that matches late: following the cursor reaches the same rows the 0068 function returns at once.
    const args = (after: number) => ["big_table", null, null, null, null, "p699", after, 100, [0]];
    const want = await member("source_query_records_0068", args(0));
    const got: unknown[] = [];
    let after = 0;
    for (let i = 0; i < 10; i++) {
      const page = await member("source_query_records", args(after));
      got.push(...page.rows);
      if (got.length >= want.rows.length || !page.hasMore) break;
      after = page.nextCursor;
    }
    expect(got.slice(0, want.rows.length)).toEqual(want.rows);
  });

  it("counts facets exactly, reports floors past the scan limit and pages to the end", async () => {
    const panel = await member("source_facets", ["fdic_panel", null, "entity_id", null, null, 200, 250000]);
    expect(panel).toMatchObject({ dimension: "entity_id", complete: true, nextAfter: null });
    expect(panel.values).toEqual([
      { value: "3510", label: "Bank of America", rows: 4, exact: true }, { value: "628", label: "JPMorgan Chase Bank", rows: 4, exact: true },
      { value: "7213", label: "Citibank", rows: 4, exact: true },
    ]);
    expect(panel.snapshot).toMatchObject({ datasetId: "fdic_panel", snapshotId: PANEL, rows: 12, fields: 4 });
    const months: Record<string, number> = {};
    let after: string | null = null, calls = 0, total = 0;
    for (;;) {
      const page = await member("source_facets", ["big_table", null, "period", after, null, 1000, 1000]);
      calls++;
      for (const v of page.values) {
        expect(v.exact, v.value).toBe(false);
        months[v.value] = v.rows;
      }
      if (page.complete || !page.nextAfter || calls > 20) break;
      after = page.nextAfter;
    }
    expect(Object.keys(months)).toHaveLength(12);
    expect(Object.values(months).every(n => n === 1000)).toBe(true);
    const exact = await member("source_facets", ["big_table", null, "period", null, null, 1000, 1000000]);
    for (const v of exact.values) total += v.rows;
    expect(exact.complete).toBe(true);
    expect(total).toBe(60000);
    const some = await member("source_facets", ["big_table", null, "entity_id", null, "p69", 1000, 250000]);
    expect(some.values.map((v: { value: string }) => v.value)).toEqual(["P69", "P690", "P691", "P692", "P693", "P694", "P695", "P696", "P697", "P698", "P699"]);
    await expect(member("source_facets", ["big_table", null, "values", null, null, 10, 1000])).rejects.toThrow(/invalid source facet bounds/);
  });

  it("searches names, publishers, source ids and field labels, every word required", async () => {
    const hit = await member("source_find", ["bank quarter", 50]);
    expect(hit.hits.map((h: { datasetId: string }) => h.datasetId)).toEqual(["fdic_panel"]);
    expect(hit.hits[0].matched).toEqual(["name", "grain"]);
    const field = await member("source_find", ["total assets", 50]);
    expect(field.hits[0]).toMatchObject({ datasetId: "fdic_panel", matched: ["field"], fields: ["Total assets"] });
    expect((await member("source_find", ["bank generation", 50])).hits).toEqual([]);
    expect((await member("source_find", ["EIA_923", 50])).hits[0]).toMatchObject({ datasetId: "big_table", matched: ["source_id"] });
    await expect(member("source_find", ["   ", 50])).rejects.toThrow(/invalid source find bounds/);
  });

  it("backfills labels and period ranges, computes counts as the service role and shows them to members", async () => {
    const before = await member("source_get_snapshot_stats", ["big_table", null]);
    expect(before).toMatchObject({ periodMin: "2026-01", periodMax: "2026-12", periods: null, computedAt: null });
    expect(await one(`select labels from source_snapshot_stats where snapshot_id = '${PANEL}'`)).toBe("cert\ninstitution name\nreport date\ntotal assets");
    expect(await one(`select count(*)::int from source_snapshot_stats where snapshot_id = '${PANEL_NEXT}'`)).toBe(0);
    const done = await call("service_role", null, "source_compute_snapshot_stats", [PANEL, 1000]);
    expect(done).toMatchObject({ period_min: "2025Q4", period_max: "2026Q3", periods: 4, entities: 3, geographies: 0 });
    expect(await call("service_role", null, "source_compute_snapshot_stats", [BIG, 500])).toMatchObject({ periods: 12, entities: null });
    expect(await call("service_role", null, "source_compute_missing_stats", [10, 1000])).toBe(2);
  });

  it("hides unpublished snapshots and serves nothing to a user without access", async () => {
    await expect(member("source_facets", ["fdic_panel", PANEL_NEXT, "period", null, null, 10, 1000])).rejects.toThrow(/not found/);
    await expect(member("source_get_snapshot_stats", ["fdic_panel", PANEL_NEXT])).rejects.toThrow(/not found/);
    const lib = await member("source_library", []);
    expect(lib.window.map((s: { id: string }) => s.id).sort()).toEqual([PANEL, BIG].sort());
    expect(lib.datasets.map((d: { latest: { id: string } }) => d.latest.id).sort()).toEqual([PANEL, BIG].sort());
    const outsider = await call("authenticated", OUTSIDER, "source_library", []);
    expect(outsider).toEqual({ datasets: [], window: [], windowFull: false });
    expect((await call("authenticated", OUTSIDER, "source_find", ["bank", 50])).hits).toEqual([]);
    await expect(call("authenticated", OUTSIDER, "source_facets", ["fdic_panel", null, "period", null, null, 10, 1000])).rejects.toThrow(/not found/);
    await expect(call("anon", null, "source_library", [])).rejects.toThrow(/permission denied/);
  });

  it("embeds the current and earlier snapshots as PostgREST does, under the members' row-level security", async () => {
    // What PostgREST runs for the direct path's dataset select (LIBRARY_DATASET_SELECT): a lateral subquery per
    // embed on the same tables, so the snapshot policy applies inside it. The unpublished snapshot of fdic_panel is
    // given a publication time here: only row-level security can keep it out of "prev".
    await sql.unsafe(`update source_snapshots set published_at = '2026-11-25T01:00:00Z' where id = '${PANEL_NEXT}'`);
    const embedded = (cutoff: string) => as("authenticated", MEMBER, async tx => tx.unsafe(`
      select d.id, d.latest_snapshot_id,
        (select row_to_json(x)::jsonb from (select s.id, s.loaded_rows, s.column_count, s.published_at, s.retrieved_at, s.ingest->'dimensions' as dims,
           s.ingest->'constants' as consts, s.ingest->'composites' as comp, s.coverage->'refresh_provenance'->>'family' as family
           from public.source_snapshots s where s.dataset_id = d.id and s.id = d.latest_snapshot_id) x) as latest,
        coalesce((select jsonb_agg(row_to_json(y)::jsonb) from (select s.id, s.loaded_rows, s.published_at from public.source_snapshots s
           where s.dataset_id = d.id and s.published_at < $1::timestamptz order by s.published_at desc, s.id desc limit 2) y), '[]'::jsonb) as prev
      from public.source_datasets d order by d.id limit 1000`, [cutoff]));
    const rows = await embedded("2026-12-01T00:00:00Z");
    expect(rows.map(r => [r.id, r.latest?.id, r.prev.map((p: { id: string }) => p.id)])).toEqual([["big_table", BIG, [BIG]], ["fdic_panel", PANEL, [PANEL]]]);
    const outsider = await as("authenticated", OUTSIDER, async tx => tx.unsafe("select count(*)::int as n from public.source_datasets"));
    expect(outsider[0].n).toBe(0);
    // The same datasets and current snapshots as source_library().
    const lib = await member("source_library", []);
    expect(lib.datasets.map((d: { id: string; latest: { id: string; loaded_rows: number } }) => [d.id, d.latest.id, d.latest.loaded_rows]))
      .toEqual(rows.map(r => [r.id, r.latest.id, r.latest.loaded_rows]));
    await sql.unsafe(`update source_snapshots set published_at = null where id = '${PANEL_NEXT}'`);
  });

  it("feeds the app's library builder from one call", async () => {
    const raw = await member("source_library", []);
    const lib = buildLibrary(raw as LibrarySource, "source_library", "2026-11-25T21:00:00.000Z");
    expect(lib.datasets.map(r => [r.id, r.rows, r.fields, r.dimensions])).toEqual([
      ["big_table", 60000, 3, ["entity_id", "period"]], ["fdic_panel", 12, 4, ["entity_id", "entity_name", "period"]],
    ]);
    expect(lib.changes).toHaveLength(1);
  });

  it("keeps vendor archives, operations files and raw official parts private to the service role", async () => {
    const seen = await as("authenticated", MEMBER, async tx => (await tx.unsafe("select name from storage.objects order by name")).map(r => r.name));
    expect(seen).toEqual(["companies/AAPL.json", "universe.json"]);
    const service = await as("service_role", null, async tx => (await tx.unsafe("select count(*)::int as n from storage.objects"))[0].n);
    expect(service).toBe(5);
  });
});
