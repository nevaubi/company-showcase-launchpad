# Filed Under — roadmap

## Done (verified end to end in the browser)
- [x] Real-data ingestion pipeline (SEC XBRL statements, filings index, segments from iXBRL, Form 4 insiders + combined feed, earnings releases) for AAPL, MSFT, NVDA, AMZN, GOOGL, TSLA
- [x] Design system (paper/ink/highlighter), fonts, brand logo + favicon
- [x] Landing page `/` + `/pricing`
- [x] Auth: email/password, Google, Lovable, demo account one-click sign-in, password reset
- [x] App shell (sidebar, command search) + dashboard
- [x] Companies list + company page (overview, stats, charts, AI narratives, quick links)
- [x] Financial statements wide tables (annual/quarterly) with click-to-source filing panel
- [x] KPIs & segments with formula + source attribution
- [x] Filings & IR browser (exhibits, earnings releases, EDGAR full-text search)
- [x] Insider trades (company tab + cross-company hub)
- [x] Technicals (live Yahoo prices, overlays, RSI/MACD, compare, earnings reactions, AI chart read)
- [x] Sectors (heatmap, relative performance, correlation matrix)
- [x] Macro (FRED series, yield curve, recession shading, AI brief)
- [x] Theses (CRUD, log, price tracking, AI review)
- [x] Research agent (tool loop over SEC/Yahoo/FRED + hosted web search, cited answers, saved sessions)
- [x] Docs (rich text + AI assistant + insert sourced data table) & Sheets (formula engine with FU()/PRICE(), AI build)

- [x] Tests for lookup periods/values and the sheet formula engine (`bunx vitest run`)
- [x] End-to-end: demo sign-in, email sign-up + confirmation + sign-in, click-to-source, agent with quote highlighting, theses + AI review, docs/sheets autosave, macro brief, narratives
- [x] Mobile layout pass (no horizontal overflow on main pages)

## Ready
- [x] Narratives show "web search" provenance when the headline feed is throttled
- [x] Research agent switches to web search when the headline feed is throttled
- [ ] Add META and AVGO to coverage with the ingest script (standard statement templates already fit them)

## Later
- [ ] Earnings call transcripts source (needs licensed provider or Firecrawl connection)
- [ ] Bank/insurer statement templates (JPM, BRK)
- [ ] Broader coverage (more tickers via the ingest script)
