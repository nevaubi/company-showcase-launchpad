import { getSourceDataset, listSources, querySourceRecords } from "./functions";
import { executeOfficialResearch, type OfficialSourceReader } from "./research";
import type { OfficialSourceToolName } from "./research-tools";

/** Shared executor adapter: every read crosses requireAppAccess and user-scoped RLS. */
const reader:OfficialSourceReader={
  list:filters=>listSources({data:filters}),
  inspect:(id,snapshotId)=>getSourceDataset({data:{id,snapshotId}}),
  query:input=>querySourceRecords({data:input}),
};
export const runOfficialSourceTool=(name:OfficialSourceToolName,args:Record<string,unknown>)=>executeOfficialResearch(name,args,reader);
