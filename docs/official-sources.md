# Official source records

The Source explorer at `/app/alt-data?view=sources` reads native official records alongside the existing company signal views. It does not replace the statement builder, investor-relations corpus, ABS tables, or existing derived `alt_data` metrics.

## Storage and publication

`source_files` records immutable SHA-256 file identities and ordered parts in the private `datasets` bucket. Each part is at most 32 MiB and its path is `official/objects/<part SHA-256>`. The complete archive and the extracted native table can both be retained without inventing a new source attribution.

`source_datasets` describes the publisher, grain, source URL and scope. `source_snapshots` binds an ordered field dictionary and ingest contract to exact file bytes. `source_records` stores source cells as ordered strings or explicitly declared nulls, with separate entity, geography and period search indexes. A blank, a zero, a disclosure marker and a missing value remain different values.

Registration creates staging snapshots. The importer checks every part hash and byte count, the assembled file hash, CSV headers, every row width and the final row count. A snapshot becomes readable only after its atomic publication operation succeeds. Published snapshots are immutable. A failed or interrupted successor leaves the prior version available. Repeated batches must match the stored values exactly and extend a contiguous row prefix.

The user-scoped server functions require app access. PostgreSQL RLS independently restricts member reads to published snapshots, and only the service role can ingest. The temporary upload-ticket bucket is private and excluded from member reads. Never add a service-role key, signed transfer capability, local transfer receipt, or raw dataset to the repository.

## Operator commands

Run these only with the intended project's server-side environment. The register command requires the explicit project reference so a similarly named partner database cannot receive the bundle accidentally.

```sh
bun scripts/source-register.ts --manifest=/path/to/reviewed-manifest.json --dry-run
bun scripts/source-register.ts --manifest=/path/to/reviewed-manifest.json --expect-project=gdhfpihswzvelbmmrzmm
bun scripts/source-import.ts --all --max-snapshots=25 --max-runtime-seconds=480
bun scripts/source-import.ts --snapshot=<snapshot-sha256> --max-runtime-seconds=480
```

Registration is idempotent only for the same immutable file and snapshot definitions. It checks existing definitions before and after inserts, preserves publication pointers, and refuses conflicting definitions. Explicitly quarantined metadata remains failed and cannot be published by a normal retry.

`scripts/official-source-worker.ts` runs beside the existing IR worker through `worker-start.ts`. Source imports, official refreshes and large ABS reads hold separate compare-and-swap leases, renew them while children run, honor the shared database back-pressure gate, keep cursors after failure, and back off repeated errors. New children wait when the container lacks memory headroom for the existing readers. `OFFICIAL_SOURCES_ENABLED=0`, `OFFICIAL_REFRESH_ENABLED=0` or `ABS_BULK_ENABLED=0` disables the corresponding lane. Restarting the worker resumes committed progress.

The ABS lane uses the existing reviewed ABS-EE reader and atomic store. The additional CIKs in `scripts/data/abs-candidate-watch.json` are discovery candidates from the supplied workbook, not verified parent-company relationships. The reader must establish the actual filing family and issuer. Commercial mortgages remain loan-level records; the existing auto-loan and auto-lease reader produces pool figures. Disposable SEC download copies are trimmed after a child exits; original stored datasets and the retrieval ledger are not removed.

## Automatic source refreshes

The refresh worker polls every five minutes, processes at most eight due datasets in a bounded eight-minute run, and persists each dataset's own next due time. Polling does not mean every source publishes new data every five minutes. These are the reviewed source families:

| Family | Covered refresh inputs | Check cadence | Native scope |
| --- | --- | --- | --- |
| FRED | 120 hash-proven direct CSV inputs from the initial bundle | Daily | Original series and lower date bound; a retained upper date bound advances to the current date |
| EIA Monthly Energy Review | 107 hash-proven direct CSV inputs | Weekly | The original official table identifier and ordered fields |
| FHFA | Annual tract CSV and the master HPI CSV | Weekly | Native tract and master index rows, with exact original-byte provenance |
| FDIC | Current reported quarter for the fixed 2026-Q2 cohort of 500 CERTs | Daily | All returned native fields from the historical field dictionary; reporting coverage and verified omitted fields are explicit |
| TWSE and TPEx | Two official reported monthly revenue feeds | Daily | Each exchange's complete returned response, native Chinese headers, issuer codes and reported revenue strings; full exchange population completeness is not independently established |

The 229 direct CSV inputs are eligible only after their original snapshots are published. The master HPI CSV uses the reviewed supplement in `refresh-supplements.ts`: only its exact dataset ID, original SHA-256 and complete ingest contract match. The retained raw-download receipt and its own hash establish the URL without rewriting the registered canonical file provenance; later retrievals carry that proof forward. The FDIC current-quarter adapter waits for the verified full historical FDIC baseline. The three native-adapter datasets are additional datasets; historical cohorts and technology-only Taiwan subsets remain intact. `OFFICIAL_FDIC_NATIVE_ENABLED=0` and `OFFICIAL_TAIWAN_REVENUE_ENABLED=0` disable those adapters independently.

```sh
bun scripts/source-refresh.ts --all --plan --max-datasets=8
bun scripts/source-refresh.ts --all --max-datasets=8 --max-runtime-seconds=480
bun scripts/source-refresh.ts --dataset=<reviewed-dataset-id> --max-runtime-seconds=480
```

Source responses are restricted to reviewed HTTPS endpoints with bounded transfers and explicit redirect rules. Complete responses, original hashes and supporting field/identity evidence are retained. Conditional responses and unchanged content update the checked time without manufacturing a new snapshot. A changed response receives a new immutable retrieval event; a source reverting to older bytes also receives a new event so publication chronology remains correct.

FRED CSV transfers use the worker's existing Python 3 runtime with standard TLS verification and the same reviewed endpoint, series and date bounds. The parent creates the output file exclusively, gives the child only that file descriptor and the needed network settings, bounds the transfer and process lifetime, and independently verifies the returned byte count and hash. Cancellation removes only the file created by that attempt. Successful changed responses retain this transport evidence alongside their retrieval provenance; normal staging and importer validation still determine publication.

Every changed table passes header, width, row and hash validation before it is staged. The importer independently verifies and publishes it. A changed header is held for review; the previous published snapshot remains usable. A staged refresh prevents duplicate collection while its import is pending. Per-dataset state lives under `source-refresh-state:<dataset-id>` in `job_state`; separate `source-refresh-lock:<dataset-id>` rows hold collection leases. A checked or staged timestamp is not a publication timestamp. Actual row counts come from `source_snapshots`.

How a refresh run spends its time and what it reports (rules and tests: `scripts/lib/source-refresh-run.ts`, `src/test/source-refresh-run.test.ts`):

- Each family has its own switch on the worker: `OFFICIAL_FRED_ENABLED`, `OFFICIAL_EIA_MER_ENABLED`, `OFFICIAL_FHFA_ENABLED`, `OFFICIAL_FDIC_NATIVE_ENABLED`, `OFFICIAL_TAIWAN_REVENUE_ENABLED`. A family is off only for `0`, `false`, `off` or `no`; unset is on. `OFFICIAL_REFRESH_ENABLED=0` still stops the whole lane.
- A dataset starts only when the rest of the run covers its whole transfer plus 10 seconds: FRED 20 s, EIA and FHFA 120 s, FDIC 300 s, Taiwan 120 s. A FRED transfer is capped at 20 seconds, parent and child alike.
- A dataset that fails, or that the run budget cuts off, keeps a failure state (next try 30 minutes later, doubling to a day) and never keeps its lock: state and locks are written through a database client that the run's stop signal does not cancel. A stop signal from outside counts nothing against the dataset.
- Two transfers in a row that get no answer (no reply, a network error, 403, 429 or 5xx) pause that family for the rest of the run and, through `source-refresh-family:<family>` in `job_state` (the provider circuit's form), for 30 minutes, then 60, 120, 240 and every 6 hours, one dataset trying each time. An answer closes it. A bad file is the dataset's failure, not the family's. A run of one named dataset (`--dataset=`) is never held back by a circuit.
- One dataset's failure is that dataset's: the run exits 0. Exit 1 means the run itself failed (planning or the state store), 124 that a signal stopped it. The worker passes `--receipt=<file>`; the run's account becomes `job_runs.detail` of `official-source-refresh`: `checked`, `unchanged`, `staged`, `held`, `failed` (id, family, fault, error), `first_error`, `not_started` (reasons counted, three sample ids each), `paused_families`, `switched_off`, `fred_probe`. Error text is stored without URL query strings or anything that looks like a credential.
- FRED reachability probe: while FRED is switched on, at most once every 6 hours (`source-refresh-probe:fred` in `job_state` holds the time), the run makes three requests for one small series (DGS10, 30 days), once each, 15 seconds each: the contact user agent over HTTP/1.1, the user agent the refresh sent until 25 Nov 2026 with `Accept-Encoding: identity` over HTTP/1.1, and the contact user agent over HTTP/2. Status and seconds of each, and one sentence reading them, are in `job_runs.detail.fred_probe`. `--probe` forces one.
- Every collector sends `FiledUnder Research research@filedunder.ai` (`OFFICIAL_USER_AGENT`, the SEC lane's line). `OFFICIAL_SOURCE_USER_AGENT` is no longer read.

The final November 25 native-adapter proof compared all 1,207,334 cells against the captured official responses: FDIC 496 × 2,378, TWSE 1,091 × 14 and TPEx 898 × 14. The FDIC result was 2026-09-30; four cohort CERTs were absent and the officially requested `L_REPDTE` field was not returned. The Taiwan result retained ROC month `11510`; the explicitly verified search index was `2026-10`. Those counts describe that response, not permanent coverage guarantees.

Other historical source families remain available as published native snapshots. Their inclusion in the catalogue does not imply an implemented refresh adapter.

## Research assistant access

The existing assistant has three read-only tools: `search_official_sources`, `inspect_official_source` and `query_official_records`. They use the same app-access checks and ready-snapshot queries as the Source explorer. The assistant first discovers scope and native field keys, then pins an immutable snapshot and requests explicit fields and exact entity/geography/period filters.

Each record response contains at most 20 complete rows and 12 selected fields, original string/null values, units, row numbers, original source URLs and pinned explorer links. Output limits remove whole rows or fields; they never clip a financial value. Compacted history contains identifiers and a requirement to reread, not fragments that could be mistaken for a complete number. No ticker, holding-company, geographic exposure or unit conversion is inferred by these tools.

## Interpretation rules

- The retained FDIC historical population is the 500 insured institutions selected by assets at 2026-06-30. It is not a universe of 500 publicly traded companies. Preserve the fixed cohort date and survivorship caveat. CERT identifies the insured institution; RSSDHCR identifies its regulatory parent.
- The full FDIC bank-quarter CSV has 2,379 source columns. Use each field's retained dictionary for scale and definition. Income fields can be year-to-date or quarter-only; do not combine them by name similarity.
- SOD branch county is `STCNTYBR`; the institution's headquarters county is different. The search index may explicitly pad a validated four-digit numeric branch county to five digits. Native cells remain unchanged. A cohort branch total is not the denominator for an all-bank county market share.
- EIA plant, generator, utility, operator and owner are separate entities. A latest owner is not a historical owner. The monthly EIA-923 index combines its declared year and month columns; the original cells and original period fields remain available.
- FHFA county, ZIP and census-tract series are house-price indexes, not property prices or company revenue. Geographic detail depends on the actual source.
- Taiwan revenue snapshots retain native issuer codes, Chinese field names, period labels and reported scale. A currency that is not established by the retained source is not inferred.
- SEC standard facts, IR workbook extracts and native agency tables retain their separate scope. Overlapping projections and native tables must not be summed as unique economic observations.
- A stored historical snapshot is not evidence that its source is automatically refreshed. Refresh capability must be implemented, executed and monitored per source family.

## Initial bundle scope

The reviewed bundle contains 17 original archives and 1,056 distinct native tables across 15 collections. Its 21,192,456 rows include overlapping projections and reference tables. Exactly 287 rows in three metadata tables were held because an exact source-registry association was unresolved; their file bytes remain preserved. At the verified 2026-11-25 06:39 UTC checkpoint, all 1,053 eligible original snapshots were published with exactly 21,192,169 rows and no remaining staging prefix or new failure. The 287 quarantined metadata rows were not published. Later refresh snapshots are counted separately, and the UI reports their current publication state.

## Verification

Pure tests cover native values, CSV chunk boundaries, source filters, field projection, export and worker scheduling. `src/test/source-store.db.test.ts` executes the migration and importer against a scratch PostgreSQL or PGlite database, including row-level security, partial-load invisibility, exact retries, gzip parsing, interruption/resume, quarantine and publication ordering. It refuses a database name that does not identify a test/proof environment. Never run the destructive proof setup against the application database.

The production app build and TypeScript check are separate gates. Visual verification must use an authorized session or an isolated design harness; never relax production authentication to obtain a screenshot.
