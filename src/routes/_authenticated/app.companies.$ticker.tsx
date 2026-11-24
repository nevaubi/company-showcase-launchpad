import { createFileRoute, Link, notFound, Outlet } from "@tanstack/react-router";
import { DataUnavailable } from "@/components/app/data-unavailable";
import { CompanyHeader } from "@/components/company/header/company-header";
import { cleanCompanyName } from "@/components/company/header/model";
import { CompanyTabs } from "@/components/company/header/tabs";
import { RestrictedBanner } from "@/components/firm/coverage-chip";
import { useCoverage, useFirm } from "@/components/firm/firm-context";
import { Button } from "@/components/ui/button";
import { useCompanyInterest } from "@/lib/agents/client";
import { coverageOf } from "@/lib/coverage";
import { useCompany, useQuotes } from "@/lib/data";

export const Route = createFileRoute("/_authenticated/app/companies/$ticker")({
  beforeLoad: ({ params }) => {
    if (!coverageOf(params.ticker)) throw notFound();
  },
  head: ({ params }) => {
    const c = coverageOf(params.ticker);
    const name = c ? cleanCompanyName(c.shortName) : "Company";
    const t = `${params.ticker.toUpperCase()} · ${name} · FiledUnder`;
    return {
      meta: [
        { title: t },
        {
          name: "description",
          content: `${name} financials, filings, segments and insider trades with source attribution.`,
        },
        { property: "og:title", content: t },
        { property: "og:description", content: `${name} research file on FiledUnder.` },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
      ],
    };
  },
  component: CompanyLayout,
  notFoundComponent: () => (
    <div className="py-24 text-center">
      <p className="eyebrow">Not covered</p>
      <h1 className="mt-2 font-display text-4xl">We don't cover that ticker yet.</h1>
      <Button asChild className="mt-6">
        <Link to="/app/companies">See covered companies</Link>
      </Button>
    </div>
  ),
});

/**
 * The company shell: header (identity, price, actions), the firm's restricted-list warning, then the
 * tabs and the page under them. The pieces live in components/company/header; this file only gathers
 * what they read. The coverage list answers at once, the dataset and the quote fill in after.
 */
function CompanyLayout() {
  const { ticker: raw } = Route.useParams();
  const ticker = raw.toUpperCase();
  useCompanyInterest(ticker);
  const coverage = coverageOf(ticker);
  const company = useCompany(ticker);
  const quotes = useQuotes([ticker]);
  const quote = quotes.data?.quotes[0];
  const profile = company.data?.profile;
  const name = cleanCompanyName(coverage?.shortName ?? profile?.name ?? ticker);
  const { firm } = useFirm();
  const firmCoverage = useCoverage(firm?.id);
  const restricted = !!firm && !!firmCoverage.data?.find((r) => r.ticker === ticker)?.restricted;

  return (
    <div>
      <CompanyHeader
        ticker={ticker}
        name={name}
        coverage={coverage}
        profile={profile}
        filings={company.data?.filings}
        profilePending={company.isPending}
        quote={quote}
        quotePending={!quote && quotes.isPending}
        quoteExchange={quote && "exchange" in quote ? quote.exchange : undefined}
      />
      <RestrictedBanner ticker={ticker} />
      <CompanyTabs ticker={ticker} name={name} logoSrc={profile?.logo} quote={quote} restricted={restricted}>
        {company.isError ? (
          <DataUnavailable
            title="Company data is temporarily unavailable"
            error={company.error}
            onRetry={() => company.refetch()}
          />
        ) : (
          <Outlet />
        )}
      </CompanyTabs>
    </div>
  );
}
