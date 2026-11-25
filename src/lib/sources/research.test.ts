import { describe,expect,it,vi } from "vitest";
import { executeOfficialResearch,OFFICIAL_RESEARCH_MAX_CHARS,officialSourceHref,resolveOfficialFields,type OfficialSourceReader } from "./research";
import { OFFICIAL_SOURCE_TOOL_DEFS } from "./research-tools";
import type { SourceColumn,SourceDatasetDetail,SourceDatasetList,SourceRecord,SourceRecordPage,SourceRecordQuery } from "./schema";

const SNAP="a".repeat(64);
const columns:SourceColumn[]=[
  {key:"col0001",label:"CERT",type:"string",unit:"FDIC certificate identifier"},
  {key:"col0002",label:"VALUE",type:"string",unit:"USD thousands",scale:"1000",basis:"As reported; no conversion"},
  {key:"col0003",label:"VALUE",type:"string",unit:"percent",description:"Duplicate source label; a different native field"},
  {key:"col0004",label:"BLANK",type:"string"},
  {key:"col0005",label:"ZERO",type:"string"},
  {key:"col0006",label:"SUPPRESSED",type:"string"},
];
function detail(width=columns.length):SourceDatasetDetail {
  return {
    dataset:{id:"financials/fdic",name:"Native institution records",sector:"Financials",agency:"FDIC",source_id:"FDIC",source_url:"https://api.fdic.gov/banks/financials",description:"Fixed cohort of insured institutions.",grain:"FDIC certificate / reporting quarter",units:"Column-specific source units",notes:"A fixed cohort; not the complete historical bank population.",latest_snapshot_id:SNAP},
    snapshot:{id:SNAP,dataset_id:"financials/fdic",file_sha256:"b".repeat(64),source_path:"native.csv",status:"ready",expected_rows:3,loaded_rows:3,columns:columns.slice(0,width),ingest:{format:"csv",encoding:"utf-8",delimiter:",",header_rows:1,dimensions:{entity_id:0}},retrieved_at:null,published_at:"2026-11-25T00:00:00Z",created_at:"2026-11-25T00:00:00Z",coverage:{identity_rule:"CERT is the insured institution, not a ticker or regulatory parent.",population_role:"source_native_table"},quality:{}},file:null,
  };
}
const row=(row_number:number,values:(string|null)[]):SourceRecord=>({row_number,values,entity_id:"000123",entity_name:"Native Bank",period:"2026Q2",geo_level:"county",geo_code:"01001",geo_name:"Autauga",source_url:"https://official.example/source.csv"});
function fixtures(d=detail(),sourceRows=[row(1,["000123","9007199254740993.000000000000000001","0.000000000000000001","","0",null])],more=false) {
  const query=vi.fn(async(input:SourceRecordQuery):Promise<SourceRecordPage>=>({dataset_id:d.dataset.id,snapshot_id:d.snapshot!.id,total:d.snapshot!.expected_rows,columns:input.columns!.map(i=>d.snapshot!.columns[i]),column_indices:input.columns!,rows:sourceRows.map(r=>({...r,values:input.columns!.map(i=>r.values[i])})),hasMore:more,nextCursor:more?sourceRows.at(-1)!.row_number:null}));
  const reader:OfficialSourceReader={inspect:vi.fn(async()=>d),query,list:vi.fn(async()=>({datasets:[],total:0,sectors:[],agencies:[]}))};
  return {reader,query};
}
const request=(extra:Record<string,unknown>={})=>({dataset_id:"financials/fdic",snapshot_id:SNAP,fields:["col0001","col0002","col0003","col0004","col0005","col0006"],entity:null,geography:null,period:null,after:0,limit:20,...extra});
const parsed=(r:{output:string})=>JSON.parse(r.output);

describe("official source research reads",()=>{
  it("preserves native zeros, blanks, leading zeros, nulls and large decimals without scaling",async()=>{
    const {reader,query}=fixtures();
    const result=await executeOfficialResearch("query_official_records",request({entity:"000123",geography:"01001",period:"2026Q2"}),reader);
    const p=parsed(result);
    expect(p.rows[0].values).toEqual(["000123","9007199254740993.000000000000000001","0.000000000000000001","","0",null]);
    expect(p.fields[1]).toMatchObject({key:"col0002",unit:"USD thousands",scale:"1000"});
    expect(p.rows[0]).toMatchObject({record_id:`${SNAP}:1`,source_url:"https://official.example/source.csv",source_url_basis:"record"});
    expect(p.scope.notes).toBe("A fixed cohort; not the complete historical bank population.");
    expect(query).toHaveBeenCalledWith(expect.objectContaining({snapshotId:SNAP,entity:"000123",geography:"01001",period:"2026Q2",columns:[0,1,2,3,4,5],limit:20}));
    const url=new URL(p.rows[0].app_url,"https://filedunder.example");
    expect(url.searchParams.get("source")).toBe("financials/fdic");
    expect(url.searchParams.get("snapshot")).toBe(SNAP);
    expect(url.searchParams.get("after")).toBe("0");
    expect(url.searchParams.get("geography")).toBe("01001");
    expect(result.output.length).toBeLessThanOrEqual(OFFICIAL_RESEARCH_MAX_CHARS);
  });
  it("rejects duplicate-label ambiguity and duplicate selectors instead of guessing a field",()=>{
    expect(()=>resolveOfficialFields(columns,["VALUE"])).toThrow(/Ambiguous.*col0002.*col0003/);
    expect(resolveOfficialFields(columns,["col0003","CERT"])).toEqual([2,0]);
    expect(()=>resolveOfficialFields(columns,["CERT","col0001"])).toThrow(/distinct/);
    expect(()=>resolveOfficialFields(columns,["asset"])).toThrow(/Unknown exact field/);
  });
  it("omits an oversized row whole and continues after the last complete row",async()=>{
    const huge="9007199254740993."+"123456789".repeat(2000);
    const {reader}=fixtures(detail(2),[row(1,["000123","0"]),row(2,["000123",huge]),row(3,["000123","2"])]);
    const result=await executeOfficialResearch("query_official_records",request({fields:["col0001","col0002"]}),reader);
    const p=parsed(result);
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0].values).toEqual(["000123","0"]);
    expect(p.next_cursor).toBe(1);
    expect(p.remaining_in_fetched_page).toBe(2);
    expect(p.remaining_matching_rows).toBe(2);
    expect(p.has_more).toBe(true);
    expect(p.requires_narrower_fields).toBe(true);
    expect(p.hint).toMatch(/fewer chosen fields/);
    expect(result.output).not.toContain("9007199254740993.");
    expect(result.output.length).toBeLessThanOrEqual(OFFICIAL_RESEARCH_MAX_CHARS);
  });
  it("keeps the cursor unchanged when even the first complete row exceeds the budget",async()=>{
    const {reader}=fixtures(detail(2),[row(1,["000123","7".repeat(18000)])]);
    const p=parsed(await executeOfficialResearch("query_official_records",request({fields:["col0002"]}),reader));
    expect(p.rows).toEqual([]);
    expect(p.next_cursor).toBe(0);
    expect(p.remaining_in_fetched_page).toBe(1);
    expect(p.requires_narrower_fields).toBe(true);
  });
  it("reports filtered remaining counts as unknown instead of treating total snapshot rows as matches",async()=>{
    const {reader}=fixtures(detail(2),[row(1,["000123","0"])],true);
    const p=parsed(await executeOfficialResearch("query_official_records",request({fields:["col0001"],entity:"000123"}),reader));
    expect(p.remaining_matching_rows).toBeNull();
    expect(p.total_snapshot_rows).toBe(3);
    expect(p.next_cursor).toBe(1);
    expect(p.remaining_count_basis).toMatch(/unfiltered/);
  });
  it.each(["staging","failed","quarantined","incomplete","wrong snapshot"])("refuses %s snapshots before querying any records",async(kind)=>{
    const d=detail();
    if(kind==="staging"||kind==="failed") d.snapshot!.status=kind;
    else if(kind==="quarantined") d.snapshot!.quality.quarantined=true;
    else if(kind==="incomplete") d.snapshot!.loaded_rows=1;
    else d.snapshot!.id="c".repeat(64);
    const {reader,query}=fixtures(d);
    await expect(executeOfficialResearch("query_official_records",request(),reader)).rejects.toThrow(/published snapshot/);
    expect(query).not.toHaveBeenCalled();
  });
  it("requires an explicit snapshot and enforces row, field and native-string filter bounds",async()=>{
    const {reader}=fixtures();
    for(const extra of [{snapshot_id:null},{limit:21},{fields:Array(13).fill("col0001")},{entity:123},{ticker:"JPM"}])
      await expect(executeOfficialResearch("query_official_records",request(extra),reader)).rejects.toThrow();
    expect(reader.inspect).not.toHaveBeenCalled();
  });
  it("rejects a record response from a different snapshot or with a coerced numeric cell",async()=>{
    const {reader}=fixtures();
    const base:SourceRecordPage={dataset_id:"financials/fdic",snapshot_id:SNAP,total:3,columns:[columns[0]],column_indices:[0],rows:[row(1,["000123"])],hasMore:false,nextCursor:null};
    reader.query=async()=>({...base,snapshot_id:"c".repeat(64)});
    await expect(executeOfficialResearch("query_official_records",request({fields:["col0001"]}),reader)).rejects.toThrow(/pinned snapshot/);
    reader.query=async()=>({...base,rows:[row(1,[123 as unknown as string])]});
    await expect(executeOfficialResearch("query_official_records",request({fields:["col0001"]}),reader)).rejects.toThrow(/non-native/);
  });
});

describe("official source catalogue and inspection",()=>{
  it("searches bounded catalogue pages with a continuation at the last whole dataset",async()=>{
    const d=detail(),{reader}=fixtures(d);
    const datasets=Array.from({length:20},(_,i)=>({...d.dataset,id:`source_${String(i).padStart(3,"0")}`,name:"Native source "+"scope ".repeat(20),latest_snapshot:d.snapshot!}));
    const list=vi.fn(async():Promise<SourceDatasetList>=>({datasets,total:40,sectors:["Financials"],agencies:["FDIC"],nextCursor:datasets.at(-1)!.id}));
    reader.list=list;
    const result=await executeOfficialResearch("search_official_sources",{query:"native",sector:"Financials",agency:"FDIC",after:null,limit:20},reader);
    const p=parsed(result);
    expect(list).toHaveBeenCalledWith({q:"native",sector:"Financials",agency:"FDIC",after:undefined,limit:20});
    expect(p.datasets.length).toBeGreaterThan(0);
    expect(p.datasets.length).toBeLessThan(20);
    expect(p.next_cursor).toBe(p.datasets.at(-1).dataset_id);
    expect(p.remaining_in_fetched_page).toBe(20-p.datasets.length);
    expect(result.output.length).toBeLessThanOrEqual(OFFICIAL_RESEARCH_MAX_CHARS);
  });
  it("does not expose an unready catalogue entry",async()=>{
    const d=detail(),{reader}=fixtures(d);
    reader.list=async()=>({datasets:[{...d.dataset,latest_snapshot:{...d.snapshot!,status:"staging"}}],total:1,sectors:[],agencies:[],nextCursor:null});
    const p=parsed(await executeOfficialResearch("search_official_sources",{},reader));
    expect(p.datasets).toEqual([]);
    expect(p.has_more).toBe(false);
  });
  it("inspects exact scope and unit metadata with stable field search and paging",async()=>{
    const {reader}=fixtures();
    const first=parsed(await executeOfficialResearch("inspect_official_source",{dataset_id:"financials/fdic",snapshot_id:null,field_search:"VALUE",limit:1,include_definitions:true},reader));
    expect(first.snapshot_id).toBe(SNAP);
    expect(first.fields).toHaveLength(1);
    expect(first.fields[0]).toMatchObject({key:"col0002",position:1,label:"VALUE",unit:"USD thousands",scale:"1000"});
    expect(first.total_matching_fields).toBe(2);
    expect(first.remaining_fields).toBe(1);
    expect(first.next_field_after).toBe(1);
    expect(first.scope).toMatchObject({grain:"FDIC certificate / reporting quarter",notes:"A fixed cohort; not the complete historical bank population."});
    const second=parsed(await executeOfficialResearch("inspect_official_source",{dataset_id:"financials/fdic",snapshot_id:SNAP,field_search:"VALUE",field_after:1,limit:1,include_definitions:true},reader));
    expect(second.fields[0]).toMatchObject({key:"col0003",unit:"percent",description:"Duplicate source label; a different native field"});
    expect(second.next_field_after).toBeNull();
  });
  it("never clips a complete long field definition",async()=>{
    const d=detail();d.snapshot!.columns[0]={...columns[0],description:"9".repeat(18000)};
    const {reader}=fixtures(d);
    const p=parsed(await executeOfficialResearch("inspect_official_source",{dataset_id:d.dataset.id,field_search:"CERT",include_definitions:true},reader));
    expect(p.fields).toEqual([]);expect(p.next_field_after).toBe(-1);expect(p.requires_narrower_fields).toBe(true);
  });
  it("exposes a declared period index constant and rule without converting native cells",async()=>{
    const d=detail();
    d.snapshot!.ingest.constants={period:"2026-10",source_url:"https://official.example/month"};
    d.snapshot!.coverage={period_index_is_native_text:false,native_period:"11510",period_index_rule:"Gregorian search year is native ROC year plus 1911; native cells remain unchanged."};
    const {reader}=fixtures(d);
    const p=parsed(await executeOfficialResearch("inspect_official_source",{dataset_id:d.dataset.id},reader));
    expect(p.scope.search_constants).toEqual({period:"2026-10"});
    expect(p.scope.declared_coverage).toMatchObject({native_period:"11510",period_index_is_native_text:false,period_index_rule:d.snapshot!.coverage.period_index_rule});
  });
  it("pins row links without losing exact identifier strings",()=>{
    const url=new URL(officialSourceHref("collection/file",SNAP,37,{entity:"00123",geography:"01001",period:"FY 2026"}),"https://example.test");
    expect(Object.fromEntries(url.searchParams)).toEqual({view:"sources",source:"collection/file",snapshot:SNAP,after:"37",entity:"00123",geography:"01001",period:"FY 2026"});
  });
  it("advertises explicit bounds and only the three intended read tools",()=>{
    expect(OFFICIAL_SOURCE_TOOL_DEFS.map(t=>t.name)).toEqual(["search_official_sources","inspect_official_source","query_official_records"]);
    const records=OFFICIAL_SOURCE_TOOL_DEFS[2];
    expect(records.parameters.properties.fields).toMatchObject({minItems:1,maxItems:12});
    expect(records.parameters.properties.limit).toMatchObject({maximum:20});
    expect(records.parameters.required).toContain("snapshot_id");
    expect(OFFICIAL_SOURCE_TOOL_DEFS.every(t=>t.strict && t.parameters.additionalProperties===false)).toBe(true);
  });
});
