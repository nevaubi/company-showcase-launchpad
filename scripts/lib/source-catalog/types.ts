/** One stored dataset as the generator reads it (the fixture's shape). */
export type DatasetRow = {
  id: string;
  name: string;
  sector: string;
  agency: string;
  source_id: string | null;
  source_url: string | null;
  grain: string;
  rows: number | null;
  retrieved_at: string | null;
};

/** What `titles.generated.json` holds for a dataset: the title, the publisher's code, the listing address. */
export type GeneratedTitle = { title: string; code?: string; source: string };

/** A dataset of the family that no listing entry matched with certainty, and why. */
export type Unmatched = { id: string; name: string; reason: string };

export type FamilyResult = {
  titles: Record<string, GeneratedTitle>;
  unmatched: Unmatched[];
};

/** A page a family reads, as the generator hands it over: address and decoded text. */
export type Page = { url: string; status: number; body: string };

export type Family = {
  /** Stable id, the same as the catalogue's family id where one exists. */
  id: string;
  /** The datasets this family titles. */
  candidates: (datasets: DatasetRow[]) => DatasetRow[];
  /** The listings to read, given the candidates (fixed addresses or one per series). */
  listings: (candidates: DatasetRow[]) => string[];
  /** Pure: titles from the pages read. A page that did not answer 200 is passed with its status. */
  build: (candidates: DatasetRow[], pages: Map<string, Page>) => FamilyResult;
};
