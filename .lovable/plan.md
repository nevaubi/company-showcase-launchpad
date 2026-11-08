# Next steps: finish the cleanup, then publish

The waiting list, admin area, new menu, seven company tabs and the Freshness page are all done. Three things are still open.

## 1. Make every page look the same
- Use one page header everywhere: the title, a one-line description, and actions on the right.
- Use one panel style: same borders, spacing and section titles.
- Use one table style: same row height, right-aligned numbers, sticky headers and the same empty and loading states.
- Go through every hub (Home, Companies, Markets, Signals, Research, Workspace, Admin) and fix the pages that don't match.
- Check each hub on a phone and on desktop. Nothing should scroll sideways or overlap.

## 2. Keep the remaining data fresh automatically
- **Alt data:** refresh a few companies every hour, rotating through the list, so every company updates about once a day.
- **Trade ideas and market stats** (earnings reactions, chart patterns, correlations): rebuild them nightly after the market closes. Each run picks up where the last one stopped.
- **Supply-chain signals:** rebuild them only when the partner rebuilds its data, twice a week, using the existing partner hook. No new long AI reads on a timer.
- Every new refresh appears on the Freshness page, which flags it if it falls behind.
- Still off limits: the extra backfill, and the deep builds for newly synced companies.

## 3. Check and publish
- Sign in as your admin account. Check the Admin, Freshness and waitlist approve/decline flows, and check that a new signup lands on the waiting list.
- Run the tests, then you publish.

## Technical details
- Shared `PageHeader`, `Panel` and `DataTable` primitives in `src/components/app/`, applied per route.
- New job tasks in `src/lib/jobs/jobs.server.ts` (`alt-data`, `signals`, `markets`) with `job_state` cursors and `RUN_BUDGET_MS`. Signals and markets results are stored in Cloud tables and merged over the `public/data` snapshots.
- The tasks are added to the `$job.ts` allowlist, get managed schedules, and get entries in `freshness.ts` with tests.
