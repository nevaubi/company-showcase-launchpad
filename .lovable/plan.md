# Production rollout: brainstorm and phased plan

Decisions so far: free trial + one paid tier (Pro), access tied to plan, guided tour on first login, security and waitlist hardening first.

## Phase 1 — Security and waitlist hardening (first)

1. Research tables and the datasets store readable only by approved, admin, demo or paying users, not just "signed in". Same rule on every server function that returns research data or spends AI credits.
2. Review the ~30 elevated backend functions: remove signed-out access where not needed; admin actions admin-only.
3. Insider trades and anything else readable signed-out: keep public only what marketing pages use.
4. Test the full flow end to end: new signup lands on waiting list, admin approves, user gets in; declined user stays out.
5. Waitlist emails: "you're on the list" and "you're approved".
6. Rerun the security scan until clean.

## Phase 2 — Roles and plans (governance)

- Roles: admin, plus plan-based access: **Trial** (e.g. 14 days, full product, lower limits), **Pro** (paid), **Expired** (read-only or locked screen with upgrade).
- One access check (`can use app` + `which plan`) used by pages, server functions and data rules, so hiding a link is never the only protection.
- Admin can: approve waitlist, extend trials, grant Pro manually (friends, partners), see each user's plan and usage.

## Phase 3 — Stripe payments

- Run the payment-provider check, then enable built-in Stripe (test mode first, no account needed to start).
- One Pro product, monthly + yearly prices; checkout, customer billing portal (cancel/update card), webhook that keeps each user's plan in sync.
- Trial starts on approval; ends into upgrade screen. Pricing page on the public site.
- Needed from you: price points and trial length.

## Phase 4 — Limits and logging

- Per-plan daily limits on costly AI: agent runs, reports, briefs, redlines, cloud browser runs. Clear "X of Y used today" in the app and a friendly limit message.
- Usage log per user (AI calls, cost estimate, feature) feeding an Admin "Usage and spend" page.
- Error tracking for the live site (page crashes and failed server calls) in Admin, plus alerts when data goes stale or jobs keep failing.
- Audit log of admin actions (approvals, plan grants).

## Phase 5 — Onboarding and walkthroughs

- Guided tour on first login: sidebar hubs, company page, click-to-source, the assistant (Cmd+J), watchlist. Skippable, restartable from Help.
- Empty-state hints on pages that start blank (watchlist, theses, paper trades).
- "Getting started" sample: preload a company (e.g. NVDA) and a sample question.

## Phase 6 — Marketing and launch

- Homepage figures replaced with real, sourced numbers.
- Pricing page, terms, privacy policy, "not investment advice" disclaimers.
- SEO titles/descriptions and share image on public pages; analytics on signups and conversions.
- Launch emails to waitlist in batches so load and AI spend ramp gradually.

## Later — Intelligence (from the earlier plan)

Confluence signals, "what changed since you last looked" digests, bank KPI map for other banks, saved/scheduled agent threads, Docling indexing on Render.

## Open questions

- Pro price (monthly/yearly) and trial length?
- After trial without paying: read-only or locked?
- Business country for Stripe tax handling?

## Technical details

- `has_app_access` extended to include active trial/Pro from a `subscriptions` table (written only by the Stripe webhook / admin RPC); RLS on research tables and `storage.objects` (datasets) uses it; shared `requireAppAccess` middleware after `requireSupabaseAuth`.
- `REVOKE EXECUTE ... FROM anon` on SECURITY DEFINER functions not needed publicly.
- `usage_events` (user, feature, units, cost) service-role write; limits checked server-side before AI calls; `admin_audit` table.
- Stripe via built-in payments: webhook route under `/api/public/stripe/webhook` with signature verification.
- Tour: lightweight step component with `data-tour` anchors, seen-state stored per user.
