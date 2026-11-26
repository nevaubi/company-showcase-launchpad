// Runs migration 0070 on a real PostgreSQL: applied twice over 0067, 0068 and 0069, the table's checks on what the
// worker writes, the upsert the worker sends, row-level security for members, outsiders and anonymous callers, the
// grants, the cascade from source_snapshots, and that nothing that existed before the file changed. Set SOURCE_DB_URL
// to a local database whose name contains test or proof; nothing here connects to a hosted project.
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.SOURCE_DB_URL ?? "";
const local = /^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost)(?::\d+)?\/[\w-]*(?:proof|test)[\w-]*$/.test(url);
const MEMBER = "00000000-0000-0000-0000-0000000000aa";
const OUTSIDER = "00000000-0000-0000-0000-0000000000bb";
const FILE = "f".repeat(64);
const READY = "1".repeat(64), STAGING = "2".repeat(64), GONE = "3".repeat(64);
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
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon,authenticated,service_role;
`;
const M67 = readFileSync("drizzle/migrations/0067_abs_ee.sql", "utf8");
const M68 = readFileSync("drizzle/migrations/0068_official_sources.sql", "utf8");
const M69 = readFileSync("drizzle/migrations/0069_official_reads.sql", "utf8");
const M70 = readFileSync("drizzle/migrations/0070_field_counts.sql", "utf8");
const columns = (labels: string[]) => JSON.stringify(labels.map((label, i) => ({ key: `col${i}`, label, type: "string" })));
// Rows of the catalogue the test compares before and after 0070; nested values stay untyped on purpose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/** A row as the worker sends it (scripts/lib/field-counter.ts). */
const row = (snapshot: string, position: number, over: Row = {}): Row => ({
  snapshot_id: snapshot, position, filled: 10, blank: 1, missing: 1, numeric_rows: 0, value_cap: 1000, distinct_values: 3, capped: null,
  top: [["A", 6, 1], ["B", 3, 2], ["C", 1, 5]], other_rows: 0, other_values: 0, ...over,
});

describe.skipIf(!local)("field counts of migration 0070 on PostgreSQL", () => {
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
  /** The statement PostgREST runs for the worker's upsert: insert, or replace every column sent, on the key. */
  const upsert = (tx: postgres.TransactionSql, rows: Row[]) => {
    const keys = Object.keys(rows[0]);
    const values = rows.map((r, i) => `(${keys.map((_, k) => `$${i * keys.length + k + 1}`).join(",")})`).join(",");
    // postgres.js writes a jsonb parameter as JSON itself, so the list goes as the array it is
    const params = rows.flatMap(r => keys.map(k => r[k]));
    return tx.unsafe(
      `insert into public.source_field_counts (${keys.join(",")}) values ${values} on conflict (snapshot_id, position) do update set ${keys.filter(k => k !== "snapshot_id" && k !== "position").map(k => `${k} = excluded.${k}`).join(", ")}`,
      params as never[],
    );
  };
  const catalogue = () =>
    sql.unsafe(`select 'grant' as kind, table_name as name, grantee || ':' || privilege_type as what from information_schema.role_table_grants where table_schema = 'public' and table_name like 'source_%' and table_name <> 'source_field_counts'
      union all select 'policy', tablename, policyname || ':' || qual from pg_policies where tablename <> 'source_field_counts'
      union all select 'function', p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)) || ':' || coalesce(array_to_string(p.proacl, ','), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'source_%' and p.proname <> 'source_field_top_valid'
      union all select 'column', table_name, column_name || ':' || data_type || ':' || is_nullable from information_schema.columns where table_schema = 'public' and table_name like 'source_%' and table_name <> 'source_field_counts'
      order by 1, 2, 3`);

  let before: Row[] = [];
  beforeAll(async () => {
    sql = postgres(url, { max: 1, onnotice: () => undefined });
    await sql.unsafe(STUBS);
    await sql.unsafe(M67);
    await sql.unsafe(M68);
    await sql.unsafe(M69);
    await sql.unsafe("DROP TABLE IF EXISTS public.source_field_counts; DROP FUNCTION IF EXISTS public.source_field_top_valid(jsonb, bigint, bigint, integer, integer);");
    await sql.unsafe("TRUNCATE public.source_snapshot_stats, public.source_records, public.source_snapshots, public.source_datasets, public.source_files CASCADE;");
    before = [...(await catalogue())];
    await sql.unsafe(M70);
    await sql.unsafe(M70);
    await sql.unsafe(`insert into source_files(sha256,bytes,content_type,chunks,verified_at) values('${FILE}',3,'text/csv','[{"index":0,"path":"official/objects/${FILE}","sha256":"${FILE}","bytes":3}]',now())`);
    await sql.unsafe(`insert into source_datasets(id,name,sector,agency) values ('nrsro','Ratings of portfolio securities','01_financials','SEC'),('gone','A table that is removed','01_financials','SEC')`);
    await sql.unsafe(`insert into source_snapshots(id,dataset_id,file_sha256,source_path,expected_rows,columns,ingest) values
      ('${READY}','nrsro','${FILE}','a.tsv',12,'${columns(["TYPE", "NAMEOFNRSRO", "RATING"])}','{"format":"csv","dimensions":{}}'),
      ('${STAGING}','nrsro','${FILE}','a.tsv',12,'${columns(["TYPE", "NAMEOFNRSRO", "RATING"])}','{"format":"csv","dimensions":{}}'),
      ('${GONE}','gone','${FILE}','b.tsv',12,'${columns(["A"])}','{"format":"csv","dimensions":{}}')`);
    await sql.unsafe(`update source_snapshots set status='ready', loaded_rows=expected_rows, published_at=now() where id in ('${READY}','${GONE}')`);
    await sql.unsafe(`update source_datasets set latest_snapshot_id = case id when 'nrsro' then '${READY}' else '${GONE}' end`);
  }, 120_000);
  afterAll(async () => { await sql?.end(); });

  it("applies twice and changes nothing that existed before it", async () => {
    expect([...(await catalogue())]).toEqual(before);
    expect(await one("select count(*)::int from pg_policies where tablename = 'source_field_counts'")).toBe(1);
    expect(await one("select string_agg(a.attname, ',' order by k.ord) from pg_index i join pg_class c on c.oid = i.indrelid cross join lateral unnest(i.indkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = c.oid and a.attnum = k.attnum where c.relname = 'source_field_counts' and i.indisprimary")).toBe("snapshot_id,position");
    expect(await one("select confdeltype from pg_constraint where conrelid = 'public.source_field_counts'::regclass and contype = 'f'")).toBe("c");
  });

  it("grants members SELECT only, the service role SELECT, INSERT and UPDATE, and anonymous callers nothing", async () => {
    const grants = [...(await sql.unsafe("select grantee, string_agg(privilege_type, ',' order by privilege_type) as p from information_schema.role_table_grants where table_name = 'source_field_counts' and grantee in ('anon','authenticated','service_role') group by grantee order by grantee"))];
    expect(grants).toEqual([{ grantee: "authenticated", p: "SELECT" }, { grantee: "service_role", p: "INSERT,SELECT,UPDATE" }]);
    expect(await one("select has_function_privilege('authenticated', 'public.source_field_top_valid(jsonb,bigint,bigint,integer,integer)', 'EXECUTE')")).toBe(false);
    expect(await one("select has_function_privilege('anon', 'public.source_field_top_valid(jsonb,bigint,bigint,integer,integer)', 'EXECUTE')")).toBe(false);
    await expect(as("anon", null, tx => tx.unsafe("select * from public.source_field_counts"))).rejects.toThrow(/permission denied/);
    await expect(as("authenticated", MEMBER, tx => upsert(tx, [row(READY, 0)]))).rejects.toThrow(/permission denied/);
  });

  it("takes the worker's rows and replaces them on a second write of the same snapshot", async () => {
    const counted = await as("service_role", null, async tx => {
      await upsert(tx, [row(READY, 0), row(READY, 1, { distinct_values: null, capped: "values", top: [], other_rows: 10, other_values: null, numeric_rows: 4 }), row(READY, 2)]);
      await upsert(tx, [row(READY, 2, { top: [["A", 5, 1], ["B", 4, 2], ["C", 1, 5]] })]);
      return [...(await tx.unsafe("select position, distinct_values, capped, top, other_rows from public.source_field_counts where snapshot_id = $1 order by position", [READY]))];
    });
    expect(counted).toEqual([
      { position: 0, distinct_values: 3, capped: null, top: [["A", 6, 1], ["B", 3, 2], ["C", 1, 5]], other_rows: "0" },
      { position: 1, distinct_values: null, capped: "values", top: [], other_rows: "10" },
      { position: 2, distinct_values: 3, capped: null, top: [["A", 5, 1], ["B", 4, 2], ["C", 1, 5]], other_rows: "0" },
    ]);
  });

  it("refuses rows whose list does not add up, is out of order, too long or malformed", async () => {
    const bad: [string, Row][] = [
      ["rows do not add up", { other_rows: 1 }],
      ["values do not add up", { other_values: 1 }],
      ["out of order", { top: [["A", 3, 1], ["B", 6, 2], ["C", 1, 5]] }],
      ["an empty value", { top: [["", 6, 1], ["B", 3, 2], ["C", 1, 5]] }],
      ["a fraction", { top: [["A", 6.5, 1], ["B", 2.5, 2], ["C", 1, 5]] }],
      ["no first row", { top: [["A", 6, 0], ["B", 3, 2], ["C", 1, 5]] }],
      ["not a triple", { top: [["A", 6], ["B", 3, 2], ["C", 1, 5]] }],
      ["capped with a list", { distinct_values: null, capped: "values", other_values: null }],
      ["exact without a distinct count", { distinct_values: null, other_values: null }],
      ["more values than the cap", { value_cap: 2 }],
      ["more numbers than filled records", { numeric_rows: 11 }],
      ["a field position past the limit", { position: 16384 }],
      ["an unknown reason", { distinct_values: null, capped: "length", top: [], other_rows: 10, other_values: null }],
      ["more than 50 values", { filled: 51, distinct_values: 51, top: Array.from({ length: 51 }, (_, i) => [`v${String(i).padStart(2, "0")}`, 1, i + 1]) }],
    ];
    for (const [why, over] of bad)
      await expect(as("service_role", null, tx => upsert(tx, [row(READY, 5, over)])), why).rejects.toThrow(/violates check constraint/);
    // fifty values are allowed
    const fifty = row(READY, 5, { filled: 50, distinct_values: 50, top: Array.from({ length: 50 }, (_, i) => [`v${String(i).padStart(2, "0")}`, 1, i + 1]) });
    expect(await as("service_role", null, async tx => { await upsert(tx, [fifty]); return (await tx.unsafe("select count(*)::int as n from public.source_field_counts where position = 5"))[0].n; })).toBe(1);
  });

  it("shows members the rows of published snapshots only, and outsiders nothing", async () => {
    await sql.unsafe("delete from public.source_field_counts");
    await sql.unsafe(`insert into public.source_field_counts (snapshot_id, position, filled, blank, missing, numeric_rows, value_cap, distinct_values, top, other_rows, other_values)
      values ('${READY}', 0, 10, 1, 1, 0, 1000, 3, '[["A",6,1],["B",3,2],["C",1,5]]', 0, 0), ('${STAGING}', 0, 10, 1, 1, 0, 1000, 3, '[["A",6,1],["B",3,2],["C",1,5]]', 0, 0)`);
    const seen = await as("authenticated", MEMBER, async tx => [...(await tx.unsafe("select snapshot_id from public.source_field_counts"))].map(r => r.snapshot_id));
    expect(seen).toEqual([READY]);
    expect(await as("authenticated", OUTSIDER, async tx => (await tx.unsafe("select snapshot_id from public.source_field_counts")).length)).toBe(0);
    expect(await as("service_role", null, async tx => (await tx.unsafe("select snapshot_id from public.source_field_counts")).length)).toBe(2);
  });

  it("goes with its snapshot when the snapshot is removed", async () => {
    await sql.unsafe(`insert into public.source_field_counts (snapshot_id, position, filled, blank, missing, numeric_rows, value_cap, distinct_values, top, other_rows, other_values) values ('${GONE}', 0, 12, 0, 0, 0, 1000, 1, '[["x",12,1]]', 0, 0)`);
    await sql.unsafe(`update source_datasets set latest_snapshot_id = null where id = 'gone'`);
    await sql.unsafe(`delete from source_snapshots where id = '${GONE}'`);
    expect(await one(`select count(*)::int from public.source_field_counts where snapshot_id = '${GONE}'`)).toBe(0);
  });
});
