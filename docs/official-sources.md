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

`scripts/official-source-worker.ts` runs beside the existing IR worker through `worker-start.ts`. Source imports and large ABS reads hold separate compare-and-swap leases, renew them while children run, honor the shared database back-pressure gate, keep cursors after failure, and back off repeated errors. `OFFICIAL_SOURCES_ENABLED=0` or `ABS_BULK_ENABLED=0` disables the corresponding lane. Restarting the worker resumes committed progress.

The ABS lane uses the existing reviewed ABS-EE reader and atomic store. The additional CIKs in `scripts/data/abs-candidate-watch.json` are discovery candidates from the supplied workbook, not verified parent-company relationships. The reader must establish the actual filing family and issuer. Commercial mortgages remain loan-level records; the existing auto-loan and auto-lease reader produces pool figures. Disposable SEC download copies are trimmed after a child exits; original stored datasets and the retrieval ledger are not removed.

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

The reviewed bundle contains 17 original archives and 1,056 distinct native tables across 15 collections. Its 21,192,456 rows include overlapping projections and reference tables. Exactly 287 rows in three metadata tables were held because an exact source-registry association was unresolved; their file bytes remain preserved. All other snapshots are initially staging and become visible only as their individual imports pass. These are inventory counts, not a claim of completed publication.

## Verification

Pure tests cover native values, CSV chunk boundaries, source filters, field projection, export and worker scheduling. `src/test/source-store.db.test.ts` executes the migration and importer against a scratch PostgreSQL or PGlite database, including row-level security, partial-load invisibility, exact retries, gzip parsing, interruption/resume, quarantine and publication ordering. It refuses a database name that does not identify a test/proof environment. Never run the destructive proof setup against the application database.

The production app build and TypeScript check are separate gates. Visual verification must use an authorized session or an isolated design harness; never relax production authentication to obtain a screenshot.
