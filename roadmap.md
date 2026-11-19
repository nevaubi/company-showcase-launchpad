# Filed Under — roadmap

## Automatic data refresh — wave 1 (Nov 19)
- [x] G15: removed job_runs pruning entirely (no stored ledger deletes); 21 tests and TypeScript passed; live prices refresh stored 230 bars, vendor ledger preserved.
- [x] G14: include 4/A, durable job_state receipts for empty ownership filings (no fabricated trades), per-filing retries; six tests and TypeScript passed; live SEC slices stored three real trades.
- [x] G10: fill unused stale-estimate slots from missing covered tickers, success-only cursor, serial deadline-bound requests and 30-minute persisted error backoff; 17 tests and TypeScript passed; real refresh NOW/CMG/ULTA, newest ULTA 08:03:23Z (was ADBE 07:20:20Z); managed estimates schedule changed hourly → every ten minutes.
- [x] G4: daily FINRA writer on managed 00:05/22:05/23:05 UTC schedule, SPY session calendar, success-only date cursor, unpublished-file retries; 14 tests and TypeScript passed; caught up Nov 16/17/18 with 5,515 rows (prior newest Nov 13), now idle through Nov 18.
- [x] G7: earnings/Reg FD filtered before 500-row limit, three-attempt recorded retry/error receipts, six-hour cooldown, failed downloads remain incomplete, stored-one-file no longer implies complete; four tests and TypeScript passed; live AON accession 0001193125-26-463733 stored all three files at 08:06:54Z (prior newest ZM 05:12:55Z).
- [x] G8 recent-file re-read; G6 IR-site schedule; G9 stale cache fallback; G3 market-wide SEC discovery — finished in wave 2 (see below).

## Combined source reconciliation (Nov 19)
- [ ] Verify and import new FROG/COST/TSMC archives additively; preserve all cited originals, report duplicates and uncertain dates.
- [ ] Compare vendor KPI values with stored source facts; retain conflicts and unsupported gaps in private reports, not live figures.
- [ ] Full extraction and integration of newly uploaded sources; TSMC coverage identity and free-only reader availability must be verified before processing.

## Owner uploads and Alexandria collector (Nov 19)
- [ ] Owner follow-up: detached ordered import verification with ir-upload-import ticker ledger, and fresh background workbook comparison to private ops/ir-upload/ storage; preserve vendor collector.
- [x] Verified additive PDF import: 649 rows stored, 13 duplicates skipped, EVER/SOFI excluded (no bounded coverage-add script), no failures; exact IDs and counts in import-report.json.
- [x] Read-only workbook comparisons saved in workbook-dry-run.json; exact-label matching leaves unmatched/ambiguous values unproven; no corrections applied.
- [ ] Nov 19 continuation: restart full Phase A detached; pending requests wait ten minutes on the same billing ID, Data Legion identifier fallbacks, 50-company ledger, CAS lease; news/removal and catalogue-driven B/C passes added. Render Firecrawl configured; deploy/takeover confirmation pending. B/C sources lacking verified identifiers are explicitly logged as omitted.
- [x] First 25 confirmed by owner: 634 files, 26 capabilities, 1,009 calls, 18,215 credits. Full-list collection is ongoing, not complete.

## IR worker + IR data quality (Nov 17)
- [x] Audit: 4 GB limit despite Pro Ultra, 15-min lease stalls, batch-of-10 lost "finished" credit, review/requeue ping-pong
- [x] Memory-sized lanes, host-tagged 3-min lease, per-company runs, fair retries, admin memory/finished view (deployed 6b08748)
- [x] Verify on Render: 32 GB limit seen (3 lanes), KD/TXT/WRB finished within 8 minutes of takeover
- [x] Crash resume mid-company: every file keeps its own read/convert status, so a restarted company skips finished files (checked in ir-deep/ir-docling)
- [x] Restart safety: readers wait out a replaced machine's per-company hold; "finished" needs every reader to have run; 26 companies finished with files waiting (COF 526, EXE 384, ES 324, WDC 266…) re-read once (goes live with the next worker deploy)
- [x] Docling runaway files: 20-minute per-file timeout restarts the converter; memory now sized from the 32 GB limit
- [x] IR datasets: per-table empty columns trimmed, stray period columns dropped, complementary/duplicate tables and lines merged with value-conflict and other-split guards (CVS 3,701→2,965 lines, 0 cells lost), totals re-checked after merges, bare "TOTAL" renamed, sharper titles
- [x] Declutter IR tab: one "Source documents" panel (library/tables/search), compact how-to-read, complete tables ranked first, empty check rows hidden
- [x] Text reader: figures stated in release sentences (store counts by country, memberships, comps, liquidity, charge-offs) read as number-token pointers, re-read from the token, vague/forecast/boilerplate figures dropped, figures already in a same-day table skipped; each cites its sentence and the source panel highlights the figure in it (COST 88 releases → 9 warehouse lines × 40 quarters)
- [x] Text stage in every company build + background sweep over finished companies (newest releases first); goes live on the worker with the next deploy
- [x] Removed 23,183 figures from an earlier, unsaved text reader (no sentence locator, not auditable) for 13 companies; their releases are being re-read by the audited reader
- [x] Counts stated "as of the release date" sit under the quarter the release reports; text-read dates join the printed quarter column (printed dates unchanged: 0 cells moved on AAPL/WMT/KR/COST/JPM)
- [ ] Text reader on earnings-call transcripts (spoken KPIs: "we ended the quarter with …"); needs speaker-aware chunking and stricter guidance filtering
- [ ] Words-as-numbers in text ("seven in China", "one each in Iceland") — today those lines show as "Not itemized in the release"
- [ ] Table reader: 12-week columns sometimes dated to the calendar month-end (COST 2025-11-30 next to 2025-11-23); fix the date from the column header weeks + filing date
- [x] OpenAI key layer (owner, Nov 17): second reader + gpt-5.4 arbiter on the free daily allowance (ledger, fallback), cross-check of new text reads, check pass for older reads on the worker, allowance tile on /app/worker
- [x] OpenAI lane for table reads: second reader on table chunks (cell coordinates), same dispute rules — measure agreement on a pilot first
- [x] OpenAI lane for slide/image pages (vision) on every page read (Nov 17)
- [ ] Merge fragmented segment lines that only differ by table wording ("Adjusted operating income · Health Services" across 6 tables) into per-segment matrices; needs reader-side segment names
- [ ] Re-read companies whose tables fail most checks (CVS medical membership, operating costs) with the stronger model

## Deep IR build — first 10 companies (Nov 13)
- [x] Gemini table-reading pilot on 14 already-read documents vs the earlier reader: 40K parts 31–47% agreement → 16K parts ~79–80% (8K no better; review pass +0–7 pts for +80% cost, not used for tables). Real disagreements: missed scale on one EDGAR workbook, year-to-date columns read as full year (rejected once filing dates are known), fiscal vs calendar quarter ends.
- [x] File preparation (`scripts/ir-docling.ts`): evidence-only dates/accessions, Docling + OCR hybrid copies of PDF releases/supplements, Markdown copies, spreadsheets; DELL test: 105 files dated, 6 PDFs via Docling (63 pages), 0 failures.
- [x] Orchestrator (`scripts/ir-deep.ts`): skip companies with figures, prepare → tables → slides → retry once → rebuild → report, credit ledger and per-reader caps.
- [x] Run CVS, MCK, BRK-B, CI, F, GM, DELL, KR, FDX, COF and report per company — first passes done (~201K figures, ~89 credits); final pass for late-converted PDFs in progress.
- [x] IR tab shows whichever source (partner corpus or own deep build) has more series, so deep builds are visible.
- [ ] Label merging for deep-built companies: GPT-6 Luna canon on CVS produced no proposal that passed the safety checks (coverage dropped / values lost); try a stronger reasoning pass or tune batches before running it on other companies.
- [x] Monthly figures are now kept (one-month periods with a month-length check); COF credit-metric 8-Ks and Progressive's monthly releases still need a re-read of their rejected files.
- [ ] Review: undated IR-site files (no evidence of a date), scale flags, quarter/year reconciliation per company.
- [x] Owner (Nov 13 12:02): no spend cap; keep looping nonstop. `scripts/ir-deep-loop.ts` (uncapped, resumes unfinished companies, next batch by revenue, mirror resume + import every 3h, pause-and-probe on credits, reports in private storage). Running while this sandbox is alive; next batch: COR, CAH, CNC, ELV, MPC, HUM, BG, ADM, MET, HCA.
- [ ] Keep the loop running batch after batch; report per company (owner, Nov 15: "loop it"). Status Nov 16 03:09 UTC: batches 7–15 finished (~2.2M figures, ~870 credits); batch 16 (LNG…VST) running; fixed stalls (retry-hint ms bug, DB request deadlines, mirror freeze at partner daily limit). Restart after a workspace restart: `setsid nohup bun scripts/ir-deep-loop.ts --force >> /tmp/ir-deep/loop.log 2>&1 &`.
- [ ] Truly nonstop builds need an always-on worker outside this workspace (it stops whenever the workspace sleeps or restarts) — e.g. a hosted worker running the same scripts with Docling; needs the owner's hosting account.
- [ ] When no unread no-figure companies remain, have the loop read new unread files of companies that already have figures (e.g. BAC shows 138 waiting) — reading new files, not redoing old ones.
- [x] Removed 501 outlook/schedule figures stored with future dates (EQIX 268, NEE 163, DUK 55, CSCO, QCOM, HOOD, NVDA, CRM, C) and rebuilt those companies.
- [x] IR tab no longer hangs on bank-sized data (Capital One, BofA load in ~4–5 s).

## HOOD Gemini with Luna escalation (Nov 13)
- [x] Reread eleven HOOD presentations with Gemini 3.1 Flash Lite, quality prompting and bounded follow-ups; 29 pages escalated to GPT-6 Luna. No document failures; 3,398 figures stored, company rebuilt to 46,392 facts / 1,358 series. Dashboards retained 21/11/9 figures but still have 58/58/57 rejections; checks: quarters 867/1,020, years 86/118; 18 scale flags, 2 unlinked series, future period 2026-12-31 require review. Twelve tests passed; build OK. No other companies processed; UI not checked.

## HOOD parallel vision comparison (Nov 13)
- [x] Fixed transport handling with streamed replies, typed body-interruption errors, capped token batches and local checkpoints. Reran all 20 identical pages: zero transport failures; Ling 69 figures, Gemini 250, 29 matching token/value/unit/period readings. Ling had incomplete model answers on 15 pages; these are rejected, not saved. No stored figures changed; 21 tests passed.
- [x] Connected OpenRouter and ran Ling/Gemini parallel reads with bounded follow-ups on 20 HOOD slides: 14 completed, Ling 94 figures, Gemini 139, 79 same-token/value/unit/period matches. Six connection failures; lower-concurrency retry also failed and timed out. Existing facts unchanged; visual spot-check found Net Deposits mislabeled as net_income, so agreement is not proof of correct meaning.

## Waitlist emails and trial activation (Nov 8)
- [ ] Automatic branded waitlist receipt and approval emails — blocked until the owner configures an email sender domain.
- [ ] Approval email sign-in/account-creation links and explicit terms acceptance before starting the 14-day trial; preserve existing subscribers and already-started trials.
- [ ] Verify receipt, approval, acceptance and one-time trial activation end to end.

## Institutional platform (requested Nov 6 — "all, proceed")
- [x] M1 Firm workspaces: firms, roles (owner/admin/analyst/viewer), invites, shared coverage list with assigned analyst/rating/restricted flag, firm notes, branding (logo, colors, disclaimer)
  - [x] M1b Share theses and docs with a firm from their pages (Private / Shared with firm), "Mine / Shared with me" filters, teammates open shared items view-only
  - [ ] M1c Invite emails (needs an email sender domain); today invites are copy-link + in-app
- [x] M2 Report library: company primer, earnings preview, earnings recap and IC memo per company (shared, refreshed when filings/week change), cited sentences + numbered sources, PDF (print) and Word download, customize (sections, order, length, audience, stance, emphasis), firm/personal templates, firm branding, library page with coverage matrix
  - [ ] M2b Pre-write standard reports for every covered company (`bun scripts/reports-pregen.ts --max=40` per run; 8 written for NVDA/AAPL) and schedule it after ingest
  - [ ] M2c Extend reports to the partner-universe companies once their datasets finish backfilling
  - [x] M2d Richer reports (requested Nov 6): many more charts (trends, margins, segment mix, valuation history, estimate revisions), peer comparison tables and charts, cross-company analysis (relative growth/margins/valuation vs peers, peer ranks), all sourced; in-app, PDF and Word
- [x] M3 SEC redline engine: 10-K vs prior 10-K and 10-Q vs same quarter last year, by section (risk factors, MD&A, legal, controls, notes), word-level diffs, rule-based materiality, cited "what changed" brief, links into both filings, any-pair comparison in the browser, assistant tool (`get_filing_changes`)
  - [x] M3b Comparisons stored for all 78 core companies (312 pairs, last two 10-Ks and 10-Qs each); watchlist alerts for material wording changes
  - [ ] M3d Store comparisons for new filings automatically (scheduled runs are capped at ~2s, too short to parse two filings; today new pairs are compared on the spot in the browser and stored when `bun scripts/redlines.ts` runs)
  - [ ] M3c Table-level redlines for notes (debt maturities, segment tables) and 8-K exhibit comparisons
- [ ] M4 Cross-company KPI & segment matrix + industry deep dives (normalized calendar quarters), assistant tools to query it — PAUSED Nov 6 for publish: groups/families/matching/calendar-quarter core written (`src/lib/kpis/core.ts`); next: `scripts/kpi-matrix.ts` build, `/app/kpis` page, assistant tool, tests
- [x] Publish the current work live (requested Nov 6)
- [ ] M5 Interactive web financial model (driver-based 3-statement + DCF) and Wall Street-grade Excel model export (live formulas, inputs/formulas color convention, sensitivity table)
- [ ] M6 Call tone analysis: prepared remarks vs Q&A tone discrepancies, across-call trend; timed briefs
- [ ] M7 Monitors & scheduled deliverables: user/firm monitors, scheduled briefs (in-app inbox), email + Slack/Teams/Outlook/Box delivery where connectable
- [ ] M8 Supply-chain contagion map: interactive multi-order ripple with sourced evidence per edge and historical comparison
- [ ] M9 Live earnings call: capture webcast audio, real-time transcript, live extraction of guidance/KPIs vs consensus and prior guidance, live tone
- [ ] M10 Landing page, pricing tiers, paid access (payments + seat entitlements)

## Research experience review (Nov 5)
- [x] Review main research flows on desktop and mobile
- [x] Fix discovered phone valuation overflow, cramped company headers, clipped assistant drafts and invalid saved filters
- [x] Verify fixes and run regression tests

## Interface quality upgrade (Nov 5)
- [x] Company first-screen hierarchy and grouped navigation
- [x] Consistent compact tables and source evidence
- [x] Compact assistant workflow and connected research actions
- [x] Progressive disclosure without section-internal scrolling
- [x] Retained filters, clear loading/empty/error and dated-refresh states
- [x] Authenticated desktop/mobile research-flow verification (company navigation, evidence handoff, filters, supply flow, chart wheel and live assistant navigation)

## Done (verified end to end in the browser)
- [x] Real-data ingestion pipeline (SEC XBRL statements, filings index, segments from iXBRL, Form 4 insiders + combined feed, earnings releases)
- [x] Design system (paper/ink/highlighter), fonts, brand logo + favicon
- [x] Landing page `/` + `/pricing`
- [x] Auth: email/password, Google, Lovable, demo account one-click sign-in, password reset
- [x] App shell (sidebar, command search) + dashboard
- [x] Companies list + company page (overview, stats, charts, AI narratives, quick links)
- [x] Financial statements wide tables (annual/quarterly) with click-to-source filing panel
- [x] KPIs & segments with formula + source attribution
- [x] Filings & IR browser, insiders, technicals, sectors, macro, theses, research agent, docs & sheets
- [x] Tests for lookup periods/values and the sheet formula engine
- [x] Coverage of 25 companies; Tavily + Firecrawl web research; earnings-call brief; peer table; YoY / common-size views

## In progress — "prod-quality pass" (requested Nov 3)
### Data
- [x] Coverage → ~75 companies across all 11 sectors (incl. materials, utilities, real estate)
- [x] Richer statements: EBITDA, total/net debt, short-term debt, interest expense, deferred revenue, retained earnings, debt issued/repaid, dividends per share, period-end shares
- [x] More KPIs: ROA, ROIC, interest coverage, net debt/EBITDA, payout ratio, DSO, inventory days, asset turnover, bank efficiency ratio, loans/deposits
- [x] Slimmer dataset files (KPIs rebuilt in the browser, no duplicated values)
- [x] Deep segment backfill: every inline-XBRL 10-K + 12 10-Qs + pre-2019 XBRL instance docs; more metrics (op income, net income, assets, capex, D&A); derived Q4 segment values
- [x] 10-year daily price history (valuation bands)
- [x] Macro: ~80 series with originating agency (BLS, BEA, Census, Fed Board, NY Fed, Treasury, EIA, DOL, FHFA) + direct U.S. Treasury Fiscal Data (debt, deficit, TGA, avg interest rate, interest expense)
- [x] Sector driver series (gov data per sector)

### Product / UI
- [x] Unit scale toggle Full / K / M / B on every financial table (persisted preference)
- [x] Statement table: sticky header, sparklines, row charting, YoY / common-size views
- [x] Real .xlsx model export with live formulas + a Sources sheet
- [x] Valuation tab: P/E, EV/EBITDA, P/S, P/FCF history with median ±1σ bands, point-in-time fundamentals, price vs multiple envelope, peer multiples
- [x] Capital allocation chart (capex, M&A, buybacks, dividends, net debt) with click-to-source
- [x] Segment mix: 100% stacked area, treemap, revenue bridge (growth contribution)
- [x] Macro overhaul: agency sources, category tabs, macro monitor table (percentile / z-score), dual-axis compare with recession shading, fiscal + energy + credit sections
- [x] Sectors overhaul: sector fundamentals from covered companies, gov industry drivers, sector detail
- [x] High-quality color logos for every covered company
- [x] Earnings call transcript reader (Firecrawl), cached, searchable, speaker turns

### Backend
- [x] Live-refresh tables (prices, filings, Form 4s, macro, job runs) + client merge with snapshots
- [x] Scheduled jobs: prices, SEC filings scan, Form 4 parse, macro + Treasury, filing-cache warmer
- [x] SEC filing document cache in file storage (compressed) for fast, rate-limit-proof opening
- [x] Data status page (last refresh per job)
- [x] Price fallbacks when Yahoo throttles: Nasdaq for stocks/ETFs, Cboe for the VIX (quotes + refresh job)
- [x] Data-quality fixes: dividends/capex/buyback alternate tags, share counts tagged in millions (MCD), negative derived quarters from restatements (COP), stray early fiscal years

### Quality
- [x] Tests for derived Q4 lines, EBITDA fallback, unit formatting, valuation math, sector roll-ups, transcript parsing
- [x] Browser verification of every new view + mobile pass; landing-page counts updated

- [x] Supply chain v2: $ exposure, 2nd-order links, risk overlays, shock simulator
- [x] Side-panel assistant: page navigation, screen reading, code interpreter, screener, supply tools, deep research loops
- [x] Trade ideas: rule-based long/short setups with point-in-time hit rates, filing evidence and paper trades (`/app/ideas`)

- [x] Markets: earnings reactions leaderboard/profile, correlation explorer, chart-pattern scanner with per-stock hit rates, sector deep-dive pages
- [ ] Company pages: one-screen overview, catalysts timeline, visual polish

## "Use the full potential" pass (Nov 5)
- [x] Hedge funds: crowding composite, 8 leverage/basis-trade gauges, most-unusual readings across all 497 series
- [x] New source: every Treasury auction since 2010, graded for demand
- [x] Connected data: company timeline now includes alt data + supply intel; assistant `get_company_dossier` joins every source
- [x] Proactive AI: sourced morning brief on the dashboard; assistant tools for hedge funds and auctions
- [ ] Patents (USPTO key), lobbying (Senate LDA key), EIA energy (key) — waiting on free API keys from the owner
- [ ] Scheduled refresh for hedge fund + auction snapshots

## Later
- [ ] Insurer template (premiums, loss ratio, float) — needed before adding BRK or other insurers
- [ ] Filing alerts: email when a followed company files a 10-K/10-Q/8-K or an insider trades
- [ ] Cross-company transcript search (store parsed calls so one query spans every covered company)
- [ ] Excel model export linking statements, valuation and segments in one workbook (statements and IR breakdowns now export separately, both styled)
- [x] Company-extension XBRL tags (COP, NEE capex) read from filings' iXBRL so FCF isn't blank for those filers
- [x] Research-agent tool: search inside earnings-call transcripts

## IR documents (current goal — OpenAI-powered deep backfill, requested Nov 3)
- [x] Storage: private `ir-documents` bucket + `ir_documents` metadata; every file stored byte-for-byte
- [x] Collector: 8-K Item 2.02 / 7.01 exhibits from EDGAR back to 2008 (paged submissions history) + IR-site files
- [x] Table extraction with the owner's OpenAI key (model points at cells, numbers re-read from cells), bounded single-flight runner with circuit breaker
- [x] Series builder: parent-aware lines, per-period filing vintages, Q4 = FY − 9M, FY roll-ups, point-in-time KPIs, subtotal / double-breakdown checks, SEC revenue cross-check
- [x] Cross-period label canonicalization pass (reasoning model) with keep-only-if-better acceptance
- [x] Precomputed per-company payload (`ir_company_series`) + new IR page: quarterly/annual, period range, dimension filters, search, totals at the bottom with a parts = total check row, stacked charts, CSV export, full-value toggle
- [x] Vision pass code: slides, chart images, scanned pages → facts pinned to the printed token with page-box highlight
- [x] Data status page: investor-relations library panel (files, size, span, read/waiting, data points, tie-out per company)
- [x] OCR decimal guard: the slide reader returns its own reading of each number; OCR tokens with the same digits take the model's punctuation, anything else is rejected
- [ ] PAUSED Nov 4 03:52 — OpenAI `credit_balance_exhausted` on the owner's key: Sol table extraction (`/tmp/start-extract.sh`: `IR_AI_PROVIDER=openai bun scripts/ir-extract.ts --resume --force --watch --concurrency=64 --chunk-concurrency=8 --max=100000`); ~4,750 files waiting (62% done). Waiting on the owner: add OpenAI credits ("resume") or run Sol through the built-in AI ("switch")
- [x] Sol speed-up: 12 → 32 → 64 files at once, 8 table parts per file in parallel, prompt cache key; 119 failed files re-queued; database/network hiccups retried instead of failing the file
- [ ] PAUSED Nov 4 04:00 — Anthropic "credit balance is too low" after ~$40 of Sonnet slide reading (~2,000 slides, ~20,000 numbers): `/tmp/start-vision.sh` (`IR_VISION_MODEL=claude-sonnet-5-5 bun scripts/ir-vision.ts --resume --force --watch --concurrency=32 --max=100000 --max-usd=750`), ~100 slides/min, ~2.5¢ per file; ~33,700 slide files waiting (est. $800–1,200 to finish). Waiting on the owner: Anthropic credits, or run slides through the built-in AI
- [x] Sonnet slide reader: every number token accounted for (stored or skipped with a reason, follow-up turn for leftovers), high effort + "think first", image before text, pages rendered at Claude's native size, low-confidence OCR tokens with a digit check, 2× OCR upscale for small images, parallel (non-blocking) OCR, scale-slip guard, real image format detection. Pilot vs Sol on 40 slides: 82% same numbers, Sol-only numbers mostly company-wide lines now skipped by rule; visual spot-check of Goldman slide: all Sonnet-only numbers correct
- [x] Minus-sign bug: "$(404)" was stored as +404 by the slide reader; fixed + 25 stored numbers corrected (UNH, GS, AMD, WFC, FCX)
- [ ] Check a Sonnet-read presentation PDF end to end (page images now stored at 1,600 px) once the runner reaches one
- [ ] Progress updates to the owner while the backfill runs (files/slides done, waiting, spend) — requested Nov 4
- [x] Deterministic structure fixes: coincidental subtotal nesting (KO), one-table-per-segment generic rows (LMT), U.S./international/worldwide column sets (ABBV, pharma), period-end counts vs net additions (CMCSA), ~1,000× unit outliers flagged in the UI
- [x] Data status: IR library panel; cut-off scheduled runs shown separately from failures; jobs time-boxed (`RUN_BUDGET_MS`), `ir-docs` every 5 min with done/partial/empty tracking
- [ ] Canonicalization for companies whose totals still don't tie out (DUK, DE, WMT, MCD, LIN, COP, BAC, V …) after extraction finishes — `bun scripts/ir-canon.ts` (KO improved 152→145 failures; VZ and BA kept their originals — no better proposal)
- [ ] Running: historical 2008+ SEC exhibit backfill (`scripts/ir-backfill.ts`, 2 workers), PG→EQIX + JPM, restarted Nov 3 23:46
- [x] IR-website files (`scripts/ir-site.ts`, Firecrawl + Tavily), PEP→EQIX finished Nov 3: 195 new files for 32 companies
- [x] IR tab shows stored tables on first load with no manual step: background readers rebuild each company's tables every few minutes, open pages refresh every two minutes, and a missing payload is rebuilt on request
- [x] IR page never looks empty while the database is busy (slow-load notice, retries, clear timeout message); every bulk job waits on database latency (`dbGate`) and sheds workers
- [ ] Running: PDF/XLSX renditions for newly collected files (`scripts/ir-renditions.ts --limit=400`), started after the site pass
- [x] Production schedules: collector stays inside the scheduled-call time limit (small slices, `RUN_BUDGET_MS`); reading stays in the batch runner
- [x] Deductions printed as positives (costs, eliminations) tie out with the line subtracted and say so; subtotals introduced mid-history (Alphabet "Google") roll their parts into the total for older periods
- [x] Accuracy rules: subsidiary tables repeating the parent's rows keep only the consolidated table (Duke); a line counts once per total, taken from one table (Coca-Cola grids); one-table totals may pick up an eliminations line printed next door; never-matching "breakdowns" are shown as plain lines and counted in stats
- [x] IR library loads slide images on demand (JPM/BAC pages ~3× faster)
- [x] Site slow (Nov 3, 15:19): the smallest database size was overwhelmed by background reading and stopped answering; owner upgraded to Large + 10 GB, pages back to ~1.5s; rebuilds now time out instead of hanging
- [ ] Canonical table names across quarters: one company can title the same table differently each quarter (Coca-Cola "Reported revenues by segment" vs "Net operating revenues by segment"), which splits a line's history across breakdowns. Merging by name alone dropped ~2% of distinct values (tried, reverted); needs the canon pass to map table titles, accepted only when no distinct value is lost
- [x] Label-merging pass rejects proposals that would make printed numbers disappear (restatements excepted) — caught a Walmart proposal that "passed" every check by hiding 598 values
- [ ] Background readers only run while this workspace is open; a long-running worker would keep reading when it sleeps
- [ ] Deterministic accuracy audit: duplicate-total detection across tables
- [x] Payload rebuilds are automatic: the readers rebuild companies that gained facts (big banks less often), full rebuild run Nov 3
- [x] Breakdowns list: "Show 50 more" and "Show all" (off-screen breakdowns skip layout, so 300+ stay smooth)
- [x] Bulk Excel export of IR breakdowns (in view, or complete quarterly + annual history; per-breakdown too): cover with contents, one styled sheet per breakdown type, live Q4/FY and parts = total formulas, Checks and Data & sources sheets with "Open source" links back to the exact cell; built in a background worker
- [x] Financial statements workbook restyled with the same theme (cover, full values with scale formats, input/formula colour coding)
- [ ] Odd period columns for some banks (BAC shows Nov/May/Aug quarter columns): find which facts carry non-quarter-end dates and map or drop them at build time


- [x] Supply-chain map (10-K quoted customers/suppliers/partners/competitors)
- [ ] Trade opportunity engine
- [ ] More analyst tools
- [ ] Portfolio research file
- [ ] Refresh trade-idea scan on a schedule (currently refreshed by rerunning the scan script)
- [ ] More analyst tools; portfolio research file

## Quality pass (requested Nov 4) — supply chain first
- [x] Supply chain: 10-Q + prior two 10-Ks read; "Changes" tab (added/dropped/share moves); "Moves" tab (earnings sympathy moves, beta, same-direction rate)
- [x] Markets: earnings reactions, correlation explorer, pattern detection, sector deep dives
- [x] Company pages: setup-at-a-glance panel and catalysts & events timeline on the overview

## Supply chain — analyst grade
- [x] Product + link type per link, confidence/corroboration, entity merging, dependency score, region footprint, fragility ranking, flow view, cited AI note
- [ ] More sources: call transcripts, 8-K EX-10 contracts
- [ ] XBRL customer-concentration history + purchase obligations charts
- [ ] World map view, lead/lag signals, ecosystem baskets, region shock
- [ ] Assistant tools for exposure questions
- [x] Supply chain alt-data intelligence panel (full 78-company read running)
- [x] Supply chain v4: world exposure map, region shock, ecosystem basket, concentration history, freshness, web cross-check per link, cleaner fragility table
- [ ] Supply chain next: more sources (EX-10 contracts by counterparty, call transcripts), XBRL concentration facts, shipping/customs data

- [x] Watchlist alerts bell, earnings preview/recap, management promise tracker
- [x] Estimates & analysts tab (consensus, revisions, surprises, ratings, targets, actions)
- [ ] Scheduled refresh of analyst estimates (currently script + live refresh on view)
## Merge with the partner (Vercel) site — requested Nov 5
- [x] IR page reads the partner corpus (~800 companies, quote-highlighted sources) with own data as fallback
- [ ] Expand coverage beyond 78 companies (statements, prices, logos from partner bundles)
- [ ] Partner PDFs/IR-site files open in-app (currently only SEC/HTML copies render)
- [ ] Run supply chain, alt data, estimates, signals, company context for new tickers
- [ ] Port partner-only pieces: macro store, 189-field screener, workspace

- [x] Company page redesign: research price chart + read, About with photos, leadership & board, sector comparison, related companies
- [x] Mirror partner company + price files to Cloud (1,844 each)
- [ ] Mirror partner IR store — 46 GB / 564 of 1,844 companies done; paused by partner "daily data limit"; resume with `bun scripts/partner-mirror-ir.ts` (skips finished files)
- [ ] Deep IR builds for all ~1,844 companies (no cap, owner Nov 13) — running via `scripts/ir-deep-loop.ts`; companies whose IR files aren't mirrored yet wait for the mirror


## Platform upgrade (requested Nov 16 21:22 UTC)
- [x] Setups: FINRA daily short volume (2018+), 8-K 2.02 earnings dates, Form 4 insider purchases (2016+), VIX3M term structure, breadth; new strategies: earnings drift, pre-earnings run-up, insider clusters, short-selling flow, panic-day snap back, customer momentum (supply links), confluence; short borrow cost
- [x] Setups: SEC fails-to-deliver feature (lagged to publication) + published "fails pile-up" short rule; tested 2018+: loses money after costs (−0.8% over 10 days, 287 out-of-sample trades), shown as failing — not loosened
- [x] Options market: nightly Cboe snapshots for every stock with listed options (IV30, priced move per expiry, skew, put/call, volume), Options page under Markets (report moves vs past reactions, volatility, positioning, skew), company Earnings-tab panel, setups "options price" column, assistant get_options
- [ ] Options follow-ups: once 60+ trading days are recorded, test IV-rank / priced-vs-past report rules through the strict setups gate (point-in-time, after costs)
- [x] Setups auto-refresh: nightly `setups` job (4 parallel schedules, 21:00–06:00 UTC) refreshes closing bars, rescans every stock, re-tests every strategy, publishes setups and records live outcomes
- [x] Auto paper trading: house + personal autopilots (/app/autopilots) with daily fills, exits, equity vs SPY, hit rate, drawdown, Sharpe; personal autopilot limits trial 2 / Research 5 / Pro 25 are a proposal awaiting the owner's confirmation
- [x] IR tab UX: Key metrics + biggest moves panel, quarterly columns cleaned of month-ends, Monthly view, Q2/Q3 filled from year-to-date columns, current breakdowns first, real gaps marked (payload rebuild running for all stored companies)
- [x] IR monthly flows: table and slide readers keep one-month figures (with a month-length check); Robinhood's monthly-metrics files queued for re-reading in the build loop
- [ ] IR monthly re-reads for other companies that publish monthly metrics (LPL, WisdomTree, MIAX, Allegiant) once their files are read the first time
- [x] Filing detail (Financials → Segments & detail): latest 10-K + 10-Q dimensional XBRL for every company — revenue by segment/product/channel/geography (countries, US states), segment P&L with significant expenses and margin, customer/supplier/region concentration, purchase obligations by year due, inventory components, property by type, operating counts; every value opens its exact tag; assistant `get_filing_detail` (incl. cross-company concentration ranking); `xbrl_concentration` table; refresh every 12 h from the IR loop (full first build running)
- [x] Money map on Segments & detail: products or regions → revenue → segments → costs and profit, every band sourced (remainders as formulas), eliminations explained; fits phones without sideways scrolling
- [x] Supply chain: end-to-end Chain view (suppliers' suppliers → suppliers → company → customers → their customers, 1–3 tiers) from quoted links + XBRL-tagged customer/supplier shares, edges sized by stated share, single-source and two-sided confirmation marked, every edge opens its sentence or tagged fact; phone list layout; assistant get_supply_chain includes the chain; tagged-name matching improved (Amazon, Lowe's, Costco, Ford… now matched; look-alikes like "Southern Wine" rejected); supply records load in parallel
- [x] Supply chain Chain view: size lines by share or dollars (stated amounts, or stated share × seller revenue, with the working shown), filter by what flows (Making it / Selling it / Tech & IP, side-aware) and by product text, every-link table (types, products, share, dollars, filings, flags; row opens its source); assistant get_supply_chain takes flow/product/depth
- [ ] Supply chain next: implied pass-through (how much of an upstream supplier's sales end up with a given end customer) only once a defensible, labelled method exists — today only per-edge stated figures are shown
- [x] Filing detail history: the 10-Ks two and four years back stitched in (about seven fiscal years of segment, product, geography, segment P&L and concentration), newest filing wins each column, CAGR column, every older value opens its own filing; assistant cites each filing per column (full-universe read running: /tmp/xbrl/history.log)
- [x] Banks and lenders on Segments & detail: Loans & deposits (loans by portfolio/class/industry/state, allowance, gross and net charge-offs, recoveries, provision, nonaccrual, 90+ past due, deposits by type) and Regulatory capital sections, seven years with CAGR
- [x] Insurers on Segments & detail: Premiums & claims section (premiums written/earned incl. direct/ceded/assumed, losses and benefits, prior-year reserve development, acquisition costs, underwriting income, Schedule III balances) by segment, line and region; loss & benefit ratio row in the segment P&L
- [x] Alt data for all ~1,844 companies: generated name registry (Wikipedia via SEC CIK, FDIC certs, CFPB names, NHTSA makers; ambiguous names dropped), scheduled refresh rotates every applicable company/source pair (3 per run), full-universe backfill running; cross-company leaderboards computed in the database (latest, vs own normal, vs 1y)
- [x] New gov datasets: SEC fails-to-deliver (2 years, every covered stock, auto-refresh twice a month) and CMS Medicare Part D/Part B drug spending (2020–latest quarter, 60 drug companies, per-drug table)
- [ ] Alt data next: USPTO patents, H-1B/LCA filings, Senate lobbying (LDA API needs a key), EPA enforcement (ECHO, needs facility matching), CourtListener dockets (needs a key); NHTSA recalls refresh only via the script (their query takes ~6 s, longer than a scheduled call); rerun `bun scripts/gov-data.ts --medicare` when CMS publishes a new quarter
- [x] Navigation cleanup: sidebar down to 9 entries (Signals merged into Dashboard tabs; Firm and billing moved to the account menu); every page label matches its menu section; setups table fits without sideways scrolling
- [x] Filing typos: SEC notices whose stated value implies an impossible share price (e.g. Tenable Form 144, $4.1B for 12,000 shares) are flagged on the feed, Insiders tab and assistant, and left out of totals and ranking
- [x] Look polish: page-level empty states share one style (portfolio, firm coverage now match), alt-data cards tighter on phones, partial-year readings labelled "so far"
- [x] Look polish: company header on phones compacted (legal name and HQ hidden, smaller name)
- [x] Assistant reads this site's own deep-read IR figures (quarterly, annual and monthly) through get_kpis, each value linked to the IR page cell that opens its source; picks the fuller of the two corpora like the IR page
- [x] Assistant: get_setups (tonight's setups + strategy scoreboard with gate checks) and get_autopilots (paper bots vs SPY), with instructions to label watch-only ideas
- [x] Cross-company Exposures page: revenue by country/region (share, ~3-year change) and every lender's loans, deposits, charge-offs, allowance and nonaccrual from 10-K tags, click-to-source; assistant `get_exposures`
- [x] Exposures: Insurers view (premiums earned and growth, written, loss & benefit ratio, prior-year reserve development, acquisition-cost ratio, underwriting income, reserves ÷ premiums), assistant get_exposures view "insurers"
- [x] Exposures: bank deposits by state and metro (FDIC Summary of Deposits, 117 banks, 2021–2026) — company tile map + state ranking + assistant
- [x] Medicare drug costs by state for every covered drug maker (CMS Part D prescribers by geography, 2020–2024, 52 companies): company map (share or over/under-index vs Medicare overall), state table with each state's top drugs, cross-company state ranking on Alt data, assistant get_alt_data medicare_states; weekly check for a new CMS year
- [x] EPA Toxics Release Inventory for every covered company with US plants (2019–2024, 433 companies): plant map and list (each opens its EPA page), releases, carcinogens, chemicals, production index (plants' reported production this year ÷ last year), cross-company leaderboards, assistant get_alt_data tri; weekly check for a new EPA year
- [x] Live plant warnings: NWS warnings (storm outline or the plant's own forecast/county/fire zone) and USGS M4.5+ quakes at covered companies' EPA-listed plants — Alt data hub panel, company Plants panel, assistant get_plant_hazards
- [ ] Plants follow-ups: show plant warnings on the supply-chain map (supplier plants) and the Exposures page
- [x] Wrap up, commit and publish all recent work (owner request Nov 17)
- [ ] Exposures: state-level revenue for non-banks is rarely tagged in 10-Ks (~8% of filings carry any state rows, mostly properties/PP&E); revisit with utilities (EIA, needs key) and insurers (premiums by state)
- [x] Data refresh wave 2 / corrections: job_runs keeps 14-day retention except the vendor-backfill ledger; vendor collector always records its credit pause (concurrent successes can't clear it)
- [x] G3: market-wide SEC discovery every 2 min (feed + daily index); 7-day catch-up stored 1,379 of 1,385 missing filings across 542 companies; walk now 4 companies/run
- [x] G9: AI cache serves the last stored value marked stale (with as-of time) when a recompute fails
- [x] G8: worker re-reads a finished company after one new readable file filed in the last 30 days, from any source, before untouched companies
- [x] G6: worker runs IR-website collection every 2h (recent reporters first, 300 Firecrawl credits/day cap in job_state, clean hourly-probe pause on 402) — currently paused: Firecrawl balance is 0
- [x] G1a: scheduled partner-mirror job (1 file/min, cursor in job_state) refreshes local company/price/universe copies; readers mark copies servedFrom=copy (as of generatedAt). Copies were 6–14 days old
- [x] G2: worker writes one due standard report every 10 min (recaps for 2.02 8-Ks in 3 days keyed on that accession, previews for reports due in 7 days), daily limit respected, AI 402 pauses with hourly probe; 36 stale primer locks released
- [x] G5: text reader and label canon fall back to the free OpenAI lane on credit_balance_exhausted (paid path rested 30 min); worker runs label canon daily (40 companies/run, resumes from job_state cursor)
- [x] Sidebar (Nov 19): 20px icons picked per page, 64px collapsed rail with only the F mark and right-side labels on hover, collapse toggle in the top bar beside the sidebar; Insights, Situations, Trade ideas and Setups grouped as Signals and Autopilots + Portfolio as Paper trading under "Ideas" (Dashboard keeps Overview, What changed, Alerts)
- [x] Worker free-only lane: a spent daily allowance pauses scheduled reports until 00:05 UTC instead of failing a slot every 10 minutes
- [ ] Worker redeploy of the reports pause fix (same deploy as 2480843; Render's auto-deploy has never fired, every deploy so far was started through the API)

## Next steps after the Nov 19 credit refill (proposed, owner to confirm)
- [x] Owner (Nov 19 09:47): worker reads on the owner's own OpenAI key after the free tokens run out — live now via IR_FREE_ONLY=0 (IR_AI_PROVIDER=openai, gpt-5.4-mini); IR reads never use Lovable AI credits
- [ ] Deploy 2480843 once it is on GitHub, then set IR_FREE_ONLY=1 back (with IR_OPENAI_PAID=1 already set): free tokens first, paid key after, paid tokens on /app/worker, and scheduled reports also on the OpenAI key instead of Lovable AI credits
- [ ] Owner decision: vendor collector is the main Firecrawl spender (~9K credits in the first 20 minutes after the refill); confirm the pace or set a daily cap
- [ ] Owner decision: Tavily is past its monthly plan and on uncapped pay-as-you-go; set a cap or keep it
- [ ] Add the web-search key to the worker only after the Tavily decision, so IR-website discovery can search as well as scrape
- [ ] Wave 3: G12 (redlines + supply links after new 10-K/10-Qs, weekly supply intel), G11 (bundled analytics to scheduled storage files), G16 (weekly alt-data slow sets, monthly Medicare, registry after coverage changes), G13 (freshness checks that data advanced, not only that a job ran)
- [ ] Fix Render auto-deploy (reconnect the repo in Render so pushes start a deploy) or keep deploying through the API after each worker change

## Owner priority (Nov 19 09:59): stop vendor daily prices
- [x] fiscal-ai prices/daily removed from vendor Phase A (4aa4b87, test in vendor-backfill.test.ts); stored prices__daily files untouched; last prices/daily call 09:53:56 UTC; workspace collector restarted on the fix and holds the shared lease since 10:02:47 (Render's copy waits on it, makes no calls)
- [ ] Deploy main to filedunder-ir-worker once 4aa4b87 / 2480843 / 4caab68 are on GitHub (Render builds only from GitHub; auto-deploy has never fired, deploy through the API), then set IR_FREE_ONLY=1
- [ ] Vendor status label: after a restart job_state keeps "collector interrupted; resume from existing files" while it is collecting again (acquire carries the old reason over) — clear non-credit reasons on acquire, with owner OK since pause logic was frozen
- [x] Audit data repair: future filed dates guarded (notFuture in doc-meta + import, DB trigger); 96 rows (all Citi bond docs, maturity taken as publish date) set to null with originals in job_runs ir-filed-repair; 96 → 0
- [x] G12: scripts/filing-steps.ts on the worker every 30 min (cursor job_state filing-steps, retry receipts filing-steps-fail:<accn>, supply links for filings ≤30 days, weekly supply intel for 20 oldest-signal companies); November 10-K/10-Q without redline 1,033 → 988 after first run (123 built, 0 failed), backlog continues automatically
- [x] G11: worker publishes analytics to datasets/analytics/ (markets+returns daily after the setups cycle, auctions daily, hedge funds weekly, company context 20/day rolling); loaders read storage first, bundled fallback; markets now built for the full covered list from partner price/company files; assistant dossier uses nightly setup_results instead of signals.json
- [x] G16: scripts/alt-slow.ts daily on the worker (registry upkeep for covered companies missing from alt/registry.json, ownership/contracts/recalls for 1/7 of the list per day, CMS Medicare monthly); proof: contracts newest Nov 17 → Nov 19 10:40, recalls Nov 17 → Nov 19 10:40
