# Official sources (`src/lib/sources/`): rules for the next engineer or agent

Official records are 1,059 published tables of agencies and regulators (migration 0068: `source_datasets`, `source_snapshots`, `source_records`, about 22 M rows). A cell is the publisher's own string; this folder keeps it that way and decides, from facts only, what may be shown, counted or charted.

## Accuracy (binds every screen, panel and tool)
- A stored cell is shown as stored. Blank (`""`), null, zero and a disclosure marker ("NM", "W", ".") are four different things. Missing is an en dash "–", never an em dash, never zero.
- Numbers come only from `numbers.ts` (`readNative`: a plain decimal or nothing), only for a field `fields.ts` calls a quantity, and never rescaled. The unit goes on the axis or column head exactly as the dictionary or a reviewed profile states it.
- `fieldRole`: the dictionary alone makes a quantity only from a numeric `native_type` and a unit that states a quantity. Every live field is `type: "string"` (the store's type), so `type` proves nothing. Identifiers and dates are never quantities, whatever a hint says.
- Periods are parsed only by a declared or unanimously detected format (`periods.ts`); anything else stays a category in code-point order. The Taiwan ROC month is never detected, only declared.
- Every figure traces to dataset, snapshot (immutable), row and field. Link it with `recordHref` / `datasetHref` (`links.ts`); never build an address by hand.
- No inferred identities: a company reaches a table only through a key the source carries (CIK, FDIC CERT with evidence), never a name match. Overlapping tables (a FRED copy and the agency's table, SEC standard facts and the app's statements) are never added together. A cohort is named as a cohort (the FDIC panel is 500 institutions chosen on 30 June 2026). A snapshot's date is when the file was retrieved.
- No publisher's field names in generic code (no CERT, ASSET, DEPSUMBR here): a table family's knowledge goes in a profile (`profiles/`, unit `boards`) keyed by `source_id` and checked against the snapshot's field keys at run time.

## Visuals: two tiers
- Tier 1 (`first-look.ts`), every table: records per period, entities and places by records, filled share per field. It counts records, it never parses a cell.
- Tier 2 (`profiles/`, `boards/`): a measure over time, a ranking, a map, only where a reviewed profile names the measure, its unit and the evidence. The dictionary alone never switches a measure chart on.
- Shape (`shape.ts`): panel, places, series or table, from declared dimensions and counts only. Titles, publishers and collections come from `catalog/` (`describeDataset`), slugs from `collections.ts`.

## Reads and the query layer
- Screens and tools read through `queries.ts` (`sourceQueries.*`), one cache: stable keys, a pinned snapshot is never stale, the abort signal reaches the server, scans are not retried, a page stays on screen only while the next page of the same snapshot loads.
- The reads of `read.functions.ts` answer `SourceRead<T>`. A failure is data: `{ ok: false, reason: "unavailable" }` means migration 0069 is not applied (facets, find, stats, the scan cap). Fall back to the simpler read `first-look.ts` names, or one quiet line; never retry it, never show it as an error.
- The three original reads (`functions.ts`: list, dataset, records) throw; classify with `sourceReadFailure`. A wrong snapshot or dataset is not retried: offer the latest snapshot or the library.
- Records only through the member's own client (row level security); never the admin client in `src/`. A direct select on `source_records` names one `snapshot_id`, then an indexed equality or a row range, at most 1,000 rows (COMMON4b).
- The assistant's tools (`research.ts`, `research-tools.ts`, `research-reader.ts`) return whole rows and whole fields within 9,000 characters, never a clipped number, units on every page, and a page that stopped at the scan limit (`scanComplete: false`) is a cursor to follow, not an end.

## Never
- Parse with `Number()` or `parseFloat` outside `numbers.ts`; format digits of a field that is not a quantity; append a unit to a cell.
- Read `type` as a numeric type, guess a period format, sort periods by locale, rank part of a selection as the whole (`complete: false`).
- Count or sum the values of a table here; count rows only through the stored counts or the reads.
