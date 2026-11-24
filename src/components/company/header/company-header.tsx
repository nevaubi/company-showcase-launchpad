import { useQuery } from "@tanstack/react-query";
import { CompanyLogo } from "@/components/app/company-logo";
import { SinceVisitBadges } from "@/components/changes/company-changes";
import { analyticsFile } from "@/lib/analytics-files";
import type { CoverageCompany } from "@/lib/coverage";
import type { CompanyProfile, Filing } from "@/lib/financials/types";
import type { HqFile } from "@/lib/supply/geo";
import { CompanyActions } from "./actions";
import { CompanyContext, CompanyName } from "./identity";
import { exchangeLabel, headOffice, type QuoteLike } from "./model";
import { PriceBlock, QuoteFacts } from "./price-block";

/** Same key and loader as the supply-chain globe, so the head-office file is fetched once a session. */
const hqQuery = {
  queryKey: ["analytics", "hq"],
  queryFn: () => analyticsFile<HqFile>("hq.json"),
  staleTime: 24 * 60 * 60_000,
};

/**
 * The company page header: who the company is, what it trades at, and what can be done with it.
 *
 * One grid. On a wide page: mark, name and actions on the first line, the context line under the name
 * running the full width, then the price with its facts and what is new since the last visit. On a
 * narrow page the actions drop under the price. Name, sector and industry come from the coverage list,
 * so they are on screen before the dataset and the quote arrive. What arrives later either fills a place
 * that is held for it (price, price facts, the IR link) or is added at the end of its line (head office,
 * since-visit badges), so nothing already on screen moves.
 */
export function CompanyHeader({
  ticker,
  name,
  coverage,
  profile,
  filings,
  profilePending,
  quote,
  quotePending,
  quoteExchange,
}: {
  ticker: string;
  name: string;
  coverage: CoverageCompany | undefined;
  profile: CompanyProfile | undefined;
  filings: Filing[] | undefined;
  /** the company dataset has not answered yet (false once it has loaded or failed) */
  profilePending: boolean;
  quote: QuoteLike | undefined;
  quotePending: boolean;
  quoteExchange?: string;
}) {
  const hq = useQuery(hqQuery);
  return (
    <div data-section="Company header" className="@container/hdr mb-3">
      {/* @min-[56rem]/hdr: past this width the actions sit beside the name; below it they follow the price */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 @min-[56rem]/hdr:grid-cols-[auto_minmax(0,1fr)_auto]">
        <CompanyLogo ticker={ticker} src={profile?.logo} size="lg" decorative className="col-start-1 row-span-2 row-start-1 self-start" />
        <CompanyName
          className="col-start-2 row-start-1 self-center"
          ticker={ticker}
          name={name}
          legalName={profile?.name}
          exchange={exchangeLabel(profile?.exchange, quoteExchange)}
        />
        <CompanyActions
          className="col-span-full row-start-4 mt-3 @min-[56rem]/hdr:col-span-1 @min-[56rem]/hdr:col-start-3 @min-[56rem]/hdr:row-start-1 @min-[56rem]/hdr:mt-0 @min-[56rem]/hdr:justify-end @min-[56rem]/hdr:self-center @min-[56rem]/hdr:pl-6"
          ticker={ticker}
          cik={profile?.cik ?? coverage?.cik ?? ""}
          profile={profile}
          filings={filings}
          pending={profilePending}
          irHint={coverage?.ir}
          price={quote?.price ?? null}
        />
        <CompanyContext
          className="col-start-2 row-start-2 @min-[56rem]/hdr:col-span-2"
          name={name}
          legalName={profile?.name}
          sector={coverage?.sector ?? profile?.sector}
          industry={coverage?.industry ?? profile?.industry}
          office={headOffice(ticker, hq.data, profile?.address)}
        />
        <div className="col-span-full row-start-3 mt-3 flex min-w-0 flex-wrap items-end gap-x-8 gap-y-2">
          {/* past 40rem the price block has one width for any price under $1,000, so the facts start at the same
              place on every company and do not move when the quote lands; below it the facts take their own row */}
          <PriceBlock ticker={ticker} quote={quote} pending={quotePending} className="@min-[40rem]/hdr:min-w-[15rem]" />
          <QuoteFacts
            className="basis-full @min-[40rem]/hdr:basis-auto"
            ticker={ticker}
            quote={quote}
            profile={profile}
            quotePending={quotePending}
            profilePending={profilePending}
          />
          <div className="ml-auto flex min-h-8 items-center empty:hidden">
            <SinceVisitBadges ticker={ticker} />
          </div>
        </div>
      </div>
    </div>
  );
}
