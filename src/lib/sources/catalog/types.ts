/** What a screen knows about a dataset before it asks the catalog: the stored row of `source_datasets`. */
export type CatalogInput = {
  id: string;
  name: string;
  sector: string;
  agency: string;
  source_id: string | null;
  source_url: string | null;
  grain: string;
  rows?: number | null;
  retrieved_at?: string | null;
};

export type Publisher = { id: string; name: string; short: string };

export type Collection = {
  id: string;
  name: string;
  order: number;
  blurb: string;
  /** The kit's own specification sheets: never publisher data. */
  internal?: boolean;
};

export type CatalogKind = "native" | "projection" | "derived" | "reference" | "internal";

export type CatalogIssue = { id: string; text: string };

export type CatalogEntry = {
  /** What a reader sees. */
  title: string;
  /** The publisher's own table or series code, shown beside the title ("Z.1 S.1282", "MER 1.1", "UNRATE"). */
  code?: string;
  /** Address of the official listing the title came from; absent when the stored name is kept. */
  titleSource?: string;
  /** `via` is set for copies republished by FRED. */
  publisher: Publisher & { via?: string };
  collection: Collection;
  /** Stable family id from `source_id`: "fed-z1", "eia-mer", "fred", "fdic-financials", "usgs-ds140", ... */
  family: string | null;
  familyName: string | null;
  kind: CatalogKind;
  /** For a projection or derived table: the dataset it was cut from, where the audit established one. */
  parentId?: string;
  /** Internal specification tables, empty tables, the quarantined tables. */
  hiddenByDefault: boolean;
  /** What the audit of 25 Nov 2026 found wrong with this dataset's index or description. */
  issues: CatalogIssue[];
};
