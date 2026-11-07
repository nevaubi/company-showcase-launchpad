import { queryOptions } from "@tanstack/react-query";
import { partnerFile } from "@/lib/data";

// brief/{T}.json from etl/company_brief.py: checked sentences on what changed in the last 30 days, with their facts.
export interface BriefFact {
  id: string;
  text: string;
  link: {
    tab: "overview" | "estimates" | "insiders" | "technicals";
    section?: "overview" | "form4" | "congress" | "holders" | "lobbying" | "government" | "trading";
  };
}
export interface BriefFile {
  ticker: string;
  generated: string;
  run_id: string;
  window_days: number;
  status: string;
  sentences: { text: string; refs: string[] }[];
  dropped: { text: string; reason: string }[];
  facts: BriefFact[];
  facts_considered: number;
  models: { draft: string; check: string | null };
  label: string;
}

export const briefQuery = (t: string) =>
  queryOptions({
    queryKey: ["brief", t],
    queryFn: () => partnerFile<BriefFile>(`brief/${t}.json`),
    staleTime: 30 * 60_000,
    retry: 0,
  });
