# Production rollout: hardening, reliability, intelligence

## What the scan found (today)

- **Waitlist can be bypassed.** The waiting-list screen only blocks the app pages. Research tables (supply links, supply signals, alt data, estimates, filings, redlines, IR series) and the datasets file store allow *any signed-in user*, so a pending signup can still read everything directly. Insider trades are readable even signed out.
- **30 backend functions** with elevated rights are callable by signed-out or signed-in users; some should be admin- or server-only.
- 5 tables have access rules turned on but no rules (fine if server-only, needs confirming); one extension sits in the public area.
- Nightly trade ideas, market stats and supply-chain signals still only refresh by hand.

## Phase 1 — Launch blockers (security and access)

1. Change every research table and the datasets store so reads require `has_app_access` (approved, admin or demo), not just being signed in. Decide whether insider trades stay public (used on marketing pages?) or move behind access.
2. Review all 30 elevated functions: revoke signed-out access everywhere it isn't needed; restrict admin actions (waitlist decisions, job tools) to admins.
3. Add the same access check to every server function that returns research data or spends AI credits, so the waitlist holds even when calling the server directly.
4. Per-user daily limits on AI features (agent, reports, briefs) to cap cost at launch.
5. Rerun the security scan until no errors remain.

## Phase 2 — Reliability and operations

1. Move the heavy nightly rebuilds (trade ideas, market stats, supply-chain signals) into chunked jobs that process a few companies per run with a saved cursor, so they finish over the night within run limits.
2. Freshness page: email/alert the admin when any source goes stale or a job fails repeatedly.
3. Error tracking for the published site (runtime errors + failed server calls) shown in Admin.
4. Waitlist: confirmation email on signup and an "you're approved" email; test the full new-signup → approve flow end to end.
5. Basic product analytics in Admin: signups, active users, most-used pages and AI spend.

## Phase 3 — Intelligence and capability

1. **Confluence signals:** one ranked daily list per company combining insider buying, filing language changes, alt-data shifts, supply-chain events and estimate revisions, every item linked to its source.
2. **What changed since you last looked:** per-watchlist digest (in-app + optional weekly email).
3. **Bank KPI map** (built for BAC) rolled out to the other banks, then other sectors with dense IR KPIs.
4. **Agent upgrades:** saved research threads, scheduled agent questions ("rerun every Monday"), and export to memo/Excel.
5. **Docling indexing service (hosted on Render):** a small Docling server on Render converts filings, IR PDFs, decks and spreadsheets into clean structured text, tables and page positions. We store passages with their page/cell locators and search vectors, so the assistant pulls exact, well-structured passages (better context, fewer misread tables) and every quote still opens its source. It runs on stored documents in small nightly batches and is called only from the server with a secret key. Cost: a paid Render instance (CPU is fine to start; a GPU instance is faster on scanned decks). Your Render account and API key are needed.
6. Extend deep coverage beyond the 78 core companies — only when you decide which tickers, respecting your earlier rule not to start deep builds for the new tickers.

## Phase 4 — Launch polish

- Landing page: real, sourced example figures instead of illustrative ones; pricing/plan page if you plan to charge.
- Terms, privacy policy, data-source disclaimers ("not investment advice").
- SEO titles/descriptions on public pages, social share image.

## Questions for you

- Insider trades: keep visible to signed-out visitors, or members only?
- Paid plans at launch, or free with waitlist for now?
- Which of Phase 3 matters most to you first?
- Docling: do you already have a Render account, and should it index everything stored (~74K IR documents) or start with the 78 core companies?

## Technical details

- Replace `USING (true)` / `auth.uid() IS NOT NULL` read policies with `USING (public.has_app_access(auth.uid()))`; same for `storage.objects` on bucket `datasets`.
- `REVOKE EXECUTE ... FROM anon` (and `authenticated` where admin/server-only) on SECURITY DEFINER functions; keep `has_app_access`/`has_role` callable by authenticated.
- Shared `requireAppAccess` middleware after `requireSupabaseAuth` for research/AI server functions.
- Docling: `docling-serve` Docker image on a Render web service behind a shared-secret header (`DOCLING_URL`, `DOCLING_KEY` secrets); `scripts/docling-index.ts` + a rotating job read from the `ir-documents` bucket, write `doc_chunks` (text, page, bbox/`{t,r,c}`, embedding via pgvector) service-role-only; agent retrieval through an authed server function.
- Chunked rebuild jobs reuse `job_state` cursors and `RUN_BUDGET_MS`; signals/markets outputs move from `public/data` JSON to Cloud tables merged in `src/lib/data.ts`-style loaders (getDataset untouched).
