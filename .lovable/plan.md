# Platform cleanup: fewer pages, admin area, waitlist, polished UI, fresher data

## 1. Navigation: 27 menu items down to about 10

Group the menu into 4 sections. Pages that are merged keep working: their old addresses forward to the new tab.

```text
HOME
  Dashboard        (Dashboard + Daily brief)
  Signals          tabs: What changed | Situations | Insights | Agents (alerts)
RESEARCH
  Companies        (company list + Screener + Compare + KPI matrix as tabs)
  Filings          tabs: Filings | Earnings | Calendars
  Markets          tabs: Technicals | Sectors | Macro | Hedge funds
  Supply chain
  Alt data
  Ideas            tabs: Trade ideas | Paper portfolio
WORKSPACE
  Research agent
  Library          tabs: Theses | Reports | Docs & sheets
  Firm
ADMIN (only you)
  Data status, job logs, waitlist
```

Company page: 13 tabs down to 7.
- Overview, Financials (+ Valuation), Earnings (+ Calls, Estimates), Filings (+ Redline), Investor relations, Ownership (Insiders + Alt data), Research (Memo + Reports).

## 2. Admin-only area
- Only your account gets the admin role. Data status, job run logs, pipeline coverage and the waitlist move under Admin.
- Everyone else no longer sees them in the menu and is sent away if they open the address. "Data status" links shown to regular users on error cards become a plain "data temporarily unavailable" note.
- Admin checks happen on the server, not just by hiding the menu.

## 3. Waiting list
- People who already have an account keep full access (marked approved on launch).
- New sign-ups land on a "You're on the list" screen and can't open the app until approved.
- Admin > Waitlist shows pending people (email, name, sign-up date) with Approve / Decline. Approved users get in on next load.
- Sign-in page: Google and email/password only; the Lovable button is removed (and that provider turned off).

## 4. UI polish
- Sidebar: same icon size and stroke, fixed icon column so labels line up, consistent spacing, clear active state, unique icons (two pages currently share the same radar icon), group headers, cleaner collapsed mode.
- Page headers: one shared layout (title, one-line description, actions on the right) on every page.
- Panels, tables, number formats, empty and loading states made consistent; reduce stacked panels and duplicate summaries on dense pages (Dashboard, Signals, company Overview).
- Check every page on desktop and phone with screenshots, fixing overflow and misalignment.

## 5. Data freshness ("unified and auto-refreshing")
Kept exactly as today (your earlier rule): prices (every 6 min in market hours), SEC filings and Form 4s (6 min), macro (10 min), filing cache (15 min), IR documents (5 min).

Added, limited to companies that already have that data (no new deep builds for the newly synced tickers):
- Analyst estimates: daily rotating refresh (today only refreshed when someone opens a page).
- Alt data and supply-chain signals: daily small rotating slice.
- Trade ideas, earnings reactions and correlations (currently rebuilt only by hand): rebuilt nightly after the market close.
- Stale-data watchdog: each dataset gets a "should be no older than" limit; the Admin page shows green/amber/red and the last error, so a silently stopped job is visible.

Every page shows a small "Updated X ago" from the same source of truth.

## Order of work
1. Admin role + waitlist + sign-in change (security first).
2. Menu and page consolidation with redirects.
3. Company tab consolidation.
4. UI polish pass with screenshots.
5. New scheduled refreshes + watchdog.

## Technical details
- `user_roles` table + `has_role()` security-definer function; seed admin for the owner's account (matched by verified email). `_authenticated/app.admin.*` routes gated by a server function using `requireSupabaseAuth` + `has_role`; job/status server functions get the same check.
- `profiles.access_status` ('approved'|'pending'|'declined') would allow self-escalation, so store it in a separate `waitlist` table (user_id, email, status, created_at) writable only via admin RPC; `handle_new_user` inserts 'pending'; migration backfills existing users as 'approved'. Gate in `app.tsx` layout plus RLS-independent server check for AI/expensive functions.
- Remove `oauth("lovable")` from `src/routes/auth.tsx`; disable the provider via configure_social_auth.
- Merged pages become tabs via `?tab=` search params; old routes become `redirect()` stubs.
- New jobs reuse `src/routes/api/public/jobs/$job.ts` with cursor slices, `RUN_BUDGET_MS`, `job_state` leases; created with create_http_schedule. Precompute steps (signals/markets) ported to run in-job against Cloud tables instead of `public/data` files; `getDataset` and ingest format unchanged.
- AGENTS.md rules added for admin gating, waitlist and freshness limits.
