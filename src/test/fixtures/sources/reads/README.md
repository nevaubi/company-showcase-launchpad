# Read fixtures (unit `reads`)

One real answer per read of `src/lib/sources/read.functions.ts`, as `{ read, input, result }`, where `result` is
exactly the `SourceRead<T>` the server function returns. UI previews answer the server functions with `result`.

How they were made (25 Nov 2026, about 20:45 UTC): rows were copied from production with small selects and the
checksum-verified line transfer of round 2 (every line verified by `linecheck.py`); the
two snapshot rows were copied as JSON and verified by comparing `md5(to_jsonb(row)::text)` on production with the
same digest of the local copy. The generator of unit reads (`gen-fixtures.ts`, kept outside the repository) loads them into the fake
member client (`src/lib/sources/read.fake.ts`) and calls the real read functions. The fake held exactly the rows
each select returns on production for these inputs: all 27 rows with geo code WV, all 24 rows of period 2026, and
rows 1 and 686 of the MSHA snapshot (its least and greatest period strings, 2000 and 2026, were checked on
production).

| File | Read | Dataset and snapshot | What it shows |
| --- | --- | --- | --- |
| `record.json` | `getSourceRecord` | MSHA coal employment and production by state (`official_04_energy_csv_coal_state_annual_6368e041fb`, snapshot `3952a30e...`, 686 rows, 5 fields) | Row 685: West Virginia, 2026 |
| `series.json` | `getSourceSeries` | same | Field `col0004` (ANNUAL_COAL_PROD, short tons clean coal) for geo code WV: 27 points 2000 to 2026, `next` null |
| `cross-section.json` | `getSourceCrossSection` | same | Field `col0004` across the 24 states of the greatest period string, 2026 (`periodRule: "greatest"`) |
| `period-range.json` | `getSourcePeriodRange` | same | 2000 (row 1) to 2026 (row 686) |
| `entities.json` | `getSourceEntities` | same | `dimension: "geo"`: the 24 state codes of 2026 (no place names in this table) |
| `field-completeness.json` | `getFieldCompleteness` | FHFA house price index by census tract (`official_11_real_estate_raw_hpi_at_tract_d51b3471be`, snapshot `a5b0f712...`, 2,179,042 rows) | Filled share per field from the stored blank counts (hpi1990 is 47.5 % filled) |
| `unavailable.json` | `getSourceFacets` | MSHA | What every 0069 read answers before the migration: `{ ok: false, reason: "unavailable" }` |
| `invalid.json` | `getSourceSeries` | FHFA tract | A cell filter refused on a snapshot over 50,000 rows |

Notes for the screens: every field in these dictionaries is typed `string`; 2026 is the publisher's current-year row
(the dictionary does not say whether the year is complete); the MSHA table has no place names, so `name` is null.

## `library.json` (`getLibraryWire`; `getLibrary()` answers `{ ok: true, data: unpackLibrary(result.data) }`)

The real library for two whole collections, 04_energy (144 tables) and 11_real_estate (36), so the file stays under
40 kB; production has all 1,059 datasets (measured: about 197 kB packed for all of them, 648 kB as objects). Built
by unit reads' `gen-library.ts` (kept outside the repository) with the real `buildLibrary` from: the production dataset list of unit
`catalog` (all 1,059 rows; md5 `3b296784e52d2037203b6460d98ae9f3` of its canonical lines recomputed on production
and equal); the 277 published snapshots of those collections (checksum transfer: rows, fields, publication second,
dimension set, refresh family, latest or not); the four snapshot ids its two single-dataset groups show (md5 checked
on production). Publication times are at second precision, as the packed rows carry them. It shows the EIA Monthly
Energy Review refreshes (groups of 53 and 31 tables on 25 Nov), the FHFA master index version (186,031 to 187,213
records) and the first-publication run of 05:31 to 06:36 across nine publishers.

## Reads that need 0069: `facets.json` (`getSourceFacets`), `snapshot-stats.json` (`getSnapshotStats`)

Produced by the real read functions calling the real SQL of migration 0069 (unit reads' `gen-0069-fixtures.ts`, kept outside the repository)
as a member under row-level security on a local PostgreSQL 16 database (`sqlfn_fixture_test`) that holds the MSHA
snapshot with its dimension columns exactly as production stores them: row number, year and state of all 686 rows
(checksum transfer, one line per state, cross-checked against the 51 full rows above). Cells other than year and
state are blank locally for 635 rows; neither read returns cells. Facets: the 26 state codes with their exact
record counts (Arkansas 23, Kansas 17, Oklahoma 25, the others 27). Statistics: periods 2000 to 2026, 27 periods,
26 places, no entities; `computedAt` is the local run's time. `findSources` has no fixture: a faithful answer needs
every dictionary of the 1,059 tables; its shape is in `read-types.ts` and the database test asserts it.
