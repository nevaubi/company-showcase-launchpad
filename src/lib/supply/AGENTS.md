# Supply-chain rules
- Supply-chain country/region/concentration/freshness/basket analytics are pure in `src/lib/supply/analytics.ts`; web cross-checks keep only sentences naming both companies.
- Region risk: pure in `src/lib/supply/region.ts`; external lookups via authed `supply-region.functions.ts`, cached, sourced.
- Globe placement is pure in `src/lib/supply/geo.ts` (head office, then a known head-office country, then the single country the filing names; otherwise not placed); network geometry is pure in `network-layout.ts`. The canvas engine under `components/supply/globe/` takes no app imports.
