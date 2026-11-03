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
- [ ] Coverage → ~75 companies across all 11 sectors (incl. materials, utilities, real estate)
- [ ] Richer statements: EBITDA, total/net debt, short-term debt, interest expense, deferred revenue, retained earnings, debt issued/repaid, dividends per share, period-end shares
- [ ] More KPIs: ROA, ROIC, interest coverage, net debt/EBITDA, payout ratio, DSO, inventory days, asset turnover, bank efficiency ratio, loans/deposits
- [ ] Slimmer dataset files (KPIs rebuilt in the browser, no duplicated values)
- [ ] Deep segment backfill: every inline-XBRL 10-K + 12 10-Qs + pre-2019 XBRL instance docs; more metrics (op income, net income, assets, capex, D&A); derived Q4 segment values
- [ ] 10-year daily price history (valuation bands)
- [ ] Macro: ~80 series with originating agency (BLS, BEA, Census, Fed Board, NY Fed, Treasury, EIA, DOL, FHFA) + direct U.S. Treasury Fiscal Data (debt, deficit, TGA, avg interest rate, interest expense)
- [ ] Sector driver series (gov data per sector)

### Product / UI
- [ ] Unit scale toggle Full / K / M / B on every financial table (persisted preference)
- [ ] Statement table: sticky header, sparkbars + CAGR column, row charting, YoY heat shading
- [ ] Real .xlsx model export with live formulas + a Sources sheet
- [ ] Valuation tab: P/E, EV/EBITDA, P/S, P/FCF history with median ±1σ bands, point-in-time fundamentals, price vs multiple envelope, peer multiples
- [ ] Capital allocation chart (capex, M&A, buybacks, dividends, net debt) with click-to-source
- [ ] Segment mix: 100% stacked area, treemap, revenue bridge (growth contribution)
- [ ] Macro overhaul: agency sources, category tabs, macro monitor table (percentile / z-score), dual-axis compare with recession shading, fiscal + energy + credit sections
- [ ] Sectors overhaul: sector fundamentals from covered companies, gov industry drivers, sector detail
- [ ] High-quality color logos for every covered company
- [ ] Earnings call transcript reader (Firecrawl), cached, searchable, speaker turns

### Backend
- [ ] Live-refresh tables (prices, filings, Form 4s, macro, job runs) + client merge with snapshots
- [ ] Scheduled jobs: prices, SEC filings scan, Form 4 parse, macro + Treasury, filing-cache warmer
- [ ] SEC filing document cache in file storage (compressed) for fast, rate-limit-proof opening
- [ ] Data status page (last refresh per job)

### Quality
- [ ] Tests for new derived lines, KPIs, unit formatting, segment Q4 derivation, valuation math
- [ ] Browser verification of every new view + mobile pass; landing-page counts updated

## Later
- [ ] Insurer template (BRK)
