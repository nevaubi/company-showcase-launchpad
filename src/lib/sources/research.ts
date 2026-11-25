import { z } from "zod";
import { datasetHref } from "./links";
import { sourceDescription } from "./presentation";
import type { SourceColumn, SourceDatasetDetail, SourceDatasetList, SourceJson, SourceListFilters, SourceRecordPage, SourceRecordQuery, SourceSnapshot } from "./schema";
import type { OfficialSourceToolName } from "./research-tools";

/** Same bounded scale as existing research tools; previews and history compact whole official rows. */
export const OFFICIAL_RESEARCH_MAX_CHARS = 9000;
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const id = z.string().min(1).max(1024);
const nullableText = (max: number) => z.string().min(1).max(max).nullish().transform(v => v ?? undefined);
const boundedInteger = (min: number, max: number, fallback: number) => z.number().int().min(min).max(max).nullish().transform(v => v ?? fallback);
export const officialSearchInput = z.object({
  query: z.string().max(200).nullish().transform(v => v || undefined), sector: nullableText(512), agency: nullableText(512),
  after: nullableText(1024), limit: boundedInteger(1,20,10),
}).strict();
export const officialInspectInput = z.object({
  dataset_id:id, snapshot_id:hash.nullish().transform(v=>v??undefined), field_search:z.string().max(200).nullish().transform(v=>v??""),
  field_after:boundedInteger(-1,16383,-1),limit:boundedInteger(1,20,8),include_definitions:z.boolean().nullish().transform(v=>v??false),
}).strict();
export const officialRecordsInput = z.object({
  dataset_id:id,snapshot_id:hash,fields:z.array(z.string().min(1).max(512)).min(1).max(12),
  entity:nullableText(512),geography:nullableText(512),period:nullableText(512),
  after:boundedInteger(0,Number.MAX_SAFE_INTEGER,0),limit:boundedInteger(1,20,10),
}).strict();
type InspectInput = z.infer<typeof officialInspectInput>;
type RecordsInput = z.infer<typeof officialRecordsInput>;
type JsonObject = Record<string, SourceJson>;
export type OfficialResearchResult = { output:string; summary:string };
/** Production binds only the existing app-access-protected server functions. Tests bind local fixtures. */
export type OfficialSourceReader = {
  list(filters:SourceListFilters):Promise<SourceDatasetList>;
  inspect(id:string,snapshotId?:string):Promise<SourceDatasetDetail>;
  query(input:SourceRecordQuery):Promise<SourceRecordPage>;
};

function ready(detail:SourceDatasetDetail,datasetId:string,snapshotId?:string):SourceSnapshot {
  const snapshot=detail.snapshot;
  if(detail.dataset.id!==datasetId || !snapshot || snapshot.dataset_id!==datasetId || snapshot.status!=="ready" || snapshot.quality.quarantined===true || snapshot.loaded_rows!==snapshot.expected_rows || (snapshotId!==undefined && snapshot.id!==snapshotId))
    throw new Error("A complete, published snapshot matching this source is required. Search or inspect the source again.");
  return snapshot;
}

/** The table page of a pinned snapshot, with the record filters and cursor; built by `links.ts`, so tools and screens write one address. */
export function officialSourceHref(datasetId:string,snapshotId:string,after=0,filters:Pick<RecordsInput,"entity"|"geography"|"period">={entity:undefined,geography:undefined,period:undefined}) {
  return datasetHref(datasetId,{snapshot:snapshotId,after:after>0?after:undefined,entity:filters.entity,geography:filters.geography,period:filters.period});
}
/** The address of one record, with the row number left as `{row_number}` for the reader to fill. */
export function officialRecordHrefTemplate(datasetId:string,snapshotId:string) {
  return `${datasetHref(datasetId,{snapshot:snapshotId})}&row={row_number}`;
}

export function resolveOfficialFields(columns:SourceColumn[],requested:string[]):number[] {
  const positions=requested.map(field=>{
    const keys=columns.flatMap((c,i)=>c.key===field?[i]:[]);
    const matches=keys.length?keys:columns.flatMap((c,i)=>c.label===field?[i]:[]);
    if(!matches.length) throw new Error(`Unknown exact field ${JSON.stringify(field)}. Use inspect_official_source to choose its field key.`);
    if(matches.length!==1) throw new Error(`Ambiguous native field label ${JSON.stringify(field)}. Use an exact field key: ${matches.slice(0,12).map(i=>`${columns[i].key} (position ${i})`).join(", ")}.`);
    return matches[0];
  });
  if(new Set(positions).size!==positions.length) throw new Error("Choose distinct native fields; two selectors identify the same column.");
  return positions;
}
function descriptor(column:SourceColumn,position:number,definitions=false):JsonObject {
  const result:JsonObject={key:column.key,position,label:column.label,type:column.type};
  for(const key of ["title","unit","scale","basis","native_type","period_basis"] as const) if(column[key]!==undefined) result[key]=column[key]!;
  if(definitions) for(const key of ["description","unit_evidence"] as const) if(column[key]!==undefined) result[key]=column[key]!;
  return result;
}
const COVERAGE_SCOPE = [
  "identity_rule","entity_type","entity_id_column","population_role","period_frequency","period_components","period_index_is_native_text","period_search_index_rule","period_index_rule","native_period_field","native_period","geography_rule","geo_code_search_index_rule","geo_level","index_not_currency_price","operator_fields_available","publication_time_known","availability_time_known","archive_population_is_not_unique_entity_count",
  "cohort_date","cohort_selection","cohort_size","reporting_institutions","missing_certificates","missing_institution_policy",
  "requested_but_not_returned_fields","requested_but_not_returned_count","omitted_field_policy","requested_field_count","returned_field_count",
] as const;
function sourceScope(detail:SourceDatasetDetail,full:boolean):JsonObject {
  const d=detail.dataset,s=detail.snapshot!;
  const coverage:JsonObject={};
  for(const key of COVERAGE_SCOPE) if(s.coverage[key]!==undefined) coverage[key]=s.coverage[key];
  const scope:JsonObject={grain:d.grain,units:d.units,notes:d.notes,declared_coverage:coverage};
  if(full) {
    scope.description=sourceDescription(d.description);
    scope.search_indices=Object.fromEntries(Object.entries(s.ingest.dimensions).map(([dimension,position])=>[dimension,{key:s.columns[position].key,label:s.columns[position].label,position}]));
    scope.search_constants=Object.fromEntries(Object.entries(s.ingest.constants??{}).filter(([dimension])=>dimension!=="source_url"));
  }
  if(s.ingest.composites?.period || s.ingest.geo_code_format) scope.search_index_derivations={
    ...(s.ingest.composites?.period?{period:{...s.ingest.composites.period,field_keys:s.ingest.composites.period.indices.map(i=>s.columns[i].key)}}:{}),
    ...(s.ingest.geo_code_format?{geo_code_format:s.ingest.geo_code_format}:{}),
  };
  return scope;
}
/** Which snapshot was read and whether a newer one is published (rev-app S7): a pinned id kept from history is not "the latest". */
function identity(detail:SourceDatasetDetail,snapshot:SourceSnapshot):JsonObject {
  const latest=detail.dataset.latest_snapshot_id;
  return {dataset_id:detail.dataset.id,snapshot_id:snapshot.id,latest_snapshot_id:latest,is_latest_snapshot:latest===snapshot.id,
    name:detail.dataset.name,sector:detail.dataset.sector,agency:detail.dataset.agency,
    source_url:detail.dataset.source_url,source_path:snapshot.source_path,file_sha256:snapshot.file_sha256,retrieved_at:snapshot.retrieved_at,published_at:snapshot.published_at,
    total_snapshot_rows:snapshot.expected_rows,app_url:officialSourceHref(detail.dataset.id,snapshot.id)};
}
/** Greedy prefix of complete items. A non-fitting first item leaves the cursor unchanged. */
function wholePage<T>(items:T[],build:(included:T[])=>JsonObject,budget=OFFICIAL_RESEARCH_MAX_CHARS):{output:string;included:T[]} {
  let included:T[]=[];
  let output=JSON.stringify(build(included));
  if(output.length>budget) throw new Error("Official source metadata exceeds this bounded response. Request fewer fields or definitions, or open the source explorer. No source values were clipped.");
  for(const item of items) {
    const next=[...included,item];
    const text=JSON.stringify(build(next));
    if(text.length>budget) break;
    included=next;output=text;
  }
  return {output,included};
}

function inspectResult(detail:SourceDatasetDetail,input:InspectInput):OfficialResearchResult {
  const snapshot=ready(detail,input.dataset_id,input.snapshot_id);
  const needle=input.field_search.toLocaleLowerCase();
  const matches=snapshot.columns.map((column,position)=>({column,position})).filter(({column})=>!needle || [column.key,column.label,column.title,column.description,column.unit].filter(Boolean).join(" ").toLocaleLowerCase().includes(needle));
  const available=matches.filter(f=>f.position>input.field_after);
  const candidates=available.slice(0,input.limit).map(f=>descriptor(f.column,f.position,input.include_definitions));
  const {output,included}=wholePage(candidates,fields=>({
    kind:"official_source",tool:"inspect_official_source",...identity(detail,snapshot),scope:sourceScope(detail,true),
    native_value_rule:"Values remain original strings/null. Unit and scale metadata are descriptive; no conversion or ticker/entity inference.",
    field_search:input.field_search,field_after:input.field_after,total_columns:snapshot.columns.length,total_matching_fields:matches.length,fields,
    remaining_fields:available.length-fields.length,next_field_after:available.length>fields.length?(fields.at(-1)?.position??input.field_after):null,
    requires_narrower_fields:fields.length<candidates.length,
    hint:fields.length<candidates.length?"Request fewer field definitions, a narrower field search, or open the pinned explorer; no field text was clipped.":null,
  }));
  return {output,summary:`Inspected ${included.length} native fields · ${detail.dataset.name}`};
}

function verifyPage(page:SourceRecordPage,snapshot:SourceSnapshot,input:RecordsInput,positions:number[]) {
  if(page.dataset_id!==input.dataset_id || page.snapshot_id!==snapshot.id || page.total!==snapshot.expected_rows || page.rows.length>input.limit || page.column_indices.length!==positions.length || page.column_indices.some((p,i)=>p!==positions[i]) || page.columns.length!==positions.length || page.columns.some((c,i)=>c.key!==snapshot.columns[positions[i]].key))
    throw new Error("Official record response did not match its pinned snapshot and field projection.");
  let previous=input.after;
  for(const row of page.rows) {
    if(!Number.isSafeInteger(row.row_number) || row.row_number<=previous || row.row_number>snapshot.expected_rows || row.values.length!==positions.length || row.values.some(v=>v!==null && typeof v!=="string"))
      throw new Error("Official record response contains a non-native value, invalid row identity or incomplete projection.");
    if((input.entity!==undefined && row.entity_id!==input.entity && row.entity_name!==input.entity) || (input.geography!==undefined && row.geo_code!==input.geography && row.geo_name!==input.geography) || (input.period!==undefined && row.period!==input.period))
      throw new Error("Official record response did not satisfy the exact entity, geography or period filter.");
    previous=row.row_number;
  }
  // Under the scan cap of the 0069 records function a page can stop before the snapshot's end with no match yet:
  // then rows may be empty and nextCursor (the last row examined) continues the search (rev-sql M1).
  if(page.scanComplete===false) {
    if(!page.hasMore || page.nextCursor===null || page.nextCursor<previous || page.nextCursor>snapshot.expected_rows) throw new Error("Official record response has an inconsistent continuation cursor.");
  } else if(page.hasMore && (!page.rows.length || page.nextCursor!==previous)) throw new Error("Official record response has an inconsistent continuation cursor.");
}

const INDEX_KEYS=["entity_id","entity_name","period","geo_level","geo_code","geo_name"] as const;
/**
 * One answer of records. What is the same on every row is said once (rev-app S2): the source address rule, the
 * record address template, the index rule, scope only on the first page, full field descriptors only on the first
 * page (key, position and unit after that). A row carries its number, its values and the index values it has.
 */
function recordsResult(detail:SourceDatasetDetail,snapshot:SourceSnapshot,page:SourceRecordPage,input:RecordsInput,positions:number[]):OfficialResearchResult {
  verifyPage(page,snapshot,input,positions);
  const datasetUrl=detail.dataset.source_url;
  const rows=page.rows.map(row=>{
    const out:JsonObject={row_number:row.row_number,values:row.values};
    for(const key of INDEX_KEYS) if(row[key]!==null) out[key]=row[key];
    if(row.source_url!==null && row.source_url!==datasetUrl) out.source_url=row.source_url;
    return out;
  });
  const filtered=input.entity!==undefined || input.geography!==undefined || input.period!==undefined;
  const first=input.after===0;
  const scanStopped=page.scanComplete===false;
  const fields=positions.map(p=>{
    if(first) return descriptor(snapshot.columns[p],p);
    const c=snapshot.columns[p],brief:JsonObject={key:c.key,position:p};
    if(c.unit!==undefined) brief.unit=c.unit;
    if(c.scale!==undefined) brief.scale=c.scale;
    return brief;
  });
  const {output,included}=wholePage(rows,returned=>{
    const more=returned.length<rows.length || page.hasMore;
    const lastRow=returned.at(-1)?.row_number;
    const cursor=returned.length<rows.length || !scanStopped?(typeof lastRow==="number"?lastRow:input.after):page.nextCursor!;
    return {kind:"official_source",tool:"query_official_records",...identity(detail,snapshot),
      ...(first?{scope:sourceScope(detail,false)}:{}),
      native_value_rule:"Original string/null cells; no numeric conversion. Blank strings, literal zero and suppression markers are distinct.",
      row_rules:{
        values:"values[i] is the cell of fields[i].",
        index:"entity_id, entity_name, period, geo_level, geo_code and geo_name are the row's stored search index values; a key a row does not carry is null for that row.",
        source_url:datasetUrl!==null?"A row's source_url is given only where its record has its own address; every other row comes from the dataset's source_url.":"A row's source_url is given only where its record has its own address; the dataset states none.",
        record_app_url:officialRecordHrefTemplate(detail.dataset.id,snapshot.id),
      },
      fields,...(first?{}:{fields_note:"Full field descriptors were sent with the first page (after 0)."}),
      filters:{entity:input.entity??null,geography:input.geography??null,period:input.period??null},after:input.after,
      rows:returned,rows_returned:returned.length,remaining_in_fetched_page:rows.length-returned.length,
      remaining_matching_rows:filtered?(more?null:0):Math.max(0,snapshot.expected_rows-cursor),
      remaining_count_basis:filtered?"Unknown until the exact filtered query is exhausted; total_snapshot_rows is unfiltered.":"Unfiltered immutable snapshot row count after the last returned cursor.",
      ...(page.scanned!==undefined?{rows_examined:page.scanned}:{}),
      ...(scanStopped?{scan_complete:false}:{}),
      has_more:more,next_cursor:more?cursor:null,requires_narrower_fields:returned.length<rows.length,
      hint:returned.length<rows.length?"Request fewer chosen fields and keep the same snapshot/filters and next_cursor. A row was omitted whole; no native cell was clipped."
        :scanStopped?`The search stopped at its scan limit at row ${page.nextCursor} of ${snapshot.expected_rows} before the end of the snapshot${returned.length?"":" without a match yet"}. Call again with after set to next_cursor to keep searching; this is not the end of the results.`:null,
    };
  });
  return {output,summary:`Read ${included.length} native records · ${detail.dataset.name}`};
}

/** Lower-case words of a catalogue query, each once, in order. */
export function searchWords(query:string|undefined):string[] {
  return [...new Set((query??"").toLocaleLowerCase().split(/\s+/).filter(Boolean))];
}
type SearchHits={datasets:SourceDatasetList["datasets"];total:number|null;next:string|null};
const readyEntry=(d:SourceDatasetList["datasets"][number])=>d.latest_snapshot?.status==="ready" && d.latest_snapshot.quality.quarantined!==true && d.latest_snapshot.loaded_rows===d.latest_snapshot.expected_rows;
async function phraseSearch(reader:OfficialSourceReader,input:z.infer<typeof officialSearchInput>):Promise<SearchHits> {
  const page=await reader.list({q:input.query,sector:input.sector,agency:input.agency,after:input.after,limit:input.limit});
  if(page.datasets.length>input.limit) throw new Error("Official catalogue response exceeded its requested page bound.");
  return {datasets:page.datasets.filter(readyEntry),total:page.total,next:page.nextCursor??null};
}
/** Catalogue pages read per multi-word search, and their size: at most 200 dataset rows. */
export const EVERY_WORD_PAGES=2,EVERY_WORD_PAGE_SIZE=100;
/**
 * Every word must occur (rev-app S9): the database matches one literal phrase, so it is asked for the longest word
 * and the other words are checked here against the same text it searches (name, description, publisher), in its
 * order (by dataset id) and with its cursor. `total` is unknown then: the database counts the one word only.
 */
async function everyWordSearch(reader:OfficialSourceReader,input:z.infer<typeof officialSearchInput>,words:string[]):Promise<SearchHits> {
  const probe=words.reduce((a,b)=>b.length>a.length?b:a);
  const found:SourceDatasetList["datasets"]=[];
  let after=input.after;
  for(let read=0;read<EVERY_WORD_PAGES;read++) {
    const page=await reader.list({q:probe,sector:input.sector,agency:input.agency,after,limit:EVERY_WORD_PAGE_SIZE});
    if(page.datasets.length>EVERY_WORD_PAGE_SIZE) throw new Error("Official catalogue response exceeded its requested page bound.");
    for(const d of page.datasets) {
      const text=`${d.name} ${d.description} ${d.agency}`.toLocaleLowerCase();
      if(!readyEntry(d) || !words.every(w=>text.includes(w))) continue;
      found.push(d);
      if(found.length===input.limit) return {datasets:found,total:null,next:d.id};
    }
    if(!page.nextCursor) return {datasets:found,total:null,next:null};
    after=page.nextCursor;
  }
  return {datasets:found,total:null,next:after??null};
}

export async function executeOfficialResearch(name:OfficialSourceToolName,args:Record<string,unknown>,reader:OfficialSourceReader):Promise<OfficialResearchResult> {
  if(name==="search_official_sources") {
    const input=officialSearchInput.parse(args);
    const words=searchWords(input.query);
    const hits=words.length>1?await everyWordSearch(reader,input,words):await phraseSearch(reader,input);
    const candidates=hits.datasets.map(d=>({dataset_id:d.id,name:d.name,sector:d.sector,agency:d.agency,grain:d.grain,snapshot_id:d.latest_snapshot!.id,source_rows:d.latest_snapshot!.expected_rows,retrieved_at:d.latest_snapshot!.retrieved_at,source_url:d.source_url,app_url:officialSourceHref(d.id,d.latest_snapshot!.id)}));
    const {output,included}=wholePage(candidates,returned=>{
      const cut=returned.length<candidates.length;
      return {kind:"official_source",tool:name,query:input.query??null,match_rule:words.length>1?"Every word occurs in the name, description or publisher.":"The text occurs in the name, description or publisher.",
        sector:input.sector??null,agency:input.agency??null,after:input.after??null,total_catalogue_matches:hits.total,datasets:returned,
        remaining_in_fetched_page:candidates.length-returned.length,has_more:cut || hits.next!==null,
        next_cursor:cut?(returned.at(-1)?.dataset_id??input.after??null):hits.next,
        remaining_catalogue_matches:cut || hits.next!==null?null:0,requires_narrower_fields:cut,
        hint:candidates.length?"Inspect exact scope and field keys before reading records. Catalogue counts include overlapping views; no ticker/entity relationship is inferred."
          :hits.next!==null?"No match in the part of the catalogue read so far. Call again with after set to next_cursor to keep searching."
          :"Nothing matches. Try one distinctive word (a publisher such as FDIC or EIA, or a series code such as CCSA), or filter by agency.",
      };
    });
    return {output,summary:`Found ${included.length} published official sources`};
  }
  if(name==="inspect_official_source") {
    const input=officialInspectInput.parse(args);
    return inspectResult(await reader.inspect(input.dataset_id,input.snapshot_id),input);
  }
  const input=officialRecordsInput.parse(args);
  const detail=await reader.inspect(input.dataset_id,input.snapshot_id);
  const snapshot=ready(detail,input.dataset_id,input.snapshot_id);
  const positions=resolveOfficialFields(snapshot.columns,input.fields);
  const page=await reader.query({datasetId:input.dataset_id,snapshotId:snapshot.id,columns:positions,entity:input.entity,geography:input.geography,period:input.period,after:input.after,limit:input.limit});
  return recordsResult(detail,snapshot,page,input,positions);
}

/** Old official-source context loses all value rows as units, never fragments of numeric strings. */
export function compactOfficialSourceOutput(output:string):string|null {
  let value:Record<string,unknown>;
  try {value=JSON.parse(output) as Record<string,unknown>;} catch {return null;}
  if(!value || value.kind!=="official_source" || !["search_official_sources","inspect_official_source","query_official_records"].includes(String(value.tool))) return null;
  const compact:Record<string,unknown>={kind:"official_source",tool:value.tool,requires_reread:true};
  for(const key of ["dataset_id","snapshot_id","next_cursor","next_field_after","after","field_after"]) if(value[key]!==undefined) compact[key]=value[key];
  if(Array.isArray(value.rows)) compact.row_ids=value.rows.map(r=>{const row=r as Record<string,unknown>;return row.record_id??`${String(value.snapshot_id)}:${String(row.row_number)}`;});
  else if(Array.isArray(value.row_ids)) compact.row_ids=[...value.row_ids];
  if(Array.isArray(value.fields)) compact.field_keys=value.fields.map(f=>(f as Record<string,unknown>).key);
  else if(Array.isArray(value.field_keys)) compact.field_keys=[...value.field_keys];
  if(Array.isArray(value.datasets)) compact.datasets=value.datasets.map(d=>({dataset_id:(d as Record<string,unknown>).dataset_id,snapshot_id:(d as Record<string,unknown>).snapshot_id}));
  compact.notice="Complete native value rows and field text were removed from older context. Re-read the pinned source before quoting a value.";
  let text=JSON.stringify(compact);
  for(const key of ["datasets","field_keys","row_ids"]) {
    const references=compact[key];
    if(!Array.isArray(references)) continue;
    while(text.length>3900 && references.length) {
      references.pop();compact.references_omitted=Number(compact.references_omitted??0)+1;text=JSON.stringify(compact);
    }
  }
  return text;
}

/** Budget of the digest a person reads in the assistant's step list. */
export const OFFICIAL_DIGEST_MAX_CHARS = 4000;
const short=(id:unknown)=>typeof id==="string"?id.slice(0,12):"";
const text=(value:unknown)=>value===null?"null":value===""?'""':String(value);
/**
 * What the reader of the assistant's steps sees for an official-source answer (rev-app S11), instead of the note
 * written for the model: whole lines only ("row 48517: ASSET 4091315000 (USD thousands)"), never a cut value, then
 * the pinned link. The model's own history keeps `compactOfficialSourceOutput`.
 */
export function digestOfficialSourceOutput(output:string,budget=OFFICIAL_DIGEST_MAX_CHARS):string|null {
  let value:Record<string,unknown>;
  try {value=JSON.parse(output) as Record<string,unknown>;} catch {return null;}
  if(!value || value.kind!=="official_source") return null;
  const lines:string[]=[];
  const items:string[]=[];
  let tail="";
  if(value.tool==="search_official_sources") {
    const datasets=Array.isArray(value.datasets)?value.datasets as Record<string,unknown>[]:[];
    lines.push(datasets.length?`${datasets.length} official ${datasets.length===1?"table":"tables"} found${value.query?` for "${String(value.query)}"`:""}`:`No official table found${value.query?` for "${String(value.query)}"`:""}`);
    for(const d of datasets) items.push(`${String(d.name)} · ${String(d.agency)} · ${Number(d.source_rows).toLocaleString("en-US")} rows · ${String(d.app_url)}`);
  } else if(value.tool==="inspect_official_source") {
    const fields=Array.isArray(value.fields)?value.fields as Record<string,unknown>[]:[];
    lines.push(`${String(value.name)}, snapshot ${short(value.snapshot_id)}: ${fields.length} of ${String(value.total_matching_fields)} matching fields`);
    for(const f of fields) items.push(`${String(f.key)} ${String(f.label)}${f.title&&f.title!==f.label?`, ${String(f.title)}`:""}${f.unit?` (${String(f.unit)})`:""}`);
    tail=typeof value.app_url==="string"?value.app_url:"";
  } else if(value.tool==="query_official_records") {
    const fields=Array.isArray(value.fields)?value.fields as Record<string,unknown>[]:[];
    const rows=Array.isArray(value.rows)?value.rows as Record<string,unknown>[]:[];
    lines.push(`${String(value.name)}, snapshot ${short(value.snapshot_id)}${value.is_latest_snapshot===false?" (a newer snapshot is published)":""}: ${rows.length} ${rows.length===1?"record":"records"}`);
    for(const r of rows) {
      const values=Array.isArray(r.values)?r.values:[];
      items.push(`row ${String(r.row_number)}: ${fields.map((f,i)=>`${String(f.label??f.key)} ${text(values[i])}${f.unit?` (${String(f.unit)})`:""}`).join(", ")}`);
    }
    tail=typeof value.app_url==="string"?value.app_url:"";
  } else return null;
  let digest=lines.join("\n");
  let omitted=0;
  for(const [i,item] of items.entries()) {
    const rest=items.length-i-1;
    const closing=`${rest?`\n${rest} more in the answer`:""}${tail?`\n${tail}`:""}`;
    if(digest.length+1+item.length+closing.length>budget) {omitted=items.length-i;break;}
    digest+=`\n${item}`;
  }
  if(omitted) digest+=`\n${omitted} more in the answer`;
  if(tail) digest+=`\n${tail}`;
  return digest.length<=budget?digest:null;
}
