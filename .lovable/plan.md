# Keep our own copy of the partner data on Lovable Cloud

## Goal
Copy the partner data into your Cloud, so the app keeps working with up-to-date data even if the partner service is down, and you own the corpus you might later sell.

## What's on your Cloud today
- Stored files: 22 GB of IR documents (86K files), 336 MB of company and price files (564 files), 156 MB of SEC filings.
- Database: 1.8 GB, with 24% of the disk used.

## Steps
1. **Measure first.** Read the partner's file lists to count how many company, price and IR files exist and their total size. Report this to you before copying anything large.
2. **Company financials and prices (small, do first).** Twice a week, after the partner's refresh, copy every company and price file into the Cloud storage the app already uses as its backup. The app's current loading order doesn't change: partner first, then this copy.
3. **Partner IR store (large).** Copy the documents we don't already have, matching by link and fingerprint so nothing is stored twice. Cover all ~1,844 companies in small parallel batches that don't slow the site. Include each document's extracted text and tables so source clicks work from your copy.
4. **Keep it fresh.** A scheduled job picks up new or changed partner files each week, and the admin Data freshness page shows when the last copy ran and anything missing.
5. **Check.** Compare file counts and fingerprints against the partner's lists, then turn off the partner service in a test and confirm company pages, IR Data and source clicks still load.

## Cost and space
The ~162K-document IR store will probably add tens of GB of storage, which uses Cloud credits. Step 1 gives the real size. If it's large, we stop and ask before copying it all. The database disk itself barely grows, because the files live in storage, not the database.

## Rules kept
- Data loading code (`getDataset`) and the ingest output format stay unchanged; the copy reuses the existing backup location.
- No new deep data builds for extra companies; this only copies what the partner already made.
- The partner key stays server-only.

## Technical
- New `scripts/partner-mirror.ts` (resumable, `dbGate`/`runBatch` throttled): lists `companies/`, `prices/`, `ir/{T}.json`, `irstore/`, `doctables/`, and writes to the `datasets` and `ir-documents` buckets, with a `partner_mirror` manifest table (path, sha256, bytes, mirrored_at; service-role only).
- A small `partner-mirror` job in `jobs.server.ts` with a cursor, respecting `RUN_BUDGET_MS`. The bulk first copy runs as a script.
- Mirrored IR rows are marked `source='partner'` so the IR library keeps deduping by source URL.

## Update: deep data builds for every company (your rule change)
- **Database:** stay on Lovable Cloud. The files go in Cloud storage, and the database is only 24% full. A second database would split the data and add sync work without making anything faster. If space gets tight we can grow the disk or server size in place.
- **Timing:** copying the partner data can fit in 1–2 hours if the store is in the tens of GB. Deep builds for all ~1,844 companies can't. HOOD alone took several hours of AI reading and about $10–20. At that rate, everything would run to thousands of dollars and days of reading.
- **Proposed order:** (1) copy the partner data now (1–2 h); (2) deep builds for all ~1,844 companies, many at once, largest first, with Gemini 3.1 Flash Lite reading slides and GPT-6 Luna reviewing the hard pages. Companies that already have partner IR data reuse it instead of being read again, which saves the most time and money. (3) A spending cap you set, with progress for each company.
