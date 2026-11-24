import { createFileRoute } from "@tanstack/react-router";
import { GroupView } from "@/components/sectors/group-view";
import { groupSearch, type GroupSearch } from "@/lib/sectors/group";

export const Route = createFileRoute("/_authenticated/app/sectors_/g/$slug")({
  validateSearch: (s) => groupSearch.parse(s),
  head: ({ params }) => {
    const name = params.slug
      .replace(/-and-/g, " & ")
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
    return {
      meta: [
        { title: `${name} · Sectors · FiledUnder` },
        {
          name: "description",
          content: `${name}: revenue and earnings growth, margins, returns on capital and valuation aggregated from each company's filings, with the companies behind every figure.`,
        },
        { property: "og:title", content: `${name} · FiledUnder` },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
      ],
    };
  },
  component: Group,
});

function Group() {
  const { slug } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const set = (patch: Partial<GroupSearch>) => navigate({ search: (p) => ({ ...p, ...patch }), replace: true, resetScroll: false });
  return <GroupView key={slug} slug={slug} search={search} setSearch={set} />;
}
