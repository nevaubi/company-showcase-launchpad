import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowUpRight, FileText } from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/site/site-chrome";
import { Button } from "@/components/ui/button";
import { fmtCompactUsd, fmtValueLong } from "@/lib/format";
import { getPublicCompany } from "@/lib/public-company.functions";
import { PUBLIC_TICKERS } from "@/lib/public-company";

const SITE = "https://filedunder.ai";

export const Route = createFileRoute("/companies/$ticker")({
  loader: async ({ params }) => {
    const snap = await getPublicCompany({ data: { ticker: params.ticker } });
    if (!snap) throw notFound();
    return snap;
  },
  head: ({ params, loaderData }) => {
    const t = params.ticker.toUpperCase();
    const name = loaderData?.name ?? t;
    const title = `${name} (${t}) financials, sourced to the SEC — Filed Under`;
    const desc = `${name}'s revenue, earnings and cash flow for the last five years, with every number linked to the SEC filing it came from.`;
    const url = `${SITE}/companies/${t}`;
    return {
      meta: [
        { title: loaderData ? title : "Company — Filed Under" },
        { name: "description", content: desc },
        { property: "og:title", content: `${name} (${t}) — every number linked to its SEC filing` },
        { property: "og:description", content: desc },
        { property: "og:type", content: "article" },
        { property: "og:url", content: url },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: `${name} (${t}) — sourced to the SEC` },
        { name: "twitter:description", content: desc },
      ],
      links: [{ rel: "canonical", href: url }],
    };
  },
  notFoundComponent: () => (
    <div className="paper-grain min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-24 text-center">
        <h1 className="font-display text-4xl">This company isn't public yet</h1>
        <p className="mt-3 text-muted-foreground">Join the waitlist to research all covered companies.</p>
        <Button asChild className="mt-6"><Link to="/auth" search={{ mode: "signup" }}>Join the waitlist</Link></Button>
      </main>
    </div>
  ),
  component: PublicCompany,
});

function PublicCompany() {
  const s = Route.useLoaderData();
  return (
    <div className="paper-grain min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 pb-24 pt-12">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="eyebrow">Sample company</span>
          {PUBLIC_TICKERS.map((t) => (
            <Link key={t} to="/companies/$ticker" params={{ ticker: t }} className="rounded border px-2 py-0.5 hover:text-foreground" activeProps={{ className: "bg-card text-foreground" }}>{t}</Link>
          ))}
        </div>
        <h1 className="mt-4 font-display text-5xl leading-tight">{s.name}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {s.exchange}: {s.ticker} · {s.sector} · {s.industry}{s.city ? ` · ${s.city}` : ""}
        </p>
        {s.description && <p className="mt-5 max-w-3xl text-sm leading-relaxed text-muted-foreground line-clamp-4">{s.description}</p>}

        <section className="mt-10 min-w-0 rounded-xl border bg-card">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-5 py-4">
            <h2 className="text-base font-semibold">Annual results</h2>
            <p className="text-xs text-muted-foreground">Click any number to open the SEC filing it came from.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="px-5 py-2 text-left font-medium">Line</th>
                  {s.periods.map((p) => <th key={p} className="px-3 py-2 text-right font-medium">{p}</th>)}
                </tr>
              </thead>
              <tbody>
                {s.lines.map((l) => (
                  <tr key={l.key} className="border-b last:border-0">
                    <td className="px-5 py-2.5">{l.label}</td>
                    {s.periods.map((p) => {
                      const v = l.values.find((x) => x.period === p);
                      if (!v) return <td key={p} className="px-3 py-2.5 text-right text-muted-foreground">—</td>;
                      const text = l.unit === "usd" ? fmtCompactUsd(v.value) : fmtValueLong(v.value, l.unit);
                      return (
                        <td key={p} className="num px-3 py-2.5 text-right">
                          {v.source ? (
                            <a href={v.source.url} target="_blank" rel="noreferrer" title={`${v.source.form}${v.source.filed ? ` filed ${v.source.filed}` : ""} · ${v.source.concept}`} className="underline decoration-dotted underline-offset-4 hover:bg-highlight hover:text-highlight-foreground">
                              {text}
                            </a>
                          ) : (
                            <span title={v.derived ?? undefined}>{text}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1.3fr_1fr]">
          <section className="min-w-0 rounded-xl border bg-card">
            <h2 className="border-b px-5 py-4 text-base font-semibold">Recent filings</h2>
            <ul className="divide-y">
              {s.filings.map((f) => (
                <li key={f.url}>
                  <a href={f.url} target="_blank" rel="noreferrer" className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-muted/50">
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <span className="w-16 font-medium">{f.form}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{f.desc && f.desc !== f.form ? f.desc : ({ "10-K": "Annual report", "10-Q": "Quarterly report", "8-K": "Current report", "DEF 14A": "Proxy statement" } as Record<string, string>)[f.form] ?? "SEC filing"}</span>
                    <span className="num text-xs text-muted-foreground">{f.filed}</span>
                    <ArrowUpRight className="size-3.5 text-muted-foreground" />
                  </a>
                </li>
              ))}
            </ul>
          </section>
          <section className="rounded-xl border bg-card p-6">
            <p className="eyebrow">Members see much more</p>
            <h2 className="mt-3 font-display text-3xl leading-tight">The full {s.ticker} file, with an AI analyst on it.</h2>
            <ul className="mt-4 space-y-1.5 text-sm text-muted-foreground">
              <li>Quarterly statements, segments and IR data</li>
              <li>Valuation, earnings and insider activity</li>
              <li>A research assistant that cites the filing sentence</li>
            </ul>
            <Button asChild size="lg" className="mt-6 w-full"><Link to="/auth" search={{ mode: "signup" }}>Join the waitlist</Link></Button>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
