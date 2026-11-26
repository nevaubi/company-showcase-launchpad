import { createFileRoute } from "@tanstack/react-router";
import { CHARTS_DESCRIPTION, ChartsPage, chartsSearch } from "@/components/alt/library/boards/gallery";

export const Route = createFileRoute("/_authenticated/app/alt-data_/library_/charts")({
  validateSearch: chartsSearch,
  head: () => ({
    meta: [
      { title: "Charts · Data library · FiledUnder" },
      { name: "description", content: CHARTS_DESCRIPTION },
      { property: "og:title", content: "Charts · Data library · FiledUnder" },
      { property: "og:description", content: CHARTS_DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Charts,
});

function Charts() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <ChartsPage
      search={search}
      onSearch={(patch) => void navigate({ search: (previous) => ({ ...previous, ...patch }), replace: true, resetScroll: false })}
    />
  );
}
