import { createFileRoute, Link } from "@tanstack/react-router";
import { BrandMark } from "@/components/brand/logo";
import { ViewRenderer } from "@/components/research/viz/view";
import { parseViewSpec } from "@/lib/research/view-spec";
import { getSharedView } from "@/lib/share.functions";

export const Route = createFileRoute("/share/$id")({
  loader: ({ params }) => getSharedView({ data: { id: params.id } }).catch(() => null),
  head: ({ loaderData }) => {
    const t = loaderData?.title ? `${loaderData.title} · Filed Under` : "Shared chart · Filed Under";
    return {
      meta: [
        { title: t },
        { name: "description", content: loaderData?.subtitle ?? "A chart shared from Filed Under, with its source." },
        { name: "robots", content: "noindex" },
        { property: "og:title", content: t },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
      ],
    };
  },
  component: SharedPage,
});

function SharedPage() {
  const s = Route.useLoaderData();
  if (!s) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-md text-center">
          <BrandMark className="mx-auto h-9 w-auto text-foreground" />
          <h1 className="mt-6 font-display text-3xl">This shared link is not available.</h1>
          <p className="mt-2 text-sm text-muted-foreground">The owner may have revoked it.</p>
        </div>
      </div>
    );
  }
  const parsed = s.kind === "view" ? parseViewSpec(s.view) : null;
  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center gap-3 border-b px-4 py-3 lg:px-8">
        <Link to="/" aria-label="Filed Under">
          <BrandMark className="h-6 w-auto text-foreground" />
        </Link>
        <span className="text-xs text-muted-foreground">Shared {s.created.slice(0, 10)}</span>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8 lg:px-8">
        {s.kind === "svg" && s.svg ? (
          <figure className="grid gap-2">
            {/* the snapshot carries its own title block, units and source line */}
            <img
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(s.svg)}`}
              alt={s.title}
              width={s.width}
              height={s.height}
              className="h-auto w-full max-w-full rounded border bg-card"
            />
            {s.source && <figcaption className="text-xs text-muted-foreground">Source: {s.source}</figcaption>}
          </figure>
        ) : parsed?.ok ? (
          <div className="grid gap-3">
            <ViewRenderer spec={parsed.spec} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">This shared view could not be displayed.</p>
        )}
        <p className="mt-8 text-[11px] text-muted-foreground">
          A read-only snapshot from Filed Under. Figures are as of the share date; follow the source line for the underlying filings and datasets.
        </p>
      </main>
    </div>
  );
}
