# Supply chain: analyst-grade upgrade

Today: ~740 links from 10-K/10-Q text for 78 companies, each with a verbatim quote, a network map, and tabs for evidence, price moves, year-over-year changes, shock and exposure. Below is what a professional desk would expect on top of that, in the order I would build it.

## 1. Better data (the foundation)
- **More sources per link:** earnings-call transcripts (management naming customers/suppliers), 8-K material contracts (EX-10 supply agreements, purchase obligations), IR decks, and the *counterparty's* filings (if TSMC is a supplier to NVDA, NVDA's link also shows TSMC-side evidence). Each source keeps its exact quote and link.
- **Confidence score per link:** stated in a filing (high) / said on a call (medium) / web-only (low, labelled). Multiple independent sources raise it.
- **Hard numbers from XBRL:** customer concentration (`ConcentrationRiskPercentage` by customer), purchase obligations, geographic revenue, so dollar exposure comes from tagged facts, not text guesses.
- **Entity cleanup:** one canonical name per counterparty (e.g. "Taiwan Semiconductor", "TSMC", "TSM" merge), with ticker and country, including private and foreign firms.
- **Link types beyond supplier/customer:** foundry, contract manufacturer, licensor, distributor, partner, competitor, with the product or input involved (e.g. "HBM memory", "3nm wafers").

## 2. Context and analysis on each link
- **Link card:** what flows (product/input), since when, contract terms if disclosed, share of revenue/cost, single-source flag, region, every quote across years, confidence.
- **Dependency score per company:** concentration of top customers, single-source inputs, region concentration (Taiwan/China), so you can rank "most fragile" names.
- **AI analyst note per company (cited):** a short write-up of key dependencies, what changed this year, and the risks — every sentence linked to its quote. Cached, regenerated only when new filings arrive.
- **Change alerts:** new customer named, customer dropped, share up/down, new single-source language — surfaced on the page and in the assistant.

## 3. Visuals
- **Tiered flow view (Sankey):** suppliers → company → customers, band width = dollars or share, a real alternative to the network web.
- **Geographic map:** where suppliers and revenue sit, with region risk shading.
- **Concentration charts:** top-customer share over time from XBRL, purchase obligations trend.
- **Cleaner network:** cluster by link type, edge thickness by dollars, edge style by confidence, focus mode that dims everything except the chosen path.

## 4. Market insight layer
- **Lead/lag signals:** does a supplier's earnings move or guidance predict the customer's next print? Point-in-time, with historical hit rate.
- **Ecosystem baskets:** "NVDA ecosystem" index of linked names, its performance and correlation vs the focus stock.
- **Scenario shock v2:** shock a region (e.g. Taiwan), an input, or a company; impact sized by dollars where known, and listed with sources.

## 5. Assistant integration
- New tools so the research panel can answer "who is most exposed to TSMC?", "what changed in Apple's suppliers this year?", with cited quotes.

## Suggested order
1. Data (sources, confidence, XBRL concentration, entity cleanup) — without this the rest looks thin.
2. Link cards + dependency score + AI analyst note.
3. Sankey + geographic map.
4. Lead/lag signals and shock v2.
5. Assistant tools.

## Technical notes
- New columns on `supply_links`: `confidence`, `source_type`, `product`, `link_type`, `first_seen`; new table `supply_evidence` (many quotes per link) and `supply_entities` (canonical counterparties).
- Ingest extends `scripts/supply-chain.ts` to read transcripts (existing `src/lib/transcripts`), 8-K EX-10s and counterparties' filings; quotes still must match verbatim (`src/lib/supply/core.ts`).
- XBRL concentration facts come from existing companyfacts ingest.
- Dependency score, lead/lag and region shock stay pure in `src/lib/supply/core.ts` with tests; lead/lag precomputed in `scripts/markets.ts` style.
- AI notes via Lovable AI Gateway behind auth, cached in `ai_cache`.
- Uses OpenAI/Claude credits for the re-read (estimate given before running).
