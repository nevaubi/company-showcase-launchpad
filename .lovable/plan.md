# IR pipeline review

## What's happening now
- **Collection is alive**: 75.8K stored documents across 294 companies; 2,021 added in the last 7 days, newest today. 249 filing scans done, 12 came back empty.
- **Understanding has stopped**: no document has been read for figures in 7+ days. The file reader and slide reader last ran Nov 5. The step that standardizes figure names has been paused since Nov 3 because the OpenAI key ran out of credit.
- **Backlog**: about 60K documents never read. Most are images (57K logos and photos), but **297 spreadsheets** and **1,705 PDFs** are still waiting, and those hold the most valuable figures.
- **Quality**: many finished documents reject a lot of figures (some over 100 each). That's the safety check working, but at that volume it's probably also dropping good figures.
- Separately, the partner service now holds a much bigger store (~162K documents), so local collection partly duplicates it.

## The five banks (JPM, C, BAC, PNC, WFC)
Nothing is running for them right now. No bank job is active on the server, and none of the five has stored or read a document in the last 24 hours.

| Bank | Docs stored | Last collected | Last read | Files not read yet |
|---|---|---|---|---|
| JPM | 6,250 | Nov 3 | Nov 4 | 21 |
| BAC | 3,461 | Nov 3 | Nov 4 | 32 |
| C | 2,825 | Nov 3 | Nov 4 | 0 |
| WFC | 2,853 | Nov 3 | Nov 5 | 60 |
| PNC | 3 | Nov 6 | never | 0 |

The bank runs stopped around Nov 4–5, when the OpenAI credit ran out. Citi is fully read. JPM, BAC and WFC have 113 files left between them. PNC was never really started.

## My take
Collection is in good shape. The value is now stuck behind one billing problem and a reading backlog. Images are wasted work. Spreadsheets should go first.

## Proposed plan
0. **Finish the banks first**: once unblocked, read the 113 files left for JPM, BAC and WFC. Run PNC's full collect-and-read pass. Then rebuild all five banks' figure series and financial maps, and check BAC's map fills more than two zones.
1. **Unblock**: top up the OpenAI key, or move the figure-name step to the built-in AI service so it can't stall on someone's card again. Show any paused step on the admin Data freshness page.
2. **Read the backlog in priority order**: spreadsheets first, then press-release and supplement PDFs, then slides. Skip logos and photos completely.
3. **Recover rejected figures**: look at a sample of high-reject documents, fix the common causes (unit scaling, rows split across lines), and re-check those documents again.
4. **Stop duplicating the partner**: before saving any new document locally, skip it if the partner store already has it.
5. **Watchdog**: alert on the freshness page when nothing has been read for 48h or a step is paused.

## Technical notes
- The paused job is `ir-canon` (paused_reason: OpenAI 429 credit_balance_exhausted). `ir-extract-runner` and `ir-vision-runner` cursors last moved Nov 5.
- Backlog query: `ir_documents.extract_status is null`, grouped by ext. For images, write `extract_status='skipped image'`.
- Dedupe against the partner `ir/{T}.json` index by source URL (helpers in `src/lib/ir/store.ts`).
- Per the standing rules, this doesn't touch the extra-universe tickers or start deep builds for them.
