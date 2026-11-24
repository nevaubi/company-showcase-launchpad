import { useQuery } from "@tanstack/react-query";
import type { CompanyProfile } from "@/lib/financials/types";
import { getCompanyDetails } from "./details.functions";
import { needsDetails, type CompanyDetails } from "./details";

/**
 * The coverage details of a company whose served profile lacks a website, IR address, founding year or description;
 * not asked for when the profile has all four. A failed read leaves the profile's own fields (the page shows less,
 * never something wrong).
 */
export function useCompanyDetails(ticker: string, profile: Pick<CompanyProfile, "website" | "investorRelations" | "description" | "founded"> | undefined) {
  return useQuery({
    queryKey: ["company-details", ticker],
    queryFn: (): Promise<CompanyDetails> => getCompanyDetails({ data: { ticker } }),
    enabled: !!profile && needsDetails(profile),
    staleTime: 24 * 60 * 60_000,
    retry: 1,
  });
}
