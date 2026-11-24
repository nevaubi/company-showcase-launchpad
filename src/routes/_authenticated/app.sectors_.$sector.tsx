import { createFileRoute, notFound } from "@tanstack/react-router";
import { GroupView } from "@/components/sectors/group-view";
import { COVERAGE } from "@/lib/coverage";
import { groupSearch, slugify, type GroupSearch } from "@/lib/sectors/group";

const SECTOR_NAMES = [...new Set(COVERAGE.map((c) => c.sector))];

export const Route = createFileRoute("/_authenticated/app/sectors_/$sector")({
  validateSearch: (s) => groupSearch.parse(s),
  beforeLoad: ({ params }) => {
    if (!SECTOR_NAMES.includes(params.sector)) throw notFound();
  },
  head: ({ params }) => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { title: `${params.sector} · Sectors · FiledUnder` },
      {
        name: "description",
        content: `${params.sector}: every covered company's returns, breadth, growth, margins and valuation, its industries compared, and the aggregates behind each figure.`,
      },
      { property: "og:title", content: `${params.sector} · FiledUnder` },
      { property: "og:description", content: `Inside the ${params.sector} sector: industries, leaders and laggards, fundamentals and valuation.` },
    ],
  }),
  component: SectorPage,
});

function SectorPage() {
  const { sector } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const set = (patch: Partial<GroupSearch>) => navigate({ search: (p) => ({ ...p, ...patch }), replace: true, resetScroll: false });
  return <GroupView key={sector} slug={slugify(sector)} search={search} setSearch={set} />;
}
