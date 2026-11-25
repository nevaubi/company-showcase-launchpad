import { useCallback, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { useCompany } from "@/lib/data";
import { guardEntry } from "@/lib/sources/company/guard";
import { getCompanyOfficial } from "@/lib/sources/company/official.functions";
import { statementTotalAssets } from "@/lib/sources/company/present";
import { HoldingCompanyReport } from "./holding-company-report";
import { InsuredBanks } from "./insured-banks";

/** The query of a company's official records; the certificate picks whose history comes with it. */
export const companyOfficialQuery = (ticker: string, cert: string | null) => ({
  queryKey: ["company-official", ticker.toUpperCase(), cert ?? ""] as const,
  queryFn: () => getCompanyOfficial({ data: { ticker, ...(cert ? { cert } : {}) } }),
  staleTime: 10 * 60_000,
});

/**
 * The company's official bank records: its insured banks (FDIC) and its holding company's FR Y-9C. Shown only for a
 * company the mapping proves (src/lib/sources/company/guard.ts); for any other company it renders nothing and asks
 * for nothing. While a read is in flight the previous frame stays, dimmed.
 */
export function OfficialBanking({ ticker }: { ticker: string }) {
  const entry = guardEntry(ticker);
  const [cert, setCert] = useState<string | null>(null);
  const q = useQuery({ ...companyOfficialQuery(ticker, cert), enabled: !!entry, placeholderData: keepPreviousData });
  const company = useCompany(ticker);
  const statementAssets = useCallback((date: string) => statementTotalAssets(company.data as never, date), [company.data]);
  if (!entry) return null;
  if (q.isPending) {
    // the bank table's height is known before the read: one 28 px row per proven institution
    return (
      <div data-section="Insured banks" className="min-w-0 xl:col-span-2" aria-busy="true">
        <Skeleton className="rounded-md" style={{ height: 96 + entry.certs.length * 28 + 260 }} />
      </div>
    );
  }
  const result = q.data;
  if (!result || !result.ok) {
    return (
      <p data-section="Insured banks" className="min-w-0 rounded-md border bg-card px-3.5 py-2 text-[13px] text-muted-foreground shadow-paper xl:col-span-2">
        Official bank records are not available right now{result && !result.ok ? `: ${result.reason}` : "."}
      </p>
    );
  }
  const data = result.data;
  return (
    <>
      {data.banks.length > 0 && <InsuredBanks ticker={ticker} data={data} selected={cert} onSelect={setCert} pending={q.isPlaceholderData} />}
      {data.y9c ? (
        <HoldingCompanyReport ticker={ticker} report={data.y9c} statementAssets={statementAssets} />
      ) : data.y9cNote ? (
        <p data-section="Holding company regulatory report" className="min-w-0 rounded-md border bg-card px-3.5 py-2 text-[13px] text-muted-foreground shadow-paper xl:col-span-2">
          Holding company regulatory report: {data.y9cNote}
        </p>
      ) : null}
    </>
  );
}
