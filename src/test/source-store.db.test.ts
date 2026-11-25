// Runs the migration's PostgreSQL rules, including RLS. Set SOURCE_DB_URL to a local database whose
// name contains test/proof, or SOURCE_PGLITE_MODULE to an installed PGlite ESM entry for an in-memory
// PostgreSQL proof. Never connects to a hosted project and never drops an existing research table.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { importSourceSnapshot, SourcePaused } from "../../scripts/lib/source-import";
import type { SourceFileManifest, SourceSnapshot } from "../lib/sources/schema";

const url = process.env.SOURCE_DB_URL ?? "";
const local = /^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost)(?::\d+)?\/[\w-]*(?:proof|test)[\w-]*$/.test(url);
const wasm = process.env.SOURCE_PGLITE_MODULE;
const MEMBER = "00000000-0000-0000-0000-0000000000aa";
const OUTSIDER = "00000000-0000-0000-0000-0000000000bb";
const FILE = "a".repeat(64), SNAP = "b".repeat(64), NEXT = "c".repeat(64);
const STUBS = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role BYPASSRLS; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth; CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
INSERT INTO storage.buckets(id,name,public,file_size_limit) VALUES ('official-ingest-tickets','official-ingest-tickets',false,5242880) ON CONFLICT (id) DO NOTHING;
CREATE TABLE IF NOT EXISTS storage.objects(bucket_id text,name text,metadata jsonb);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS catch_all_read ON storage.objects;
CREATE POLICY catch_all_read ON storage.objects FOR SELECT TO authenticated USING(true);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE OR REPLACE FUNCTION public.has_app_access(_u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT _u='${MEMBER}'::uuid $$;
GRANT USAGE ON SCHEMA public,auth,storage TO anon,authenticated,service_role;
GRANT SELECT ON storage.objects TO authenticated,service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon,authenticated,service_role;
`;
type Db = { exec(s: string): Promise<unknown>; query(s: string, p?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>; close(): Promise<void> };
describe.skipIf(!local && !wasm)("official source store on PostgreSQL", () => {
  let db: Db;
  const one = async (s: string, p: unknown[] = []) => Object.values((await db.query(s,p)).rows[0])[0];
  const rpc = (fn: string, args: unknown[]) => one(`select public.${fn}(${args.map((_,i)=>`$${i+1}`).join(",")})`,args);
  const as = async (role: string, uid: string | null, work: () => Promise<unknown>) => {
    await db.exec("BEGIN");
    try {
      await db.exec(`SET LOCAL ROLE ${role}`);
      if (uid) await db.query("select set_config('request.jwt.claim.sub',$1,true)",[uid]);
      const result = await work(); await db.exec("COMMIT"); return result;
    } catch (e) { await db.exec("ROLLBACK"); throw e; }
  };
  const put = (rows: unknown[], owner = "proof", snap = SNAP) => as("service_role",null,()=>rpc("source_put_records",[snap,owner,JSON.stringify(rows)]));
  const publish = (snap = SNAP, owner = "proof") => as("service_role",null,()=>rpc("source_publish_snapshot",[snap,owner]));
  const claim = (snap = SNAP, owner = "proof") => as("service_role",null,()=>rpc("source_claim_snapshot",[owner,snap,180,false]));
  const row = (n: number, values: unknown[] = n === 1 ? ["000123","0","2026Q3","(D)"] : ["000124","","FY 2026",null]) => ({row_number:n,values,entity_id:values[0],period:values[2],geo_level:"county",geo_code:"01001",geo_name:"Autauga"});
  beforeAll(async () => {
    if (wasm) {
      const { PGlite } = await import(/* @vite-ignore */ wasm);
      db = new PGlite() as Db;
    } else {
      const sql=postgres(url,{max:1,onnotice:()=>undefined});
      db={exec:s=>sql.unsafe(s),query:async(s,p=[])=>({rows:await sql.unsafe(s,p as never[])}),close:()=>sql.end()};
    }
    await db.exec(STUBS);
    await db.exec(readFileSync("drizzle/migrations/0068_official_sources.sql","utf8"));
  },30000);
  beforeEach(async () => {
    await db.exec("TRUNCATE public.source_records,public.source_snapshots,public.source_datasets,public.source_files; DELETE FROM storage.objects;");
    await db.query("insert into source_files(sha256,bytes,content_type,chunks,verified_at) values($1,3,'text/csv',$2,now())",[FILE,JSON.stringify([{index:0,path:`official/objects/${FILE}`,sha256:FILE,bytes:3}])]);
    await db.query("insert into storage.objects values('datasets',$1,'{\"size\":3}')",[`official/objects/${FILE}`]);
    await db.exec("insert into source_datasets(id,name,sector,agency) values('financials/fdic','Native bank records','Financials','FDIC')");
    await db.query("insert into source_snapshots(id,dataset_id,file_sha256,source_path,expected_rows,columns,ingest) values($1,'financials/fdic',$2,'source.csv',2,$3,'{\"format\":\"csv\"}')",[SNAP,FILE,JSON.stringify(["CERT","VALUE","PERIOD","SUPPRESSED"].map((label,i)=>({key:`col${i}`,label,type:"string"})))]);
    await claim();
  });
  afterAll(async()=>{await db?.close();});

  it("hides partial snapshots and publishes exact native rows atomically", async () => {
    await put([row(1)]);
    expect(await as("authenticated",MEMBER,()=>one("select count(*)::int from source_records"))).toBe(0);
    await expect(publish()).rejects.toThrow(/publish refused/);
    expect(await one("select latest_snapshot_id from source_datasets")).toBeNull();
    await put([row(2)]); await publish();
    expect(await as("authenticated",MEMBER,()=>one("select count(*)::int from source_records"))).toBe(2);
    expect(await one("select \"values\" from source_records where row_number=1")).toEqual(["000123","0","2026Q3","(D)"]);
    expect(await one("select \"values\" from source_records where row_number=2")).toEqual(["000124","","FY 2026",null]);
    expect(await one("select retrieved_at from source_snapshots")).toBeNull();
  });
  it("rolls back the entire bad batch, refuses changed retries, and keeps row counts exact", async () => {
    await expect(put([row(1),row(2,["wrong width"])] )).rejects.toThrow(/width/);
    expect(await one("select count(*)::int from source_records")).toBe(0);
    await expect(put([row(1,["000123",0,"2026Q3",null])])).rejects.toThrow(/invalid source/);
    await put([row(1)]); await put([row(1)]);
    expect(await one("select loaded_rows::int from source_snapshots")).toBe(1);
    await expect(put([row(1,["000123","9","2026Q3",null])])).rejects.toThrow(/retry differs/);
    await expect(put([row(2)],"another-worker")).rejects.toThrow(/lease/);
    expect(await claim(SNAP,"another-worker")).toBeNull();
  });
  it("rejects explicit null lease durations and invalid owners without weakening a held lease", async () => {
    await expect(as("service_role",null,()=>rpc("source_claim_snapshot",["proof",SNAP,null,false]))).rejects.toThrow(/lease/);
    await expect(as("service_role",null,()=>rpc("source_renew_lease",[SNAP,"proof",null]))).rejects.toThrow(/lease/);
    for (const owner of [null,"", "x".repeat(201)]) {
      await expect(as("service_role",null,()=>rpc("source_claim_snapshot",[owner,SNAP,180,false]))).rejects.toThrow(/lease/);
      await expect(as("service_role",null,()=>rpc("source_renew_lease",[SNAP,owner,180]))).rejects.toThrow(/lease/);
      await expect(as("service_role",null,()=>rpc("source_release_snapshot",[SNAP,owner,false,null]))).rejects.toThrow(/lease/);
    }
    expect(await one("select lease_owner from source_snapshots")).toBe("proof");
    expect(await one("select lease_until > now() from source_snapshots")).toBe(true);
  });
  it("cannot write or publish an unclaimed snapshot using a null owner or null lease expiry", async () => {
    await db.exec("update source_snapshots set lease_owner=null,lease_until=null");
    await expect(as("service_role",null,()=>rpc("source_put_records",[SNAP,null,JSON.stringify([row(1)])]))).rejects.toThrow(/lease/);
    await claim(); await put([row(1),row(2)]);
    await db.exec("update source_snapshots set lease_until=null");
    await expect(put([row(2)])).rejects.toThrow(/lease/);
    await expect(publish()).rejects.toThrow(/lease/);
    await db.exec("update source_snapshots set lease_owner=null");
    await expect(as("service_role",null,()=>rpc("source_publish_snapshot",[SNAP,null]))).rejects.toThrow(/lease/);
    expect(await one("select status from source_snapshots")).toBe("staging");
  });
  it("requires verified, present raw bytes and keeps verified file definitions immutable", async () => {
    await put([row(1),row(2)]);
    await db.exec("update source_files set verified_at=null");
    await expect(publish()).rejects.toThrow(/hash has not been verified/);
    await db.exec("update source_files set verified_at=now(); delete from storage.objects");
    await expect(publish()).rejects.toThrow(/object is missing/);
    await expect(db.exec("update source_files set bytes=4")).rejects.toThrow(/immutable/);
  });
  it("keeps the last complete snapshot visible while its successor is partial", async () => {
    await put([row(1),row(2)]); await publish();
    await db.query("insert into source_snapshots(id,dataset_id,file_sha256,source_path,expected_rows,columns,ingest) select $1,dataset_id,file_sha256,source_path,expected_rows,columns,ingest from source_snapshots where id=$2",[NEXT,SNAP]);
    await claim(NEXT); await put([row(1)],"proof",NEXT);
    await expect(publish(NEXT)).rejects.toThrow(/publish refused/);
    expect(await one("select latest_snapshot_id from source_datasets")).toBe(SNAP);
    await put([row(2)],"proof",NEXT); await publish(NEXT);
    expect(await one("select latest_snapshot_id from source_datasets")).toBe(NEXT);
    await expect(db.exec(`update source_snapshots set expected_rows=3 where id='${NEXT}'`)).rejects.toThrow(/immutable/);
  });
  it("enforces native filters, keyset bounds and ordered field projection in PostgreSQL", async () => {
    await put([row(1),row(2)]); await publish();
    const page=await as("authenticated",MEMBER,()=>rpc("source_query_records",["financials/fdic",SNAP,null,null,null,null,0,1,[1,0]])) as {rows:{values:unknown[]}[],nextCursor:number,hasMore:boolean};
    const list=await as("authenticated",MEMBER,()=>rpc("source_list_datasets",[null,null,null,null,1])) as {datasets:unknown[]};
    expect(list.datasets).toHaveLength(1);
    expect(page.rows[0].values).toEqual(["0","000123"]); expect(page.nextCursor).toBe(1); expect(page.hasMore).toBe(true);
    const second=await as("authenticated",MEMBER,()=>rpc("source_query_records",["financials/fdic",SNAP,null,null,"FY 2026",null,1,100,[0,1,2,3]])) as {rows:{values:unknown[]}[],hasMore:boolean};
    expect(second.rows[0].values).toEqual(["000124","","FY 2026",null]); expect(second.hasMore).toBe(false);
    await expect(as("authenticated",MEMBER,()=>rpc("source_query_records",["financials/fdic",SNAP,null,null,null,null,0,101,null]))).rejects.toThrow(/bounds/);
    await expect(as("authenticated",MEMBER,()=>rpc("source_query_records",["financials/fdic",SNAP,null,null,null,null,0,null,null]))).rejects.toThrow(/bounds/);
    await expect(as("authenticated",MEMBER,()=>rpc("source_query_records",["financials/fdic",SNAP,null,null,null,null,null,1,null]))).rejects.toThrow(/bounds/);
    await expect(as("authenticated",MEMBER,()=>rpc("source_list_datasets",[null,null,null,null,null]))).rejects.toThrow(/bounds/);
    await expect(as("authenticated",MEMBER,()=>rpc("source_query_records",["financials/fdic",SNAP,null,null,null,null,0,1,[4]]))).rejects.toThrow(/projection/);
    await expect(as("authenticated",MEMBER,()=>rpc("source_query_records",["another/dataset",SNAP,null,null,null,null,0,1,null]))).rejects.toThrow(/not found/);
  });
  it("denies anonymous/nonmember reads and member writes, even with permissive inherited defaults", async () => {
    await put([row(1),row(2)]); await publish();
    expect(await as("authenticated",OUTSIDER,()=>one("select count(*)::int from source_records"))).toBe(0);
    await expect(as("anon",null,()=>one("select count(*) from source_records"))).rejects.toThrow(/permission denied/);
    await expect(as("authenticated",MEMBER,()=>rpc("source_claim_snapshot",["intruder",SNAP,180,false]))).rejects.toThrow(/permission denied/);
    await expect(as("authenticated",MEMBER,()=>db.exec("update source_datasets set name='changed'"))).rejects.toThrow(/permission denied/);
    await db.exec("insert into storage.objects values('official-ingest-tickets','private.json','{\"size\":1}')");
    expect(await as("authenticated",MEMBER,()=>one("select count(*)::int from storage.objects where bucket_id='official-ingest-tickets'"))).toBe(0);
    expect(await as("authenticated",MEMBER,()=>one("select count(*)::int from storage.objects where bucket_id='datasets'"))).toBe(1);
  });
  it("rejects missing manifest fields and quarantined publication", async () => {
    expect(await one("select source_columns_valid('[{\"key\":\"a\",\"type\":\"string\"}]')")).toBe(false);
    expect(await one("select source_columns_valid('[{\"key\":\"a\",\"label\":\"A\"}]')")).toBe(false);
    expect(await one("select source_chunks_valid($1,3)",[JSON.stringify([{path:`official/objects/${FILE}`,sha256:FILE,bytes:3}])])).toBe(false);
    await put([row(1),row(2)]);
    await db.exec("update source_snapshots set quality='{\"quarantined\":true}'");
    await expect(publish()).rejects.toThrow(/quarantined/);
    expect(await one("select latest_snapshot_id from source_datasets")).toBeNull();
  });
  it("makes old completed snapshots readable without regressing a newer retrieval pointer", async () => {
    await db.exec("update source_snapshots set retrieved_at='2026-11-25T00:00:00Z'");
    await put([row(1),row(2)]); await publish();
    await db.query("insert into source_snapshots(id,dataset_id,file_sha256,source_path,expected_rows,columns,ingest,retrieved_at,created_at) select $1,dataset_id,file_sha256,source_path,expected_rows,columns,ingest,'2025-01-01T00:00:00Z',now()+interval '1 day' from source_snapshots where id=$2",[NEXT,SNAP]);
    await claim(NEXT); await put([row(1),row(2)],"proof",NEXT); await publish(NEXT);
    expect(await one("select latest_snapshot_id from source_datasets")).toBe(SNAP);
    expect(await one("select status from source_snapshots where id=$1",[NEXT])).toBe("ready");
  });
  it("streams verified gzip bytes, resumes a committed prefix after interruption, and only then publishes", async () => {
    const bytes=gzipSync(Buffer.from('CERT,VALUE,PERIOD,SUPPRESSED\r\n000123,0,2026Q3,(D)\r\n000124,,FY 2026,\r\n'));
    const sha=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex");
    const pieces=[bytes.subarray(0,17),bytes.subarray(17)];
    const file:SourceFileManifest={sha256:sha(bytes),bytes:bytes.length,content_type:"application/gzip",provenance:{},chunks:pieces.map((b,index)=>({index,path:`official/objects/${sha(b)}`,sha256:sha(b),bytes:b.length}))};
    await db.query("insert into source_files(sha256,bytes,content_type,chunks) values($1,$2,$3,$4)",[file.sha256,file.bytes,file.content_type,JSON.stringify(file.chunks)]);
    for(const c of file.chunks)await db.query("insert into storage.objects values('datasets',$1,$2)",[c.path,JSON.stringify({size:c.bytes})]);
    await db.query("update source_snapshots set file_sha256=$1,ingest=$2 where id=$3",[file.sha256,JSON.stringify({format:"csv",compression:"gzip",encoding:"utf-8",delimiter:",",header_rows:1,dimensions:{entity_id:0,period:2}}),SNAP]);
    const snapshot=async()=>await one("select to_jsonb(s) from source_snapshots s where id=$1",[SNAP]) as SourceSnapshot;
    let interrupt=true;
    const io={readChunk:async(c:{index:number})=>pieces[c.index],active:()=>true,progress:()=>undefined,
      put:async(rows:unknown[])=>{await put(rows);if(interrupt){interrupt=false;throw new SourcePaused("simulated process interruption after commit");}},
      verified:async(hash:string)=>{await db.query("update source_files set verified_at=now() where sha256=$1",[hash]);},
      publish:async()=>{await publish();}};
    await expect(importSourceSnapshot(await snapshot(),file,io,{deadline:Date.now()+60000,batchRows:1})).rejects.toThrow(/interruption/);
    expect(await one("select loaded_rows::int from source_snapshots where id=$1",[SNAP])).toBe(1);
    expect(await as("authenticated",MEMBER,()=>one("select count(*)::int from source_records"))).toBe(0);
    await importSourceSnapshot(await snapshot(),file,io,{deadline:Date.now()+60000,batchRows:1});
    expect(await one("select status from source_snapshots where id=$1",[SNAP])).toBe("ready");
    expect(await one("select \"values\" from source_records where row_number=2")).toEqual(["000124","","FY 2026",""]);
  });
});
