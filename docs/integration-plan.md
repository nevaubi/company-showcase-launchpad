# Integration plan: one corpus, joined, with every item opening its source

Written 27 Nov 2026 from the measurements in `docs/data-estate.md`. This is the order of work. One
item is worked at a time, finished and checked, before the next starts. `roadmap.md` holds the live
list; this file holds the reasons and the designs.

What does not change: every number links to its source; nothing is invented or corrected silently;
a model may write a sentence only over cited evidence and every sentence is re-checked; all 1,844
companies are treated alike.

## 1. What is wrong today, in four lines

1. **Too many lanes, no order.** Five worker programs and 21 schedules run at once, and 16 redeploys in
   27 hours restarted all of them each time.
2. **The same subject is stored several times** (section 7 of the estate), and different pages read
   different copies.
3. **Coverage is uneven and invisible.** Calls reach 609 companies, IR figures 813, supply links 1,109,
   supply intelligence 47, promises 25. No page says which company lacks what.
4. **Each feature reads its own corpus.** Only the assistant can reach everything; the pages do not join
   a quarter's filing, release, IR tables, call and price reaction.

## 2. Operating rules

- **One system of record per subject** (section 3). Every other copy is a fallback, a cross-check, or
  is retired. A page reads the system of record.
- **One order on the worker.** Daily feeds first, then deterministic builds, then model-paid builds.
  A lane with nothing to do sleeps for an hour, it does not poll every minute.
- **Every lane can be stopped by the owner** from one page, and says so everywhere (`lane-hold.ts`).
  Done for the vendor collector; the other lanes follow in phase 0.
- **The worker is redeployed only when worker code changed**, and a redeploy costs nothing: every lane
  resumes where it stopped.
- **Coverage is a number on a page**, per company and per corpus, before and after every build.
- **Nothing new starts while a blocker in section 8 is open** for the lane it needs.

## 3. System of record per subject

| Subject | System of record | Role of the other copies |
|---|---|---|
| Statements | SEC filings, built by the partner pipeline's run of this repo's ingest (`datasets/companies`) | Vendor statements: private cross-check that finds empty or wrong headline lines. Never shown. |
| Filing text and detail | SEC EDGAR, cached (`sec-filings`, `datasets/detail`) | none |
| Operating KPIs | Our IR figures (`ir_kpi_facts`), each with a cell or line locator | Partner KPI files: shown only where we have no figures yet, labelled. Vendor KPIs: private cross-check. |
| IR documents | `ir_documents` with the stored original | Partner store copy: already imported as rows; kept as the fallback file. |
| Call transcripts | Our call archive (speaker turns with source hash and source address) | IR-store transcript files: the next source to read. Vendor transcripts: a list of calls that exist, used to direct our own search; shown only if the owner confirms the right to. |
| Filing changes | Our redlines (`filing_redlines`) | Partner redline index and filing insights: retired once ours cover every company. |
| Estimates | `analyst_estimates` | Partner estimate files: the index pages read them; fold into one reader. Vendor ratings: unused. |
| Prices | Official daily bars (`market_bars`) over the partner price file | as today |
| Supply chain | `supply_links` with the verbatim filing sentence | `xbrl_concentration` joins as tagged shares, as today |
| Alt data | `alt_data` | Partner per-company alt files: retire page by page |
| Official records | `source_records` snapshots | none |
| Securitized credit | `abs_*` | none |

## 4. The pieces to build (schema)

All additive. All derived from what is already stored, so each can be rebuilt from scratch and none
replaces an archive. Read access through `has_app_access`; writes by the service role only; grants in
the same migration.

### 4.1 Coverage ledger

`corpus_coverage (ticker, corpus, state, items, newest, detail jsonb, checked_at)`, key `(ticker, corpus)`.
`state` is one of `full`, `partial`, `none`, `not_applicable`, `held`.

- Filled once a day by one SQL function from the tables and file lists that already exist. No model,
  no outside call.
- What "full" means for each corpus is one pure module (`src/lib/coverage/corpora.ts`) with a test per
  rule: for calls, the last eight quarters each have a call or the company has a recorded reason; for
  IR figures, the newest reported quarter has a statement table; for supply links, the newest 10-K was
  read. `not_applicable` comes from the same module (bank KPIs only for banks).
- Statement lines are a corpus too: a company is `partial` when a headline line that applies to it is
  empty (market cap is empty for 230 companies today, net margin for 410). The list of those companies
  is the statement builder's defect queue.
- Used by: the admin Data status page (a matrix, and one company's row); every company tab's empty
  state ("No call stored yet" is different from "This company holds no calls"); the assistant
  (`get_data_coverage`), so it never reports a gap as an absence.

### 4.2 Calls as tables

Today the call archive is key-value rows in `ai_cache` (5,131 calls, 118 MB). It stays the archive.
Two derived tables make it searchable and joinable:

- `call_documents (call_id, ticker, call_date, fiscal_label, kind, source_kind, source_url,
  source_sha256, title, words, has_qa)`
- `call_passages (call_id, seq, ticker, call_date, section, speaker, role, firm, text, tsv)`, key
  `(call_id, seq)`, full-text index on `tsv`, index on `(ticker, call_date)`.

One passage is one speaker turn. `(call_id, seq)` is the address a page opens.

### 4.3 The period spine

`company_periods (ticker, period_end, months, fiscal_year, fiscal_quarter, report_accn, report_form,
report_filed, release_accn, release_filed, call_id, call_date)`, key `(ticker, period_end, months)`.

Built by the rules the Earnings tab already uses (`src/lib/earnings/quarters.ts`: the release is the
last Item 2.02 8-K between the quarter end and its 10-Q or 10-K, otherwise unmatched, never guessed).
The call is the one whose fiscal label matches and whose date is within ten days after the release;
otherwise empty.

Everything dated joins on it: IR figures by period end, redline pairs by accession, estimates as of the
release date, the price reaction, insider trades and unusual alt-data changes in the window.

### 4.4 Mentions

`call_mentions (call_id, seq, ticker, kind, key, quote, char_start, char_end)`.

- `kind = counterparty`: the turn names a company that is a counterparty in `supply_links` for this
  company, or a covered company. Matched by whole name with the existing matcher
  (`src/lib/xbrl/counterparty.ts`), never by substring, never by a model.
- `kind = segment`: the turn names one of the company's own reported segments (labels from its filing).
- `kind = region`: a country from the place table (`src/lib/supply/place-kind.ts`).
- `quote` is the sentence, verbatim, with its character range in the turn. A test fails on any stored
  quote that is not found at its range.

### 4.5 What is not built

No generic "evidence" table that holds anything. Each table above has one meaning and one builder.

## 5. One way to open a source

Today the source panel opens: an SEC fact, a filing passage, an IR table cell, an IR page line, an
outside address. It gains three kinds, and the listed gaps close.

| New kind | Opens | Used by |
|---|---|---|
| Call turn `(call_id, seq, quote)` | the stored transcript in the panel, at the turn, quote marked | promises, supply intelligence, mentions, quarter drivers, reports |
| Official record `(dataset, snapshot, row)` | the row with its field names, units and publisher address | bank pages, alt data, assistant answers |
| Price bar `(symbol, date)` | the stored official bar and where it came from | technical signals, reactions, reports |

Gaps to close, each found in the code on 27 Nov:

- Quarter drivers: contribution amounts and the change have no source button.
- Promise and outcome quotes open an outside page, not the stored transcript.
- Report references to market data and firm records have no target.
- Technical and valuation trade ideas carry an empty evidence list.
- Company brief facts point at a tab, not at a document.
- IR store documents without extracted text open only as the outside original.

## 6. What each page gains

| Page | Gains | From | Rule |
|---|---|---|---|
| Company → Earnings | A quarter file: the 10-Q or 10-K, the release and its exhibits, the IR supplement, the call, the estimate before, the reaction after, in one row per quarter | period spine | every cell opens its source; an unmatched cell is empty |
| Company → Calls | Calls for the 145 companies whose transcript files we already hold; search inside and across calls; "also said about" links to segments, counterparties, regions | call tables, mentions | speaker turns only from a file whose company and event are checked, as today |
| Company → Overview, Quarter drivers | Under each driver, what management said about that segment in the same quarter's call and release | mentions, period spine | verbatim sentences with speaker; no model |
| Company → IR | A coverage line: which quarters hold a statement table, which wait | coverage ledger | figures the filing contradicts stay held, as today |
| Supply chain | On every link: sentences from both companies' calls that name the other; a "confirmed by both sides" mark that counts calls as well as filings; the 735 companies with no links are read | mentions, `supply_links` | a link is still created only from a filing sentence; a call sentence supports, it does not create |
| Signals → Setups, Trade ideas | An evidence drawer on every row: the bars that fired the rule, the next and last earnings date, insider buys in 90 days, high-severity filing changes, unusual alt-data changes | period spine, existing tables | context is listed, never scored, until a rule passes the same test as every setup |
| Signals → Insights | Filing insights for every company with a redline (1,742, not 79), ranked by the existing rule-based score. Written summaries exist for 20 of 1,993 redlines today | `filing_redlines` | a written summary only where each bullet's quote is in a cited change, as today |
| Signals → What changed, Situations, KPI insights; Technicals; Screener | A stored copy of each partner file in this Cloud, so a partner outage does not empty the page | partner mirror | the copy is served only when the partner fails, and the page says how old it is |
| Reports | IR figures and call sentences as citable facts | fact pack | the sentence check covers them like SEC facts |
| Alt data → Securitized credit, Library | An assistant tool for securitized credit; official records open in the panel | existing | no company attribution without its own evidence |
| Assistant | `get_data_coverage`, `get_period_file`, `search_calls`, `get_abs_deal` | new tables | an answer names what it could not reach |
| Admin → Live worker | Every lane: running, waiting, held; what it did last; Stop and Resume | `lane-hold.ts` | only lanes that check for a hold show the buttons |
| Admin → Data status | The coverage matrix and the list of companies missing each corpus | coverage ledger | counts come from the database, not from a job's own report |

## 7. Background work

### 7.1 Lanes and their order

| Order | Lane | When | Costs |
|---:|---|---|---|
| 1 | Daily feeds: prices, SEC filings, Form 4, estimates, macro, alt data, short volume, options | on their schedules | none |
| 2 | Filing steps: redlines, supply links for a new 10-K or 10-Q | within 30 minutes of a filing | model, small |
| 3 | Coverage ledger, period spine, call tables, mentions | daily, after the feeds | none |
| 4 | Call archive: read the transcript files we hold, then search the issuer's own site for the calls we know exist | continuous, bounded | page reader credits |
| 5 | IR deep builds, in order of market value, newest quarter first | continuous while credit lasts | model, large |
| 6 | Supply links for the 735 companies without any | after 5 has credit to spare | model |
| 7 | Official-source refresh, securitized credit, setup replay | only when a source published something new | none |
| 8 | Vendor collector | held | credits |

### 7.2 New steps

Each is deterministic, keeps its place in `job_state`, moves it only after rows are stored, and can be
re-run from zero.

- `coverage`: once a day, one function call.
- `call-tables`: turns in the archive not yet in `call_passages`, 200 calls a run.
- `periods`: companies whose filings, releases or calls changed since the last run.
- `mentions`: calls not yet scanned, or scanned before the company's counterparty list changed.
- `call-fill`: the 145 companies with a transcript file in the IR store and no call; parsed into turns
  by the existing parser and admitted only when the company and event checks pass.

### 7.3 Repairs before anything is added

- Worker: resume every lane from its stored place; record each deploy; deploy only when files the
  worker runs changed.
- Vendor collector (before it is ever resumed): keep its place across restarts; check a file exists by
  listing, not by downloading it; record an answer that can never come and do not ask again; find out
  why the clean-up step dies.
- Securitized-credit lane: 1,301 runs a day with nothing to do; look once an hour when idle.
- Supply intelligence: restart-safe, one company at a time, place kept.
- Analytics publish and the prose reader: split so one run fits its time limit and the next continues.
- IR rebuild: BAC and C exceed the payload limit; split by statement.
- Options: Cboe refuses the collector; decide pace or source.
- EIA table T01.10 parser; FRED transport.

## 8. Open blockers

| Blocker | Blocks | Who |
|---|---|---|
| AI gateway and OpenAI paid key out of credit | IR deep builds, label canon, supply links, supply intelligence, promises, written summaries | owner |
| Whether vendor content may be shown | using vendor transcripts or figures on a page | owner |
| Cboe refusing the options collector | options context since 19 Nov | decision: pace or source |
| Redeploy churn | every long-running lane | rule above, then code |

Everything in phases 0 to 2 below needs none of these.

## 9. Vendor archive: what it is for

In this order. The first two show nothing from a vendor on any page.

1. **A list of what exists.** 951 companies have calls only in the vendor archive. Their dates tell our
   own collector which calls to look for on the issuer's site and in the IR store.
2. **A private cross-check.** Vendor as-reported statements against our SEC-built statements: every
   headline line that is empty with us and filled with them, or differs, goes on a defect list for the
   statement builder. Vendor segments and KPIs against our IR figures in the same way. The result is an
   admin report; our figures change only by fixing our own reader against the filing.
3. **Shown with attribution**, only if the owner confirms the agreement allows it. Not assumed.

## 10. Order of work

Each phase ends with a check that can fail.

**Phase 0. Control.**
- Done 27 Nov: vendor collector stopped and shown as stopped by the owner, not as a fault.
- Lane board on Admin → Live worker; every lane checks for a hold; idle lanes sleep.
- Worker resumes in place; deploys recorded.
- Check: a held lane writes no row for an hour; a redeploy loses no place.

**Phase 1. See coverage.** Coverage ledger, Data status matrix, honest empty states, assistant tool.
- Check: the ledger's counts equal the counts in `docs/data-estate.md` section 2 on the day it is built.

**Phase 2. Calls and periods.** Call tables, period spine, call turn in the source panel, call-fill for
145 companies, call search.
- Check: every passage's text equals its turn in the archive; every period's release obeys the release
  rule; promise quotes open the stored turn.

**Phase 3. Joined pages.** Quarter file on Earnings; mentions; supply-chain call support; quarter-driver
passages; evidence drawer on setups and ideas; filing insights for all companies.
- Check: every shown sentence is found verbatim at its address; no figure without a source button on
  the pages touched.

**Phase 4. Close the source gaps** in section 5 that phase 3 did not touch; official record and price
bar in the panel.

**Phase 5. Vendor cross-check** (private), then the repaired collector if the owner wants phases B and C.

**Phase 6. One copy per subject.** Mirror the partner-only products (section 3 of the estate) so no page
depends on the partner being up. Where we hold our own data for a subject (filing changes, estimates,
alt data), move the pages that still read the partner copy to ours, one page at a time, until section 3
is true.
- Check: with the partner service switched off in a test, every page still shows data and its age.
