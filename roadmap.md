# Filed Under — roadmap

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

## Later
- [ ] Insurer template (premiums, loss ratio, float) — needed before adding BRK or other insurers
- [ ] Filing alerts: email when a followed company files a 10-K/10-Q/8-K or an insider trades
- [ ] Cross-company transcript search (store parsed calls so one query spans every covered company)
- [ ] Excel model export with live formulas linking statements, valuation and segments
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
- [ ] Running: table extraction over the waiting documents (`bun scripts/ir-extract.ts --resume --watch`, 16 workers — 32 saturated the database pool)
- [ ] Running: vision pass over presentations and chart/slide images (`bun scripts/ir-vision.ts --resume --watch`, 6 workers)
- [x] Deterministic structure fixes: coincidental subtotal nesting (KO), one-table-per-segment generic rows (LMT), U.S./international/worldwide column sets (ABBV, pharma), period-end counts vs net additions (CMCSA), ~1,000× unit outliers flagged in the UI
- [x] Data status: IR library panel; cut-off scheduled runs shown separately from failures; jobs time-boxed (`RUN_BUDGET_MS`), `ir-docs` every 5 min with done/partial/empty tracking
- [ ] Canonicalization for companies whose totals still don't tie out (DUK, DE, WMT, MCD, LIN, COP, KO, BAC, V …) after extraction finishes — `bun scripts/ir-canon.ts`
- [ ] Running: historical 2008+ SEC exhibit backfill for all companies (`scripts/ir-backfill.ts`)
- [ ] Running: IR-website files for every company (`scripts/ir-site.ts`, Firecrawl + Tavily)
- [ ] Running: PDF/XLSX renditions for newly backfilled files (`scripts/ir-renditions.ts`)
- [ ] Production schedules: keep the collector inside the scheduled-call time limit (small slices), reading stays in the batch runner
- [ ] Deterministic accuracy audit: duplicate-total detection, sign conventions for eliminations
- [ ] Rebuild every company's payload once the reading passes finish (`bun scripts/ir-build.ts`)
