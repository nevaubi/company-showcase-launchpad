# Filed Under: roadmap

One item at a time, top to bottom. Reasons and designs: `docs/integration-plan.md`. What is stored and
what is missing, measured: `docs/data-estate.md`. History to 27 Nov 2026: `docs/roadmap-archive-2026-11.md`.

## Waiting on the owner

- [ ] AI credit: the AI gateway (out since 26 Nov) and the OpenAI paid key are empty. IR deep builds, label canon, supply links, supply intelligence, promises and written summaries wait on it.
- [ ] Vendor content: may transcripts or figures from the vendor archive be shown on a page? Until answered they are used only as a list of what exists and as a private cross-check.
- [ ] Options: Cboe has refused the collector since 19 Nov. Slower pace, or another source?
- [ ] Email sender domain for waitlist receipt and approval emails.

## Phase 0. Control

- [x] Vendor collector stopped (27 Nov, owner). Held on its lease; the freshness page shows "Stopped by owner", the watchdog raises nothing for it. Resume: `bun scripts/lane-hold.ts release vendor-backfill`, only after the repairs below.
- [ ] Lane board on Admin → Live worker: every lane as running, waiting or held, what it did last, Stop and Resume. Each lane's loop checks `isOwnerHold` before taking work (IR deep loop and its steps, official ingestion, official refresh, securitized credit, setup replay, bank sector, the three call lanes); add each to `HOLDABLE_LANES` in the same change.
- [ ] Worker resumes in place after a restart: vendor walk keeps its company; securitized-credit lane keeps what it has looked at; a `worker-deploy` row records each deploy. Deploy only when files the worker runs changed.
- [ ] Idle lanes sleep: the securitized-credit lane starts 1,301 processes a day with nothing to do.
- [ ] Vendor collector repairs, before any resume: existence by listing instead of downloading (16 GB read per pass); an answer that can never come is recorded once and not asked again (227 companies' segments and KPIs); find why the clean-up step after phase A never finishes (no "withdrawals-cleaned" entry exists), which is why phases B and C never ran.

## Phase 1. See coverage

- [ ] Coverage ledger: `corpus_coverage` filled daily by one SQL function; rules for "full" in `src/lib/coverage/corpora.ts` with a test each. Includes empty headline statement lines (market cap empty for 230 companies, net margin for 410): that list is the statement builder's defect queue.
- [ ] Admin → Data status: corpus by company matrix, and the list of companies missing each corpus.
- [ ] Company tabs: empty states that tell "not stored yet" from "does not exist".
- [ ] Assistant tool `get_data_coverage`.

## Phase 2. Calls and periods

- [ ] `call_documents` and `call_passages` derived from the call archive (5,131 calls), full-text search.
- [ ] Call turn as a source the panel opens; promise and outcome quotes open the stored turn.
- [ ] Call fill: the 145 companies with a transcript file in the IR store and no call in the app.
- [ ] `company_periods`: report, release and call per quarter by the existing release rule.
- [ ] Search across calls on the Calls page and for the assistant (`search_calls`).

## Phase 3. Joined pages

- [ ] Earnings tab: one row per quarter with the report, release, IR supplement, call, estimate before and reaction after.
- [ ] `call_mentions` (counterparty, segment, region) by whole-name match, verbatim sentence with its range.
- [ ] Supply chain: call sentences from both sides on every link; read the 735 companies with no links (needs AI credit).
- [ ] Quarter drivers: what management said about each segment, same quarter, verbatim.
- [ ] Setups and trade ideas: evidence drawer (bars that fired, earnings dates, insider buys, filing changes, alt-data changes).
- [ ] Filing insights for every company with a redline (1,742 instead of 79), by the existing rule-based score.

## Phase 4. Every item opens its source

- [ ] Official record and price bar open in the source panel.
- [ ] Close the gaps listed in the plan, section 5 (quarter-driver amounts, report market references, trade-idea evidence, brief facts, IR store documents without text).

## Phase 5. Vendor archive, private use

- [ ] Vendor call dates as a search list for our own call collector (951 companies).
- [ ] Vendor as-reported statements against our SEC-built statements: defect list of empty or differing headline lines.
- [ ] Vendor segments and KPIs against our IR figures: conflicts and gaps in an admin report, never live figures.

## Phase 6. One copy per subject

- [ ] Mirror the partner-only products so no page depends on the partner being up.
- [ ] Move pages that read a partner copy of filing changes, estimates or alt data to our tables.

## Repairs (any time a lane is free)

- [ ] Supply intelligence stuck at "retry 6: interrupted" since 20 Nov (47 companies covered): one company at a time, place kept.
- [ ] Analytics publish times out at 30 minutes (9 of 10 runs); prose reader times out at 2 hours: split and continue.
- [ ] IR rebuild: BAC and C payloads over the size limit.
- [ ] EIA table T01.10: "undefined is not a function" on refresh; published snapshot (78 rows) untouched.
- [ ] FRED refresh: download deadline; baseline and pointer untouched.
- [ ] Setup replay holds: HUBB and WLY have a source bar on 5 May 2021 with the low above the open; 62 companies with too short a history; 5 delisted.
- [ ] IR documents: 78,326 without a date.

## Carried over, not scheduled

- IR reader: spoken KPIs in call transcripts; words as numbers; 12-week column dates; fragmented segment lines; label merging for deep-built companies.
- Product: cross-company KPI matrix and industry deep dives; interactive financial model and Excel model export; call tone; monitors and scheduled deliverables; live earnings call; insurer template; filing alerts by email.
- Alt data: patents, lobbying, EPA enforcement, court dockets (keys or matching needed).
- Options: test IV-rank rules through the setups gate once 60 trading days are recorded.
