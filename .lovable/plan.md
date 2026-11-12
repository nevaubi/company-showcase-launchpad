# Backfill HOOD and OSCR investor-relations data

Banks are off the list. This plan covers Robinhood (HOOD) and Oscar Health (OSCR) only. Your OpenAI key is topped up, so the reading steps can run again.

## Steps
1. **Resume the paused step**: restart the figure-naming step that stopped when the credit ran out.
2. **Collect**: find each company's earnings releases and exhibits in their SEC filings, plus decks, spreadsheets and PDFs on their investor-relations sites. Store everything privately.
3. **Read**: spreadsheets and PDFs with Sol, and slides with Claude Sonnet, one company at a time. Every figure stays linked to its source cell. Skip logos and photos.
4. **Build**: create each company's figure series and financial map so its IR Data tab fills in.
5. **Report**: send you per-company progress as it runs: documents found, files read, figures kept and rejected.

## Rules kept
- Exception for HOOD and OSCR only. Deep builds for other new companies stay paused.
- No supply-chain, estimates, redlines or report builds for either company.
- Scheduled jobs and the company data format stay unchanged.

## Technical notes
- Run per ticker with `scripts/ir-by-ticker.ts`: SEC 8-K EX-99 → `ir-site.ts` discovery → `ir-renditions.ts` → extract/vision runners → `ir-build.ts` rebuild.
- Before storing a document, skip it if the partner `ir/{T}.json` index already has that source URL.
- Clear the `ir-canon` paused_reason so the runner resumes.
