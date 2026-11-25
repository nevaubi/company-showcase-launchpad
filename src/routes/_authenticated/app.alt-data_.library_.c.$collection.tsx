import { createFileRoute, redirect } from "@tanstack/react-router";
import { collectionForSegment, collectionPath, collectionSlug } from "@/components/alt/library/addresses";
import { CollectionPage } from "@/components/alt/library/collection-page";
import { collectionSearch } from "@/components/alt/library/search";

export const Route = createFileRoute("/_authenticated/app/alt-data_/library_/c/$collection")({
  validateSearch: collectionSearch,
  // A collection is addressed by its slug; its stored id or another letter case leads to the same page.
  beforeLoad: ({ params, location }) => {
    const collection = collectionForSegment(params.collection);
    if (collection && collectionSlug(collection.id) !== params.collection)
      throw redirect({ href: `${collectionPath(collection.id)}${location.searchStr}`, replace: true });
  },
  head: ({ params }) => {
    const collection = collectionForSegment(params.collection);
    const name = collection?.name ?? "Collection";
    return {
      meta: [
        { title: `${name} · Data library · FiledUnder` },
        { name: "description", content: collection?.blurb || "A collection of official tables in the Data library." },
        { property: "og:title", content: `${name} · FiledUnder` },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
      ],
    };
  },
  component: CollectionRoute,
});

function CollectionRoute() {
  const { collection } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <CollectionPage
      key={collection}
      segment={collection}
      search={search}
      onSearch={(patch) => void navigate({ search: (previous) => ({ ...previous, ...patch }), replace: true, resetScroll: false })}
    />
  );
}
