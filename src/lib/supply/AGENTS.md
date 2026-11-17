# Supply-chain rules
- Supply-chain country/region/concentration/freshness/basket analytics are pure in `src/lib/supply/analytics.ts`; web cross-checks keep only sentences naming both companies.
- Region risk: pure in `src/lib/supply/region.ts`; external lookups via authed `supply-region.functions.ts`, cached, sourced.
