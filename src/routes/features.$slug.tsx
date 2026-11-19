import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { SiteFooter, SiteHeader } from "@/components/site/site-chrome";
import { Button } from "@/components/ui/button";
import { FEATURES, featureBySlug } from "@/lib/features";

const SITE = "https://filedunder.ai";
import clickShot from "@/assets/features/click-to-source.jpg.asset.json";
import irShot from "@/assets/features/ir-kpis.jpg.asset.json";
import supplyShot from "@/assets/features/supply-chain.jpg.asset.json";
import assistantShot from "@/assets/features/research-assistant.jpg.asset.json";
import officeShot from "@/assets/features/office-studio.jpg.asset.json";

const SHOTS: Record<string, string> = {
  "click-to-source": clickShot.url,
  "ir-kpis": irShot.url,
  "supply-chain": supplyShot.url,
  "research-assistant": assistantShot.url,
  "office-studio": officeShot.url,
};


export const Route = createFileRoute("/features/$slug")({
  loader: async ({ params }) => {
    const f = featureBySlug(params.slug);
    if (!f) throw notFound();
    return f;
  },
  head: ({ params, loaderData }) => {
    const url = `${SITE}/features/${params.slug}`;
    if (!loaderData) return { meta: [{ title: "Feature · FiledUnder" }, { name: "robots", content: "noindex" }] };
    const title = `${loaderData.title} · FiledUnder`;
    return {
      meta: [
        { title },
        { name: "description", content: loaderData.summary },
        { property: "og:title", content: title },
        { property: "og:description", content: loaderData.summary },
        { property: "og:type", content: "article" },
        { property: "og:url", content: url },
        { name: "twitter:card", content: "summary_large_image" },
        ...(SHOTS[params.slug] ? [
          { property: "og:image", content: `${SITE}${SHOTS[params.slug]}` },
          { name: "twitter:image", content: `${SITE}${SHOTS[params.slug]}` },
        ] : []),
      ],
      links: [{ rel: "canonical", href: url }],
    };
  },
  notFoundComponent: () => (
    <div className="paper-grain min-h-screen"><SiteHeader />
      <main className="mx-auto max-w-3xl px-6 py-24 text-center"><h1 className="font-display text-4xl">Feature not found</h1>
        <p className="mt-3"><Link to="/" className="underline">Back to the home page</Link></p></main></div>
  ),
  errorComponent: () => <div role="alert" className="p-10">Something went wrong.</div>,
  component: FeaturePage,
});

function FeaturePage() {
  const f = Route.useLoaderData();
  return (
    <div className="paper-grain min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-6 pb-24 pt-12">
        <p className="eyebrow">{f.name}</p>
        <h1 className="mt-4 font-display text-5xl leading-tight">{f.title}</h1>
        <p className="mt-5 max-w-2xl text-lg text-muted-foreground">{f.summary}</p>
        {SHOTS[f.slug] && (
          <img src={SHOTS[f.slug]} alt={`${f.name} in Filed Under, shown on NVIDIA`} width={1200} height={630}
            className="mt-10 w-full rounded-xl border shadow-sm" loading="eager" />
        )}
        <ul className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {f.points.map((p) => <li key={p} className="min-w-0 rounded-xl border bg-card p-5 text-sm">{p}</li>)}
        </ul>
        <div className="mt-10 flex flex-wrap gap-3">
          <Button asChild size="lg"><Link to="/auth" search={{ mode: "signup" }}>Join the waitlist</Link></Button>
          {f.example && <Button asChild size="lg" variant="outline"><Link to="/companies/$ticker" params={{ ticker: f.example.ticker }}>{f.example.label}</Link></Button>}
        </div>
        <nav className="mt-16 border-t pt-6" aria-label="Other features">
          <p className="eyebrow">More features</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {FEATURES.filter((x) => x.slug !== f.slug).map((x) => (
              <Link key={x.slug} to="/features/$slug" params={{ slug: x.slug }} className="rounded border px-3 py-1.5 text-sm hover:bg-muted/50">{x.name}</Link>
            ))}
          </div>
        </nav>
      </main>
      <SiteFooter />
    </div>
  );
}
