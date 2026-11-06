import { createFileRoute, Link, notFound, Outlet, useRouterState } from "@tanstack/react-router";
import { ArrowUpRight, Building, ChevronDown, Globe, Sparkles, Star } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { requestResearch } from "@/lib/research/request";
import { CompanyLogo } from "@/components/app/company-logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useCompany, useQuotes } from "@/lib/data";
import { coverageOf } from "@/lib/coverage";
import { fmtPct, fmtPrice, fmtSigned } from "@/lib/format";
import { useToggleFollow } from "@/lib/workspace";
import { useSource } from "@/components/source/source-context";
import { CoverageChip, RestrictedBanner } from "@/components/firm/coverage-chip";
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

const TABS = [
  { to: "/app/companies/$ticker", label: "Overview", exact: true },
  { to: "/app/companies/$ticker/financials", label: "Financials" },
  { to: "/app/companies/$ticker/valuation", label: "Valuation" },
  { to: "/app/companies/$ticker/ir", label: "IR data" },
  { to: "/app/companies/$ticker/earnings", label: "Earnings & promises" },
  { to: "/app/companies/$ticker/estimates", label: "Estimates & analysts" },
  { to: "/app/companies/$ticker/calls", label: "Earnings calls" },
  { to: "/app/companies/$ticker/filings", label: "Filings & IR" },
  { to: "/app/companies/$ticker/redline", label: "Filing changes" },
  { to: "/app/companies/$ticker/insiders", label: "Insiders" },
  { to: "/app/companies/$ticker/alt-data", label: "Alt data" },
  { to: "/app/companies/$ticker/reports", label: "Reports" },
] as const;
const TAB_GROUPS = [
  { label: "Financials", paths: ["financials", "valuation", "ir"] },
  { label: "Intelligence", paths: ["earnings", "estimates", "insiders", "alt-data"] },
  { label: "Documents", paths: ["reports", "calls", "filings", "redline"] },
];

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
      <div className="mb-3 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
        <CompanyLogo ticker={ticker} src={p?.logo} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-semibold leading-tight tracking-tight" title={p?.name ? `SEC registrant: ${p.name}` : undefined}>
              {coverageOf(ticker)?.shortName ?? p?.name}
            </h1>
            <Badge variant="mono">
              {p?.exchange ?? "—"}: {ticker}
            </Badge>
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            {p?.name && p.name.toLowerCase().replace(/[^a-z]/g, "") !== (coverageOf(ticker)?.shortName ?? "").toLowerCase().replace(/[^a-z]/g, "") && (
              <>
                <span className="num text-[11px] uppercase">{p.name}</span>
                <span aria-hidden>·</span>
              </>
            )}
            <span>{p?.sector}</span>
            <span aria-hidden>·</span>
            <span>{p?.industry}</span>
            {p && (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1">
                  <Building className="size-3.5" />
                  {p.address.city.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}, {p.address.state}
                </span>
              </>
            )}
          </p>
        </div>
        <div className="col-span-2 grid min-w-0 grid-cols-1 items-center gap-2 sm:grid-cols-[auto_minmax(0,1fr)]">
          {q ? (
            <div className="flex shrink-0 items-baseline justify-end gap-2 sm:justify-start">
              <p className="num text-2xl font-semibold">{fmtPrice(q.price)}</p>
              <p className={cn("num text-sm", q.change >= 0 ? "text-positive" : "text-negative")}>
                {fmtSigned(q.change)} ({fmtPct(q.changePct, 2, true)})
              </p>
            </div>
          ) : (
            <Skeleton className="h-8 w-32" />
          )}
          <div className="flex min-w-0 flex-wrap justify-end gap-1">
            <Button size="xs" variant="outline" onClick={() => requestResearch(`Build a sourced investment brief for ${ticker}: latest results, valuation, estimates, supply-chain risks and upcoming catalysts. Read the company pages and distinguish reported facts from estimates.`)}><Sparkles /> Research</Button>
            <Button size="xs" variant={follow.isFollowed(ticker) ? "secondary" : "outline"} onClick={() => follow.toggle(ticker)} disabled={follow.pending}>
              <Star className={cn(follow.isFollowed(ticker) && "fill-current")} />
              {follow.isFollowed(ticker) ? "Following" : "Follow"}
            </Button>
            <CoverageChip ticker={ticker} price={q?.price ?? null} />
            {latest10K && (
              <Button
                size="xs"
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
                size="xs"
                variant="outline"
                onClick={() => open({ ticker, label: `Quarterly report (${latest10Q.report})`, unit: "usd", value: 0, doc: { accn: latest10Q.accn, doc: latest10Q.doc, title: "Latest Form 10-Q" } })}
              >
                Latest 10-Q
              </Button>
            )}
            {p && (
              <>
                <Button size="xs" variant="ghost" asChild>
                  <a href={p.investorRelations} target="_blank" rel="noreferrer">
                    <Globe /> IR <ArrowUpRight className="opacity-60" />
                  </a>
                </Button>
                <Button size="xs" variant="ghost" asChild>
                  <a href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${p.cik}&type=&dateb=&owner=include&count=40`} target="_blank" rel="noreferrer">
                    EDGAR <ArrowUpRight className="opacity-60" />
                  </a>
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      <RestrictedBanner ticker={ticker} />

      <nav aria-label="Company research" className="mb-4 flex flex-wrap items-center gap-1 border-b pb-1">
        <Button variant={pathname.replace(/\/$/, "") === `/app/companies/${ticker}` ? "secondary" : "ghost"} size="sm" asChild><Link to="/app/companies/$ticker" params={{ ticker }}>Overview</Link></Button>
        {TAB_GROUPS.map((group) => {
          const tabs = TABS.filter((t) => group.paths.includes(t.to.split("/").at(-1) ?? ""));
          const active = tabs.find((t) => pathname.startsWith(t.to.replace("$ticker", ticker)));
          return <DropdownMenu key={group.label}>
            <DropdownMenuTrigger asChild><Button variant={active ? "secondary" : "ghost"} size="sm">{group.label}<ChevronDown className="size-3" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="start">{tabs.map((t) => <DropdownMenuItem key={t.to} asChild><Link to={t.to} params={{ ticker }} aria-current={t === active ? "page" : undefined}>{t.label}</Link></DropdownMenuItem>)}</DropdownMenuContent>
          </DropdownMenu>;
        })}
        <Button variant="ghost" size="sm" asChild><Link to="/app/markets" search={{ symbol: ticker }}>Technicals <ArrowUpRight className="size-3" /></Link></Button>
        <Button variant="ghost" size="sm" asChild><Link to="/app/supply-chain" search={{ t: ticker }}>Supply chain <ArrowUpRight className="size-3" /></Link></Button>
        {TABS.find((t) => !("exact" in t) && pathname.startsWith(t.to.replace("$ticker", ticker))) && <span className="ml-auto py-1 text-xs text-muted-foreground">{TABS.find((t) => !("exact" in t) && pathname.startsWith(t.to.replace("$ticker", ticker)))?.label}</span>}
      </nav>

      {company.isError ? (
        <div className="flex flex-wrap items-center gap-3 border-l-2 border-negative p-4"><p className="text-sm text-negative">Company data is temporarily unavailable.</p><Button size="sm" variant="outline" onClick={() => company.refetch()}>Retry</Button></div>
      ) : (
        <Outlet />
      )}
    </div>
  );
}
