# Finish the platform cleanup

## 1. Seven company tabs
The company page now has 12 tabs in three groups. They become 7 top tabs. Pages inside a tab become sections or sub-tabs, and old addresses redirect to the new spot.

```text
Overview | Financials | Valuation | IR data | Earnings | Filings | Ownership
```
- Financials: statements
- Valuation: valuation + Estimates & analysts
- IR data: the financial map + KPI tables
- Earnings: results & promises + Earnings calls
- Filings: filings & IR documents + Filing changes (redlines) + Reports
- Ownership: Insiders & influence + Alt data

## 2. Consistent headers, panels and tables
- One page header on every page: eyebrow, title, one line of context, actions on the right. It wraps cleanly on narrow screens.
- One panel style (border, padding, title row) and one table style (row height, number alignment, sticky header, sideways scroll inside the panel only). Applied to every signed-in page, starting with the busiest ones: dashboard, signals, companies, markets, supply chain, alt data, library, firm.
- Remove duplicate sub-headers and empty "coming soon" blocks wherever they appear.

## 3. Phone check
Check every hub and company tab at phone width (390px) and tablet width (950px) in the demo account. Fix any sideways overflow, clipped headers or cramped tabs; the tab rows scroll sideways instead of wrapping.

## 4. Daily and nightly refreshes
Prices, SEC, macro, filing cache, IR documents and estimates stay as they are. New:
- Daily: alt data (contracts, SEC form signals) for a rotating slice of companies, and supply-chain signals for companies with a new filing.
- Nightly: trade ideas and market stats (earnings reactions, patterns, correlations). These are rebuilt from stored prices into the database, and the pages read the latest saved copy, falling back to the bundled file.
- Each job does a small slice per run and picks up where it left off, the same as the existing jobs. None of them start deep builds for the newly added companies (your earlier rule).

## 5. Admin "Data freshness" view
A new Admin tab lists each data source with its expected cadence, last successful run, rows updated and status: on time, late (more than 2x the cadence) or failing (last 3 runs errored). Late or failing sources show at the top with a badge on the Admin menu item. Only admins can see it.

## Open item
You still need an admin account. Sign up, or tell me your email, so I can give it admin access and you can see sections 4 and 5.

## Technical details
- Tabs: update `TABS`/groups in `app.companies.$ticker.tsx`; merged pages render existing components as sections; old child routes `beforeLoad` redirect.
- Shared `PageHeader`, `Panel` and `DataTable` styles in `src/components/app/`; grids keep `grid-cols-1` + `min-w-0`.
- New job names in `jobs.server.ts` + allowlist in `api/public/jobs/$job.ts`, managed schedules via the schedule tools, each bounded by `RUN_BUDGET_MS` with `job_state` cursors. Signals and markets output stored in a cache table (service-role write, authenticated read); pure logic stays in `src/lib/signals/core.ts` and `src/lib/markets/core.ts`.
- Freshness rules live in a pure, tested module (`src/lib/jobs/freshness.ts`) that reads `job_runs` (admin-only RLS already in place).
