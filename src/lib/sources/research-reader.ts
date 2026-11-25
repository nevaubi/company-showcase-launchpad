import type { QueryClient } from "@tanstack/react-query";
import { getSourceDataset, listSources, querySourceRecords } from "./functions";
import { fetchSourceDataset, sourceQueries } from "./queries";
import { executeOfficialResearch, type OfficialSourceReader } from "./research";
import type { OfficialSourceToolName } from "./research-tools";

/** Without a cache: every read crosses requireAppAccess and user-scoped RLS. */
const direct:OfficialSourceReader={
  list:filters=>listSources({data:filters}),
  inspect:(id,snapshotId)=>getSourceDataset({data:{id,snapshotId}}),
  query:input=>querySourceRecords({data:input}),
};

/**
 * The tools' reads through the app's query cache (rev-app S3): the same keys as the screens, so a pinned snapshot's
 * dictionary (1.6 MB for the FDIC institution table) is downloaded once per session, not once per tool call.
 */
export function officialSourceReader(qc?:QueryClient):OfficialSourceReader {
  if(!qc) return direct;
  return {
    list:filters=>qc.fetchQuery(sourceQueries.list(filters)),
    inspect:(id,snapshotId)=>fetchSourceDataset(qc,id,snapshotId),
    query:input=>qc.fetchQuery(sourceQueries.records(input)),
  };
}
export const runOfficialSourceTool=(name:OfficialSourceToolName,args:Record<string,unknown>,qc?:QueryClient)=>executeOfficialResearch(name,args,officialSourceReader(qc));
