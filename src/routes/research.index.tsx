import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/site/site-chrome";
import { Button } from "@/components/ui/button";
import { listPublicReports, type PublicReportListItem } from "@/lib/public-report.functions";
import { fmtDate } from "@/lib/format";

const URL = "https://filedunder.ai/research";

export const Route = createFileRoute("/research/")({
  loader: () => listPublicReports(),
  head: ({ loaderData }) => {
    const n = loaderData?.length ?? 0;
    const desc = n
      ? `${n} company primers written from SEC filings, with every figure checked against its source. Read the summary and business overview of each for free.`
      : "Company primers written from SEC filings, with every figure checked against its source.";
    return {
      meta: [
        { title: "Company primers, every figure checked against the filing — Filed Under" },
        { name: "description", content: desc },
        {
          property: "og:title",
          content: "Company primers with every figure checked against the filing",
        },
        { property: "og:description", content: desc },
        { property: "og:type", content: "website" },
        { property: "og:url", content: URL },
        { name: "twitter:card", content: "summary_large_image" },
      ],
      links: [{ rel: "canonical", href: URL }],
    };
  },
  component: ResearchIndex,
});

function ResearchIndex() {
  const list = Route.useLoaderData();
  const bySector = new Map<string, PublicReportListItem[]>();
  for (const r of list) bySector.set(r.sector, [...(bySector.get(r.sector) ?? []), r]);
  const sectors = [...bySector.entries()]
    .map(
      ([sector, rows]) => [sector, [...rows].sort((a, b) => a.name.localeCompare(b.name))] as const,
    )
    .sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="paper-grain min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 pb-24 pt-12">
        <p className="eyebrow">Research</p>
        <h1 className="mt-4 font-display text-5xl leading-tight">
          Company primers, checked against the filings.
        </h1>
        <p className="mt-4 max-w-2xl text-muted-foreground">
          Each primer is written from the company's SEC filings and market data. Every figure is
          matched to its source before it is published, and unsupported sentences are removed.
        </p>
        {list.length > 0 && (
          <p className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-positive">
            <ShieldCheck className="size-4" aria-hidden /> {list.length}{" "}
            {list.length === 1 ? "primer" : "primers"} published
          </p>
        )}

        {list.length === 0 ? (
          <div className="mt-10 rounded-xl border bg-card px-6 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              Primers are being written. Check back soon, or join the waitlist to be told when your
              companies are covered.
            </p>
            <Button asChild className="mt-5">
              <Link to="/auth" search={{ mode: "signup" }}>
                Join the waitlist
              </Link>
            </Button>
          </div>
        ) : (
          <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-2">
            {sectors.map(([sector, rows]) => (
              <section key={sector} className="min-w-0 rounded-xl border bg-card">
                <h2 className="flex items-baseline justify-between gap-3 border-b px-5 py-3 text-sm font-semibold">
                  {sector}
                  <span className="num text-xs font-normal text-muted-foreground">
                    {rows.length}
                  </span>
                </h2>
                <ul className="divide-y">
                  {rows.map((r) => (
                    <li key={r.ticker}>
                      <Link
                        to="/research/$ticker"
                        params={{ ticker: r.ticker }}
                        className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-3 px-5 py-3 text-sm hover:bg-muted/50"
                      >
                        <span className="num font-medium">{r.ticker}</span>
                        <span className="min-w-0">
                          <span className="block truncate">{r.title}</span>
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                            {r.name} · updated{" "}
                            {fmtDate(r.updatedAt, {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        <div className="mt-12 flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card px-6 py-5">
          <p className="text-sm text-muted-foreground">
            Members read every section, plus earnings previews, recaps and IC memos, with each
            figure opening the filing line it came from.
          </p>
          <Button asChild>
            <Link to="/auth" search={{ mode: "signup" }}>
              Join the waitlist
            </Link>
          </Button>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
