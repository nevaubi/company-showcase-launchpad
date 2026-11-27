import { useQuery } from "@tanstack/react-query";
import type { CompanyProfile } from "@/lib/financials/types";
import { getCompanyDetails } from "./details.functions";
import type { CompanyDetails } from "./details";

/** The header and About panel share one cached issuer identity read, including profiles with older links. */
export function useCompanyDetails(ticker: string, profile: Pick<CompanyProfile, "cik"> | undefined) {
  return useQuery({
    queryKey: ["company-details", ticker, profile?.cik],
    queryFn: (): Promise<CompanyDetails> => getCompanyDetails({ data: { ticker, cik: profile?.cik || undefined } }),
    enabled: !!profile,
    staleTime: 60 * 60_000,
    retry: 1,
  });
}
