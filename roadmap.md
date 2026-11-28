# Filed Under: roadmap

One item at a time, top to bottom. Reasons and designs: `docs/integration-plan.md`. What is stored and
what is missing, measured: `docs/data-estate.md`. History to 27 Nov 2026: `docs/roadmap-archive-2026-11.md`.

## Waiting on the owner

- [x] AI credit: refilled (owner, 27 Nov).
- [x] Vendor content: may be shown with the vendor named as the source (owner, 27 Nov). The collector stays stopped until its repairs are done and he asks.
- [x] Options: Yahoo Finance or Firecrawl, not Cboe (owner, 27 Nov).
- [ ] Email sender domain for waitlist receipt and approval emails.

## Now: investor-data pages, accurate and complete (owner, 27 to 28 Nov)

Every company page rebuilt from the documents already stored: no AI credit, nothing collected anew.

- [x] Save progress on request (owner, 28 Nov 01:35 UTC): everything committed; the push to the repository happens when the turn ends.
- [x] BAC and Citi pages fit the page limit again (12 and 40 quarters shown, the full archive kept for download).
- [x] Reader mistakes found on real releases and fixed, each with a test on the document: hidden cells shifting columns, another company's pro forma exhibit read as the company's own, cash flows read as balances, a nine-month statement listed as a second quarterly one, decimal money misread, the exchange-rate effect read as a rate.
- [x] Check marks: totals against their parts, results against their formula (gross profit, operating income, net income, total assets, change in cash against the three activity totals), older periods checked with the lines printed then; a failing check is shown only where the parts are proven.
- [x] Rows shown at the scale the company prints now; a row joined across releases that restate a comparative.
- [ ] Running: every existing page (797) rebuilt with the corrected rules, then first pages for the 957 companies that have stored releases and no page. `scripts/ir-rebuild-stale.ts --first`, eight at a time, BAC and C skipped. 399 done at 01:35 UTC, none failed.
- [ ] In hand, written and passing the reader tests, not yet tried on the trial companies: more release layouts. Fiscal calendar from the SEC statement file where the filing index has no 10-Q or 10-K (103 companies read nothing without it), numeric dates ("9/30/2026"), month-and-year heads, a year alone under a dated title, three-column balance sheets, titles broken over two lines or behind "Schedule 1", statements carried on in a second table. On 160 companies with no page: nothing read for 33 before, 18 after; figures read up 22%.
- [ ] Next layouts, by how often the survey met them: a scale stated after or inside the table (Revolution Medicines, GEO, Tradeweb, Stepan); fiscal-quarter heads ("Third Quarter 2026", "Q3 2026", "Second Quarter of Fiscal 2027": Kirby, GEO, Pinterest, California Resources); five-quarter trend heads (Radian); titles "Results of operations" and "Condensed cash flow" (Piper Sandler, Bio-Techne).
- [ ] Then raise the build format and rebuild every page once more, so all of them carry the layouts above.
- [ ] Audit of every rebuilt page (`scripts/ir-audit.ts`): companies with a failing check, a missing statement or thin history, worked through by how many companies share the cause.
- [ ] Known gaps from the trials: Progressive's month-ends (39 quarters against 44 before), UnitedHealth's image-only releases, NextEra's "Preliminary" captions, Procter & Gamble's titles, Home Depot's stray 1977 column, Microsoft's product revenue after the rebuild, thin sections at Costco and Tesla.
- [ ] Bank of America: 93 quarters are in the archive, 12 fit the page. Older periods loaded when the reader asks for them.
- [ ] Roll the saved-figure rewrite back on for the Render worker once the format is final (it is switched off there; this run happens in the workspace).

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
- [x] IR rebuild: BAC and C payloads over the size limit (bounded 27 Nov; older BAC periods on demand is listed under "Now").
- [ ] EIA table T01.10: "undefined is not a function" on refresh; published snapshot (78 rows) untouched.
- [ ] FRED refresh: download deadline; baseline and pointer untouched.
- [ ] Setup replay holds: HUBB and WLY have a source bar on 5 May 2021 with the low above the open; 62 companies with too short a history; 5 delisted.
- [ ] IR documents: 78,326 without a date.

## Carried over, not scheduled

- IR reader: spoken KPIs in call transcripts; words as numbers; 12-week column dates; fragmented segment lines; label merging for deep-built companies.
- Product: cross-company KPI matrix and industry deep dives; interactive financial model and Excel model export; call tone; monitors and scheduled deliverables; live earnings call; insurer template; filing alerts by email.
- Alt data: patents, lobbying, EPA enforcement, court dockets (keys or matching needed).
- Options: test IV-rank rules through the setups gate once 60 trading days are recorded.
