import { createFileRoute } from "@tanstack/react-router";
import { LIBRARY_DESCRIPTION, LibraryPage } from "@/components/alt/library/library-page";
import { librarySearch } from "@/components/alt/library/search";

export const Route = createFileRoute("/_authenticated/app/alt-data_/library")({
  validateSearch: librarySearch,
  head: () => ({
    meta: [
      { title: "Data library · Alternative data · FiledUnder" },
      { name: "description", content: LIBRARY_DESCRIPTION },
      { property: "og:title", content: "Data library · FiledUnder" },
      { property: "og:description", content: LIBRARY_DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DataLibrary,
});

function DataLibrary() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <LibraryPage
      search={search}
      onSearch={(patch) => void navigate({ search: (previous) => ({ ...previous, ...patch }), replace: true, resetScroll: false })}
    />
  );
}
