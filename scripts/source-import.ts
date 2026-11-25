/**
 * Import reviewed native CSV/gzip snapshots from private content-addressed storage.
 *   bun scripts/source-import.ts --all --max-snapshots=1 --max-runtime-seconds=480
 *   bun scripts/source-import.ts --snapshot=<sha256> [--retry-failed]
 * Failed definitions are quarantined. Explicit --retry-failed is required to reconsider them.
 * Interrupted runs retain a verified contiguous prefix; publication is atomic in PostgreSQL.
 */
import { randomUUID } from "node:crypto";
import { importSourceSnapshot, SourceDataError, SourcePaused } from "./lib/source-import";
import type { SourceFileManifest, SourceSnapshot } from "../src/lib/sources/schema";

const args=Object.fromEntries(process.argv.slice(2).map(a=>{const [k,...v]=a.replace(/^--/,"").split("=");return [k,v.join("=")||"true"];}));
if ((!args.all && !args.snapshot) || (args.all && args.snapshot)) throw new Error("Use exactly one of --all or --snapshot=<sha256>");
if (args.snapshot && !/^[0-9a-f]{64}$/.test(args.snapshot)) throw new Error("Invalid snapshot SHA-256");
const max=Number(args["max-snapshots"]??(args.snapshot?1:1000));
const seconds=Number(args["max-runtime-seconds"]??480);
if (!Number.isSafeInteger(max)||max<1||max>10000||!Number.isFinite(seconds)||seconds<15||seconds>172800) throw new Error("Invalid source import bounds");
// A single stalled transfer must leave time for the caller's 600-second execution window.
process.env.DB_FETCH_TIMEOUT_MS ??= "60000";
process.env.DB_STORAGE_TIMEOUT_MS ??= "90000";
const {sb,dbGate}=await import("./lib/supa");
const deadline=Date.now()+seconds*1000;
const owner=`source:${process.pid}:${randomUUID()}`;
const log=(data:Record<string,unknown>)=>console.log(JSON.stringify(data));
async function rpc<T>(name:string,params:Record<string,unknown>):Promise<T>{
  const {data,error}=await sb.rpc(name,params);
  if(error){
    if(/invalid source row|source row width|retry differs|contiguous prefix|expected.*stored|snapshot definition|byte length differs/.test(error.message)) throw new SourceDataError(error.message);
    throw new Error(`${name}: ${error.message}`);
  }
  return data as T;
}
let published=0; let failed=0; let paused=false;
for(let n=0;n<max && Date.now()<deadline;n++){
  await dbGate("official-source-claim");
  const snapshot=await rpc<SourceSnapshot|null>("source_claim_snapshot",{_owner:owner,_snapshot_id:args.snapshot??null,_ttl_seconds:180,_retry_failed:args["retry-failed"]==="true"});
  if(!snapshot)break;
  let active=true; let renewing=false;
  const heartbeat=setInterval(async()=>{
    if(renewing)return; renewing=true;
    try { if(!await rpc<boolean>("source_renew_lease",{_snapshot_id:snapshot.id,_owner:owner,_ttl_seconds:180}))active=false; }
    catch { active=false; }
    finally {renewing=false;}
  },60000);
  try {
    const {data:file,error}=await sb.from("source_files").select("sha256,bytes,content_type,chunks,provenance,verified_at").eq("sha256",snapshot.file_sha256).single();
    if(error||!file)throw new Error(`Source manifest unavailable: ${error?.message??"missing"}`);
    await importSourceSnapshot(snapshot,file as SourceFileManifest,{
      active:()=>active,
      progress:log,
      async readChunk(chunk){
        await dbGate("official-source-download");
        if(!active)throw new SourcePaused("Source lease was lost");
        const result=await sb.storage.from("datasets").download(chunk.path);
        if(result.error||!result.data)throw new Error(`Source chunk ${chunk.index} download failed: ${result.error?.message??"empty response"}`);
        return new Uint8Array(await result.data.arrayBuffer());
      },
      async put(rows){
        await dbGate("official-source-store");
        await rpc("source_put_records",{_snapshot_id:snapshot.id,_owner:owner,_rows:rows});
      },
      async verified(sha256){
        const saved=await sb.from("source_files").update({verified_at:new Date().toISOString()}).eq("sha256",sha256);
        if(saved.error)throw new Error(`Source verification receipt failed: ${saved.error.message}`);
      },
      async publish(){await rpc("source_publish_snapshot",{_snapshot_id:snapshot.id,_owner:owner});},
    },{deadline});
    published++;
  } catch(e){
    const message=(e as Error).message;
    const quarantine=e instanceof SourceDataError || /incorrect header check|invalid.*compressed|unexpected end of file/i.test(message);
    await rpc("source_release_snapshot",{_snapshot_id:snapshot.id,_owner:owner,_failed:quarantine,_error:message}).catch(()=>undefined);
    if(e instanceof SourcePaused){paused=true;log({event:"source_import_paused",snapshot_id:snapshot.id,reason:message});break;}
    failed++;log({event:quarantine?"source_snapshot_quarantined":"source_import_retry_later",snapshot_id:snapshot.id,error:message});
    // Do not spin on a transient outage or on the same explicitly selected failed definition.
    if(!quarantine||args.snapshot)break;
  } finally {clearInterval(heartbeat);}
}
log({event:"source_import_finished",published,failed,paused});
if(failed)process.exitCode=1;
