# Merge this site's features into the Vercel version (filedunderai)

## Constraint
The other site runs on Vercel, outside this workspace, so I can't open or edit its code from here. You have two ways to get it to me:
- **A (recommended):** push the Vercel repo to GitHub and import it as a new Lovable project in this workspace. I then copy features into it.
- **B:** upload a ZIP of its source here. I compare the two and hand you a package of ported files to drop in.

Either way the ~1,000-ticker data stays in its own database, and nothing gets re-imported.

## Steps
1. **Audit both sites.** Map how the other site stores statements, IR facts and source links, plus its routes, auth and database. List every place it differs from this site.
2. **Shared foundation.** Port the pure modules first (no UI): supply-chain core and analytics, estimates core, alerts core, earnings promises, signals core, research loop and sandbox, hedge core. Adapt the data readers to the other site's schema instead of `public/data` snapshots.
3. **Database.** Add migrations there for `supply_links`, `supply_signals`, `alt_data`, `analyst_estimates`, `alert_state`, `paper_trades`, `ai_cache` and `job_state`, with the same RLS and grants.
4. **Features, in order:**
   - Company page layout (header, research price chart, About/management, collapsible panels, Geist fonts)
   - Research assistant panel (⌘J) with tools pointed at their data
   - Supply chain map and intel
   - Estimates & analysts, alerts bell, earnings & promises
   - Trade ideas (signals) and sector pages
   - Alt data hub and hedge funds / Treasury auctions
5. **Pipelines.** Rerun the supply-chain, supply-intel, alt-data, estimates, signals and hedge scripts for all ~1,000 tickers, in small batches with spend caps.
6. **Verify.** Run the tests, then smoke-test signed in on a few companies (NVDA, AAPL, plus a newly covered small company).

## Notes
- The 1,000-ticker supply-chain and estimates runs cost AI credits, about 13x the 78-company runs.
- Once the merge is verified, this site can be retired.
