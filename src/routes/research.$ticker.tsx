import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { Lock, ShieldCheck } from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/site/site-chrome";
import { PublicSourcePanel } from "@/components/reports/public-source-panel";
import { ReportDocument, type ReportBrand } from "@/components/reports/report-document";
import { SourceProvider } from "@/components/source/source-context";
import { Button } from "@/components/ui/button";
import { getPublicReport } from "@/lib/public-report.functions";
import { publicDescription } from "@/lib/reports/public";
import { fmtDate } from "@/lib/format";

const SITE = "https://filedunder.ai";

/** Public pages carry the house look and a public footer line in place of the internal-research defaults. */
const PUBLIC_BRAND: ReportBrand = {
  branding: {
    footer: "Public preview · filedunder.ai",
    disclaimer:
      "This preview was prepared from public SEC filings and market data. It is not investment advice. Figures cite their source filings; estimates and market data are labeled.",
    signature: false,
  },
  logo: null,
  firmName: null,
  preparedBy: null,
};

export const Route = createFileRoute("/research/$ticker")({
  loader: async ({ params }) => {
    const page = await getPublicReport({ data: { ticker: params.ticker } });
    if (!page) throw notFound();
    return page;
  },
  head: ({ params, loaderData }) => {
    const t = params.ticker.toUpperCase();
    if (!loaderData)
      return {
        meta: [{ title: "Research — Filed Under" }, { name: "robots", content: "noindex" }],
      };
    const c = loaderData.content;
    const title = `${c.title} — ${c.name} (${t}) primer · Filed Under`;
    const desc = publicDescription(c, loaderData.totals.sources);
    const url = `${SITE}/research/${t}`;
    return {
      meta: [
        { title },
        { name: "description", content: desc },
        { property: "og:title", content: c.title },
        { property: "og:description", content: desc },
        { property: "og:type", content: "article" },
        { property: "og:url", content: url },
        { property: "article:modified_time", content: loaderData.updatedAt },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: c.title },
        { name: "twitter:description", content: desc },
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Article",
            headline: c.title,
            description: desc,
            url,
            dateModified: loaderData.updatedAt,
            isAccessibleForFree: true,
            author: { "@type": "Organization", name: "Filed Under", url: SITE },
            publisher: { "@type": "Organization", name: "Filed Under", url: SITE },
            about: { "@type": "Corporation", name: c.name, tickerSymbol: t },
            isBasedOn: "https://www.sec.gov/edgar",
          }),
        },
      ],
    };
  },
  notFoundComponent: () => (
    <div className="paper-grain min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-24 text-center">
        <h1 className="font-display text-4xl">This primer isn't published yet</h1>
        <p className="mt-3 text-muted-foreground">
          Primers are added as they are written and checked against the filings.
        </p>
        <p className="mt-3">
          <Link to="/research" className="underline">
            See the primers you can read now
          </Link>
        </p>
        <Button asChild className="mt-6">
          <Link to="/auth" search={{ mode: "signup" }}>
            Join the waitlist
          </Link>
        </Button>
      </main>
      <SiteFooter />
    </div>
  ),
  component: PublicPrimer,
});

function PublicPrimer() {
  const page = Route.useLoaderData();
  const c = page.content;
  const shown = c.sections.length;
  const verified = c.qa.numbers
    ? `${c.qa.verifiedNumbers} of ${c.qa.numbers} figures matched to their sources`
    : "Every statement cites its sources";

  return (
    <div className="paper-grain min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-4 pb-24 pt-10 sm:px-6">
        <nav
          aria-label="Breadcrumb"
          className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
        >
          <Link to="/research" className="eyebrow hover:text-foreground">
            All primers
          </Link>
          <span aria-hidden>/</span>
          <span className="num">{c.ticker}</span>
          {page.sector && <span>· {page.sector}</span>}
        </nav>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-lg border bg-card px-4 py-3 text-[13px]">
          <p className="inline-flex items-center gap-1.5 font-medium text-positive">
            <ShieldCheck className="size-4" aria-hidden /> {verified}
          </p>
          <p className="text-muted-foreground">
            {page.totals.sources} sources across the full primer · updated{" "}
            {fmtDate(page.updatedAt, { month: "short", day: "numeric", year: "numeric" })}
          </p>
        </div>

        <SourceProvider>
          <ReportDocument
            content={c}
            brand={PUBLIC_BRAND}
            className="mt-4 overflow-hidden rounded-lg border"
          />
          <PublicSourcePanel ciks={page.ciks} />
        </SourceProvider>

        {page.locked.length > 0 && (
          <section aria-labelledby="locked-title" className="mt-6 rounded-lg border bg-card">
            <div className="border-b px-5 py-4 sm:px-7">
              <p className="eyebrow">
                You've read {shown} of {page.totals.sections} sections
              </p>
              <h2 id="locked-title" className="mt-2 font-display text-2xl leading-tight">
                The rest of the {c.name} primer
              </h2>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {page.totals.charts} charts, {page.totals.tables} tables and {page.totals.sources}{" "}
                cited sources in the full version, each figure opening the filing line it came from.
              </p>
            </div>
            <ul className="grid grid-cols-1 sm:grid-cols-2">
              {page.locked.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center gap-2.5 border-b px-5 py-3 text-sm text-muted-foreground sm:px-7 sm:odd:border-r"
                >
                  <Lock className="size-3.5 shrink-0" aria-hidden />
                  <span className="text-foreground">{s.title}</span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-7">
              <p className="text-sm text-muted-foreground">
                Members also get earnings previews, recaps and IC memos for every covered company.
              </p>
              <Button asChild size="lg">
                <Link to="/auth" search={{ mode: "signup" }}>
                  Join the waitlist
                </Link>
              </Button>
            </div>
          </section>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
