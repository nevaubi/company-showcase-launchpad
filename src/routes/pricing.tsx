import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Loader2 } from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/site/site-chrome";
import { Button } from "@/components/ui/button";
import { useDemoSignIn } from "@/hooks/use-demo-sign-in";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — Filed Under" },
      {
        name: "description",
        content: "Plans for individual investors, professional analysts and research teams. Start free with source-linked financials.",
      },
      { property: "og:title", content: "Pricing — Filed Under" },
      { property: "og:description", content: "Start free. Upgrade for the research agent, unlimited source panels, theses and exports." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Pricing,
});

const PLANS = [
  {
    name: "Reader",
    price: "$0",
    cadence: "forever",
    blurb: "For checking the numbers behind the headlines.",
    cta: "Create free account",
    features: [
      "Covered companies' statements, annual & quarterly",
      "Click-to-source on every value",
      "SEC filing viewer and insider trades",
      "Macro dashboard",
      "20 research-agent questions / month",
    ],
  },
  {
    name: "Analyst",
    price: "$29",
    cadence: "per month",
    blurb: "For investors who build their own models.",
    cta: "Start 14-day trial",
    featured: true,
    features: [
      "Everything in Reader",
      "Technicals with intraday data and earnings reactions",
      "Unlimited research-agent questions with citations",
      "Theses with price tracking and updates",
      "Docs & sheets with the AI pane",
      "CSV export of any table",
    ],
  },
  {
    name: "Desk",
    price: "$149",
    cadence: "per seat / month",
    blurb: "For funds and research teams.",
    cta: "Talk to us",
    features: ["Everything in Analyst", "Shared theses and watchlists", "Bulk exports and API access", "Custom coverage requests", "SSO and audit log"],
  },
];

function Pricing() {
  const demo = useDemoSignIn();
  return (
    <div className="paper-grain min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-6 pb-24 pt-16">
        <div className="max-w-2xl">
          <p className="eyebrow">Pricing</p>
          <h1 className="mt-4 font-display text-6xl leading-[1]">Pay for depth, not for the data.</h1>
          <p className="mt-5 text-muted-foreground">
            The filings are public. What you pay for is the work of turning them into tables you can trust — and the tools to
            reason over them.
          </p>
        </div>
        <div className="mt-14 grid grid-cols-1 gap-5 lg:grid-cols-3">
          {PLANS.map((p) => (
            <section
              key={p.name}
              className={cn(
                "flex flex-col rounded-2xl border bg-card p-8 shadow-paper",
                p.featured && "border-foreground/30 shadow-lift ring-1 ring-foreground/10",
              )}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">{p.name}</h2>
                {p.featured && <span className="rounded bg-highlight px-2 py-0.5 text-[11px] font-medium text-highlight-foreground">Most popular</span>}
              </div>
              <p className="mt-6 flex items-baseline gap-2">
                <span className="num text-5xl font-medium tracking-tight">{p.price}</span>
                <span className="text-sm text-muted-foreground">{p.cadence}</span>
              </p>
              <p className="mt-3 text-sm text-muted-foreground">{p.blurb}</p>
              <ul className="mt-8 flex-1 space-y-3 text-sm">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2.5">
                    <Check className="mt-0.5 size-4 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <Button asChild className="mt-8" variant={p.featured ? "default" : "outline"} size="lg">
                <Link to="/auth" search={{ mode: "signup" }}>
                  {p.cta}
                </Link>
              </Button>
            </section>
          ))}
        </div>
        <div className="mt-12 flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card px-6 py-5">
          <p className="text-sm">
            <span className="font-medium">Not sure yet?</span>{" "}
            <span className="text-muted-foreground">Open the shared demo workspace — no signup.</span>
          </p>
          <Button variant="highlight" onClick={() => demo.signIn()} disabled={demo.pending}>
            {demo.pending && <Loader2 className="animate-spin" />} Open the demo
          </Button>
        </div>
        <section className="mt-24 grid grid-cols-1 gap-10 lg:grid-cols-[0.8fr_1.2fr]">
          <h2 className="font-display text-4xl">Questions</h2>
          <dl className="divide-y border-y">
            {[
              ["Where does the data come from?", "SEC EDGAR (XBRL company facts, inline-XBRL filings, Form 4, 8-K), Yahoo Finance for prices and FRED for macro. Every financial value carries its accession number."],
              ["How are quarterly cash flows calculated?", "10-Qs report cash flow year-to-date. We derive each discrete quarter by subtracting the prior year-to-date figure, and the source panel shows both parts."],
              ["Is this investment advice?", "No. Filed Under is a research tool. Verify anything important in the source document — that's what the panel is for."],
              ["Can I cancel anytime?", "Yes. Plans are month to month."],
            ].map(([q, a]) => (
              <div key={q} className="py-5">
                <dt className="font-medium">{q}</dt>
                <dd className="mt-2 text-sm text-muted-foreground">{a}</dd>
              </div>
            ))}
          </dl>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
