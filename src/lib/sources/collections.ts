/**
 * The 15 collections (`source_datasets.sector`) for screens: the catalogue's names, order and
 * one-line scopes (re-exported from `./catalog/collections`, unit `catalog`, the one source of
 * them) with the address slug of each, for `/app/alt-data/library/c/$collection`.
 *
 * Each slug is the catalogue's name written for an address ("Banks and funds" is `banks`). A
 * slug never changes once published: a renamed collection keeps its slug, and older spellings
 * stay as aliases so links already shared keep working.
 */
import { COLLECTIONS, collectionFor } from "./catalog/collections";
import type { Collection } from "./catalog/types";

export { COLLECTIONS, collectionFor };
export type { Collection };

export const COLLECTION_SLUGS = {
  "00_universal": "economy",
  "01_financials": "banks",
  "02_technology": "technology",
  "03_healthcare": "health-care",
  "04_energy": "energy",
  "05_utilities": "utilities",
  "06_industrials": "industrials",
  "07_materials": "materials",
  "08_consumer_discretionary": "consumer-discretionary",
  "09_consumer_staples": "consumer-staples",
  "10_communications": "communications",
  "11_real_estate": "real-estate",
  "12_sec_company_financials": "sec-financials",
  "13_ir_integration": "investor-relations",
  "14_source_atlas": "source-registry",
} as const satisfies Record<string, string>;

export type CollectionId = keyof typeof COLLECTION_SLUGS;

/** Spellings proposed before the catalogue named the collections (ux.md section 4). */
const ALIASES: ReadonlyMap<string, CollectionId> = new Map<string, CollectionId>([
  ["macro", "00_universal"],
  ["ir-documents", "13_ir_integration"],
  ["atlas", "14_source_atlas"],
]);

const BY_SLUG = new Map<string, CollectionId>(
  Object.entries(COLLECTION_SLUGS).map(([id, slug]) => [slug, id as CollectionId]),
);

export const isCollectionId = (value: string): value is CollectionId =>
  Object.prototype.hasOwnProperty.call(COLLECTION_SLUGS, value);

/** The slug of a collection id. An id this list does not know is its own slug, so nothing disappears. */
export function collectionSlug(id: string): string {
  return isCollectionId(id) ? COLLECTION_SLUGS[id] : id;
}

/**
 * The collection an address names: a slug, an older alias or the stored id itself
 * ("01_financials"), case as written. Null when it names none, so the page can say so and
 * link back to the library instead of showing an empty collection.
 */
export function collectionIdFromSlug(slug: string | null | undefined): CollectionId | null {
  if (!slug) return null;
  if (isCollectionId(slug)) return slug;
  return BY_SLUG.get(slug) ?? ALIASES.get(slug) ?? null;
}

/** A collection with its address slug. */
export type LibraryCollection = Collection & { slug: string };

/** Every collection in the catalogue's reading order, with its slug. */
export const LIBRARY_COLLECTIONS: readonly LibraryCollection[] = COLLECTIONS.map((collection) => ({
  ...collection,
  slug: collectionSlug(collection.id),
}));

/** The collection an address names (slug, alias or stored id), or null. */
export function collectionBySlug(slug: string | null | undefined): LibraryCollection | null {
  const id = collectionIdFromSlug(slug);
  return id ? { ...collectionFor(id), slug: collectionSlug(id) } : null;
}

