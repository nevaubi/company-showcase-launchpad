# Filed Under — roadmap

## Waitlist emails and trial activation (Nov 8)
- [ ] Automatic branded waitlist receipt and approval emails — blocked until the owner configures an email sender domain.
- [ ] Approval email sign-in/account-creation links and explicit terms acceptance before starting the 14-day trial; preserve existing subscribers and already-started trials.
- [ ] Verify receipt, approval, acceptance and one-time trial activation end to end.

## Institutional platform (requested Nov 6 — "all, proceed")
- [x] M1 Firm workspaces: firms, roles (owner/admin/analyst/viewer), invites, shared coverage list with assigned analyst/rating/restricted flag, firm notes, branding (logo, colors, disclaimer)
  - [x] M1b Share theses and docs with a firm from their pages (Private / Shared with firm), "Mine / Shared with me" filters, teammates open shared items view-only
  - [ ] M1c Invite emails (needs an email sender domain); today invites are copy-link + in-app
- [x] M2 Report library: company primer, earnings preview, earnings recap and IC memo per company (shared, refreshed when filings/week change), cited sentences + numbered sources, PDF (print) and Word download, customize (sections, order, length, audience, stance, emphasis), firm/personal templates, firm branding, library page with coverage matrix
  - [ ] M2b Pre-write standard reports for all 78 core companies (`bun scripts/reports-pregen.ts --max=40` per run; 8 written for NVDA/AAPL) and schedule it after ingest
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
- [ ] Run supply chain, alt data, estimates, signals, company context for new tickers (spend cap)
- [ ] Port partner-only pieces: macro store, 189-field screener, workspace

- [x] Company page redesign: research price chart + read, About with photos, leadership & board, sector comparison, related companies
