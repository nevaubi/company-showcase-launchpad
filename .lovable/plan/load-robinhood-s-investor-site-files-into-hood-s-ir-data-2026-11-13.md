# Load Robinhood's investor-site files into HOOD's IR Data

Your manifest lists 484 HOOD files (Q2 2021 to Q3 2026, monthly metrics Jan 2023 to Oct 2026), all downloaded, with a ready archive that expires around Nov 19. Today HOOD's IR Data comes only from SEC filings, so this fills the gap.

## What gets used
- **Keep and read (about 245 files):** press releases, earnings presentations, call transcripts, supplemental information, investor presentations, monthly metrics PDFs, press releases and spreadsheets (Excel kept in full, never skipped), monthly dashboards.
- **Store only, not re-read:** 10-Q/10-K PDFs and the SEC original-format files (XML, XSD, RTF, JSON). HOOD's financial statements already come from SEC data; reading them again would just duplicate figures.
- **Skip:** webcasts (streaming links only).

## Steps
1. Download the year archives from the file link, and check each file against the manifest's size and fingerprint. Any mismatch is fetched again from its original Robinhood link.
2. Store every file permanently in the private IR document store, tagged with its quarter or month, category and original investor.robinhood.com link (so source clicks open the real page). Files already stored for HOOD are skipped, so nothing is duplicated.
3. Build page/table copies for PDFs and spreadsheets, so every figure points to its exact cell or page line.
4. Read them one at a time, as before: files with Sol on your OpenAI key; slides and dashboards with Claude Sonnet. Retry failures once.
5. Standardize figure names, rebuild HOOD's series, then check that quarters add up and monthly figures (funded customers, assets, trading volumes, net deposits) line up with quarterly ones.
6. Open the HOOD IR Data page signed in and confirm the new monthly and quarterly lines appear with working source links.

## You will get
- Progress updates per batch (year by year).
- A final count: files stored, figures added, new series, anything that didn't add up.
- Estimated reading cost: roughly $10 to $20, mainly slides and dashboards. I'll stop and ask if it heads past $30.

## Technical notes
- New one-off script `scripts/ir-import-manifest.ts --ticker=HOOD --manifest=...` that writes `ir_documents` rows (source URL = manifest `url`, dedupe by URL and sha256) and uploads to the `ir-documents` bucket, then hands off to the existing renditions, extract, vision, canon and build steps in `ir-by-ticker.ts`.
- Monthly files get period end = month end; quarterly files use quarter end.
- No other company is touched; the pause on deep builds for new companies still applies.
