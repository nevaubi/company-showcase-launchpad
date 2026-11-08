import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { PageHeader } from "@/components/app/page-header";
import LoadingState from "@/components/ui/loading-state";
import { SituationsView } from "@/components/situations/situations";
import { situationsIndexQuery } from "@/lib/situations/data";

const search = z.object({ screen: z.string().max(40).optional() });

export const Route = createFileRoute("/_authenticated/app/situations")({
  validateSearch: (s) => search.parse(s),
  head: () => ({
    meta: [
      { title: "Situations — Filed Under" },
      {
        name: "description",
        content:
          "Insider conviction, federal contract shifts, distress and financing events, concentration changes, mean-reversion setups and quality deterioration, each with its sources.",
      },
      { property: "og:title", content: "Situations — Filed Under" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Situations,
});

function Situations() {
  const { screen = "insider_conviction" } = Route.useSearch();
  const navigate = Route.useNavigate();
  const q = useQuery(situationsIndexQuery);
  return (
    <div className="grid gap-4">
      <PageHeader
        eyebrow="Research"
        title="Situations"
        description="Screens built from independent, sourced facts: Form 4 trades, filing text, 8-K items, federal awards, supply-chain disclosures, valuation history and technical base rates. Every row opens its evidence."
      />
      {q.isLoading ? (
        <LoadingState label="Loading situation screens" variant="Drive" className="px-1 py-6" />
      ) : q.data ? (
        <SituationsView
          idx={q.data}
          mode={screen}
          onMode={(m) => navigate({ search: { screen: m === "insider_conviction" ? undefined : m }, replace: true })}
        />
      ) : (
        <p className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
          The situation screens are not available right now. They are rebuilt daily after the market close.
        </p>
      )}
    </div>
  );
}
