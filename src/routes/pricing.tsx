import { createFileRoute, Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/site/site-chrome";
import { Button } from "@/components/ui/button";

const CONTACT = "mailto:admin@filedunder.ai?subject=Filed%20Under%20pricing";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Access & pricing — Filed Under" },
      { name: "description", content: "Filed Under is available by approved trial. Contact us for custom pricing for individuals, teams and institutions." },
      { property: "og:title", content: "Access & pricing — Filed Under" },
      { property: "og:description", content: "Approved trials and custom pricing. Every number links to its SEC source." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Pricing,
});

const OPTIONS = [
  {
    name: "Approved trial",
    blurb: "Request access. Once approved, you get a free trial of the full platform.",
    cta: "Request access",
    href: null as string | null,
    features: [
      "Every covered company: financials, filings, IR data, valuation",
      "Click-to-source on every value",
      "Research assistant and Office Studio",
      "Your saved work stays after the trial",
    ],
  },
  {
    name: "Custom pricing",
    blurb: "For investors, teams and institutions. Tell us what you need and we'll put together a plan.",
    cta: "Contact us",
    href: CONTACT,
    features: [
      "Pricing tailored to your usage and team size",
      "Higher assistant and report limits",
      "Exports, alerts and scheduled briefs",
      "Onboarding help for your team",
    ],
  },
];

function Pricing() {
  return (
    <div className="paper-grain min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-6 pb-24 pt-16">
        <div className="max-w-2xl">
          <p className="eyebrow">Access & pricing</p>
          <h1 className="mt-4 font-display text-6xl leading-[1]">Start with a trial. Talk to us about the rest.</h1>
          <p className="mt-5 text-muted-foreground">
            Access is by approval. Try the full platform, then contact us for pricing that fits how you work.
          </p>
        </div>
        <div className="mt-14 grid grid-cols-1 gap-5 md:grid-cols-2">
          {OPTIONS.map((p) => (
            <section key={p.name} className="flex min-w-0 flex-col rounded-2xl border bg-card p-8 shadow-paper">
              <h2 className="text-lg font-semibold">{p.name}</h2>
              <p className="mt-3 text-sm text-muted-foreground">{p.blurb}</p>
              <ul className="mt-8 flex-1 space-y-3 text-sm">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2.5">
                    <Check className="mt-0.5 size-4 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <Button asChild className="mt-8" variant={p.href ? "default" : "outline"} size="lg">
                {p.href ? <a href={p.href}>{p.cta}</a> : <Link to="/auth" search={{ mode: "signup" }}>{p.cta}</Link>}
              </Button>
            </section>
          ))}
        </div>
        <section className="mt-24 grid grid-cols-1 gap-10 lg:grid-cols-[0.8fr_1.2fr]">
          <h2 className="font-display text-4xl">Questions</h2>
          <dl className="divide-y border-y">
            {[
              ["How do I get access?", "Request access with your email. We review requests and let you know when your trial is ready."],
              ["Where does the data come from?", "SEC EDGAR (XBRL company facts, inline-XBRL filings, Form 4, 8-K), Yahoo Finance for prices and FRED for macro. Every financial value carries its accession number."],
              ["Is this investment advice?", "No. Filed Under is a research tool. Verify anything important in the source document — that's what the panel is for."],
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
