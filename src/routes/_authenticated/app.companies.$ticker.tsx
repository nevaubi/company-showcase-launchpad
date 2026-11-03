import { createFileRoute, Link, notFound, Outlet, useRouterState } from "@tanstack/react-router";
import { ArrowUpRight, Building, Globe, Star } from "lucide-react";
import { CompanyLogo } from "@/components/app/company-logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useCompany, useQuotes } from "@/lib/data";
import { coverageOf } from "@/lib/coverage";
import { fmtPct, fmtPrice, fmtSigned } from "@/lib/format";
import { useToggleFollow } from "@/lib/workspace";
import { useSource } from "@/components/source/source-context";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/companies/$ticker")({
  beforeLoad: ({ params }) => {
    if (!coverageOf(params.ticker)) throw notFound();
  },
  head: ({ params }) => {
    const c = coverageOf(params.ticker);
    const t = `${params.ticker.toUpperCase()} · ${c?.shortName ?? "Company"} — Filed Under`;
    return {
      meta: [
        { title: t },
        { name: "description", content: `${c?.shortName} financials, filings, segments and insider trades with source attribution.` },
        { property: "og:title", content: t },
        { property: "og:description", content: `${c?.shortName} research file on Filed Under.` },
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

const TABS = [
  { to: "/app/companies/$ticker", label: "Overview", exact: true },
  { to: "/app/companies/$ticker/financials", label: "Financials" },
  { to: "/app/companies/$ticker/valuation", label: "Valuation" },
  { to: "/app/companies/$ticker/segments", label: "Segments & KPIs" },
  { to: "/app/companies/$ticker/filings", label: "Filings & IR" },
  { to: "/app/companies/$ticker/insiders", label: "Insiders" },
] as const;

function CompanyLayout() {
  const { ticker: raw } = Route.useParams();
  const ticker = raw.toUpperCase();
  const company = useCompany(ticker);
  const quote = useQuotes([ticker]);
  const q = quote.data?.quotes[0];
  const follow = useToggleFollow();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { open } = useSource();
  const p = company.data?.profile;
  const latest10K = company.data?.filings.find((f) => f.form === "10-K");
  const latest10Q = company.data?.filings.find((f) => f.form === "10-Q");

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start gap-4">
        <CompanyLogo ticker={ticker} src={p?.logo} size="xl" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-[2.4rem] leading-none">{p?.name ?? coverageOf(ticker)?.shortName}</h1>
            <Badge variant="mono">
              {p?.exchange ?? "—"}: {ticker}
            </Badge>
          </div>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span>{p?.sector}</span>
            <span aria-hidden>·</span>
            <span>{p?.industry}</span>
            {p && (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1">
                  <Building className="size-3.5" />
                  {p.address.city.charAt(0) + p.address.city.slice(1).toLowerCase()}, {p.address.state}
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {q ? (
            <div className="text-right">
              <p className="num text-3xl font-medium tracking-tight">{fmtPrice(q.price)}</p>
              <p className={cn("num text-sm", q.change >= 0 ? "text-positive" : "text-negative")}>
                {fmtSigned(q.change)} ({fmtPct(q.changePct, 2, true)})
              </p>
            </div>
          ) : (
            <Skeleton className="h-12 w-32" />
          )}
          <div className="flex flex-wrap justify-end gap-1.5">
            <Button size="sm" variant={follow.isFollowed(ticker) ? "secondary" : "outline"} onClick={() => follow.toggle(ticker)} disabled={follow.pending}>
              <Star className={cn(follow.isFollowed(ticker) && "fill-current")} />
              {follow.isFollowed(ticker) ? "Following" : "Follow"}
            </Button>
            {latest10K && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  open({ ticker, label: `Annual report (${latest10K.report?.slice(0, 4)})`, unit: "usd", value: 0, doc: { accn: latest10K.accn, doc: latest10K.doc, title: "Latest Form 10-K" } })
                }
              >
                Latest 10-K
              </Button>
            )}
            {latest10Q && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => open({ ticker, label: `Quarterly report (${latest10Q.report})`, unit: "usd", value: 0, doc: { accn: latest10Q.accn, doc: latest10Q.doc, title: "Latest Form 10-Q" } })}
              >
                Latest 10-Q
              </Button>
            )}
            {p && (
              <>
                <Button size="sm" variant="ghost" asChild>
                  <a href={p.investorRelations} target="_blank" rel="noreferrer">
                    <Globe /> IR <ArrowUpRight className="opacity-60" />
                  </a>
                </Button>
                <Button size="sm" variant="ghost" asChild>
                  <a href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${p.cik}&type=&dateb=&owner=include&count=40`} target="_blank" rel="noreferrer">
                    EDGAR <ArrowUpRight className="opacity-60" />
                  </a>
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      <nav className="mb-6 flex gap-1 overflow-x-auto border-b scrollbar-thin">
        {TABS.map((t) => {
          const href = t.to.replace("$ticker", ticker);
          const active = "exact" in t && t.exact ? pathname === href || pathname === href + "/" : pathname.startsWith(href);
          return (
            <Link
              key={t.to}
              to={t.to}
              params={{ ticker }}
              className={cn(
                "-mb-px whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground",
                active && "border-foreground font-medium text-foreground",
              )}
            >
              {t.label}
            </Link>
          );
        })}
        <Link
          to="/app/markets"
          search={{ symbol: ticker }}
          className="-mb-px whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          Technicals ↗
        </Link>
      </nav>

      {company.isError ? (
        <p className="text-sm text-negative">Couldn't load this company's dataset: {(company.error as Error).message}</p>
      ) : (
        <Outlet />
      )}
    </div>
  );
}
