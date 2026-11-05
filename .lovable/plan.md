# Pre-launch polish

Small, low-risk fixes from known rough edges, then a full check before publishing.

1. **Country list cleanup** — U.S. states (e.g. Ohio) that filings name are currently listed as countries on the supply-chain map and country footprint. Fold them into "United States".
2. **Readable network map** — company cards on the supply-chain network are too small at the default zoom; start zoomed to fit with larger cards.
3. **Quote highlighting fallback** — when a quote's spacing differs slightly from the filing (2 known contracts), highlight using a shorter leading phrase so the passage is still found.
4. **Page titles and share text** — check every page has its own title and description for search and link previews; fill any gaps.
5. **Final check** — open the main pages (dashboard, a company page, supply chain, alt data, hedge funds, IR) signed in, on desktop and phone width, and fix any errors found.

## Technical details
- Add a US-state name/abbreviation set to `normCountry` (supply-intel) and the region helpers in `src/lib/supply/analytics.ts`, with a test.
- ReactFlow `fitView` + larger node min sizes.
- Source viewer search: on no exact match, retry with first ~8 normalized words.
- Audit `head()` across `src/routes`.
- Playwright sweep at 1280 and 390 widths; read build/runtime logs.
