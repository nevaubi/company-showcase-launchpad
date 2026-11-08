import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteFooter, SiteHeader } from "@/components/site/site-chrome";
import { Button } from "@/components/ui/button";
import { PUBLIC_COMPANIES } from "@/lib/public-company";

const URL = "https://filedunder.ai/companies";

export const Route = createFileRoute("/companies/")({
  head: () => ({
    meta: [
      { title: "Company financials sourced to SEC filings — Filed Under" },
      { name: "description", content: "Revenue, earnings and cash flow for 78 large US companies, every number linked to the SEC filing it came from." },
      { property: "og:title", content: "78 US companies, every number linked to its SEC filing" },
      { property: "og:description", content: "Five years of revenue, earnings and cash flow, sourced to SEC filings." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: URL },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: URL }],
  }),
  component: CompaniesIndex,
});

function CompaniesIndex() {
  const bySector = new Map<string, typeof PUBLIC_COMPANIES>();
  for (const c of PUBLIC_COMPANIES) bySector.set(c.sector, [...(bySector.get(c.sector) ?? []), c]);
  const sectors = [...bySector.entries()].sort(([a], [b]) => a.localeCompare(b));
  return (
    <div className="paper-grain min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 pb-24 pt-12">
        <p className="eyebrow">Companies</p>
        <h1 className="mt-4 font-display text-5xl leading-tight">Every number, linked to its filing.</h1>
        <p className="mt-4 max-w-2xl text-muted-foreground">
          Five years of results for {PUBLIC_COMPANIES.length} large US companies. Click any figure to open the SEC filing it came from.
        </p>
        <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {sectors.map(([sector, list]) => (
            <section key={sector} className="min-w-0 rounded-xl border bg-card">
              <h2 className="border-b px-5 py-3 text-sm font-semibold">{sector}</h2>
              <ul className="divide-y">
                {list.map((c) => (
                  <li key={c.ticker}>
                    <Link to="/companies/$ticker" params={{ ticker: c.ticker }} className="flex items-center gap-3 px-5 py-2.5 text-sm hover:bg-muted/50">
                      <span className="num w-14 font-medium">{c.ticker}</span>
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">{c.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className="mt-12 flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card px-6 py-5">
          <p className="text-sm text-muted-foreground">Members get quarterly data, valuation, insiders, IR decks and an AI analyst that cites every claim.</p>
          <Button asChild><Link to="/auth" search={{ mode: "signup" }}>Join the waitlist</Link></Button>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
