import { queryOptions } from "@tanstack/react-query";
import { partnerFile } from "@/lib/data";

// insights/{T}.json from etl/filing_insights.py: ranked, verified changes in the latest 10-K or 10-Q.
export interface FilingRef {
  accn: string;
  form: string;
  filed: string;
  report: string;
  doc: string;
  url: string;
}
export interface FilingInsight {
  id: string;
  type: string;
  title: string;
  text: string;
  quote: string;
  refs: string[];
  stake: { value: number | null; unit: "USD" | "percent" | null; what?: string } | null;
  direction: "positive" | "negative" | "mixed" | "neutral";
  novelty: "new" | "changed" | "removed";
  impact: number;
  score: number;
  score_parts: Record<string, number>;
  section: string;
  change: string;
  passage: { old: string | null; new: string | null };
  doc: "new" | "old";
  rank: number;
  check?: { model: string; reason: string };
}
export interface FilingInsightsFile {
  ticker: string;
  generated: string;
  run_id: string;
  label: string;
  filing: FilingRef;
  compared_to: FilingRef;
  kind: "annual" | "quarterly";
  insights: FilingInsight[];
  proposed: number;
  rejected: Record<string, number>;
  models: { draft: string; check: string };
  method: string;
}

export const filingInsightsQuery = (t: string) =>
  queryOptions({
    queryKey: ["filing-insights", t],
    queryFn: () => partnerFile<FilingInsightsFile>(`insights/${t}.json`),
    staleTime: 30 * 60_000,
    retry: 0,
  });
