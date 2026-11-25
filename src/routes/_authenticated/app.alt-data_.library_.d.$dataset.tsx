import { createFileRoute } from "@tanstack/react-router";
import { DatasetPage } from "@/components/alt/library/dataset-page";
import { datasetSearch, type DatasetSearch } from "@/components/alt/library/dataset-search";

export const Route = createFileRoute("/_authenticated/app/alt-data_/library_/d/$dataset")({
  validateSearch: (s) => datasetSearch.parse(s),
  head: () => ({
    meta: [
      { title: "Official table · Data library · FiledUnder" },
      {
        name: "description",
        content:
          "One official table as its publisher released it: what one record is, a first look at the data, every record and field, and every published version with its file hash.",
      },
      { property: "og:title", content: "Official table · FiledUnder" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TablePage,
});

function TablePage() {
  const { dataset } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const set = (patch: Partial<DatasetSearch>) =>
    navigate({ search: (previous) => ({ ...previous, ...patch }), replace: true, resetScroll: false });
  return <DatasetPage key={dataset} datasetId={dataset} search={search} setSearch={set} />;
}
