# Data estate: what is stored, who reads it, what is missing

Measured on 27 Nov 2026 (12:15 to 12:30 UTC) by counting the database and the file storage directly.
Nothing here is an estimate unless it says so. The universe is 1,844 covered companies.

The order of work that follows from this is in `docs/integration-plan.md`.

## 1. Size

| Where | What | Count | Size |
|---|---|---:|---:|
| Database | Official-source records (`source_records`) | 22,128,095 rows in 1,200 published snapshots of 1,059 tables | 21 GB |
| Database | IR figures (`ir_kpi_facts`) | 12,128,887, every one with a cell or line locator | 6.0 GB |
| Database | Alt data (`alt_data`) | 835,710 rows in 17 datasets | 0.5 GB |
| Database | Short volume | 3.3 million rows | 0.3 GB |
| Database | Setup replay samples | 851,730 | 0.1 GB |
| Files | Partner IR store copy (`ir-documents/partner/`) | 403,411 files | 108.5 GB |
| Files | Our own IR documents (`ir-documents/<TICKER>/`) | 88,311 files, 748 companies | 37.0 GB |
| Files | Vendor archive (`datasets/vendor/`) | 39,834 files | 16.4 GB |
| Files | Official-source originals (`datasets/official/`) | 1,357 parts | 5.5 GB |
| Files | IR renditions, series, table fills | 27,999 files | 3.9 GB |
| Files | Company, price, filing-detail, IR index, table files | 29,147 files | 2.6 GB |

About 175 GB of files and 31 GB of database.

## 2. Coverage by company

How many of the 1,844 companies each corpus reaches. "Missing" is the count with nothing at all.

| Corpus | Companies with data | Missing | Notes |
|---|---:|---:|---|
| Statements and prices (partner build, `datasets/companies`, `prices`) | 1,844 | 0 | rebuilt twice a week by the partner pipeline |
| Filing detail, dimensional XBRL (`datasets/detail`) | 1,844 | 0 | |
| Reports | 1,844 | 0 | 2,147 stored |
| SEC filing index (`sec_filings`) | 1,842 | 2 | 25,505 filings, only since 21 Sep 2026 |
| Earnings releases (`earnings_events`) | 1,841 | 3 | 127,032 since 2004 |
| Analyst estimates | 1,820 | 24 | refreshed daily |
| Options context (`options_daily`) | 1,815 | 29 | **last stored day 19 Nov: Cboe blocks the collector** |
| IR documents (`ir_documents`) | 1,844 | 0 | 271,870 documents; 78,326 have no date; 61,952 are images |
| Filing redlines (`filing_redlines`) | 1,742 | 102 | 1,993 pairs |
| Insider trades, Form 4 (`insider_trades`) | 1,473 | 371 | 23,383 rows since Oct 2022 |
| Supply-chain links, current (`supply_links`) | 1,109 | **735** | 16,641 current links, 42,313 with history |
| Tagged customer and supplier shares (`xbrl_concentration`) | 980 | 864 | 10,592 rows |
| IR figures (`ir_kpi_facts`) | 813 | **1,031** | 141 of the 813 hold fewer than 200 figures |
| IR series for the page (`ir_company_series`) | 796 | **1,048** | deep builds finished for 621 companies in ten days |
| Call transcripts, speaker turns (app archive) | 609 | **1,235** | 5,131 calls, Jul 2021 to Sep 2026 |
| Supply-chain intelligence (`supply_signals`) | 47 | **1,797** | weekly job stuck since 20 Nov |
| Promise tracking | 25 | **1,819** | built only when someone opens the page |

Transcripts in detail. Of the 1,235 companies with no call in the app:
- 145 have a transcript file already in our own IR store (not yet turned into speaker turns).
- 951 have transcripts only in the vendor archive.
- 139 have none anywhere.

## 2a. Empty headline values

From the screener file the pages read (1,844 rows, 252 columns, built 27 Nov 05:27 UTC). The count is
companies where the value is empty. Some are empty by design (a bank has no gross margin and no
enterprise value); the rest are defects to find, company by company.

| Value | Empty for | Value | Empty for |
|---|---:|---|---:|
| Latest quarter | 3 | Net margin | 410 |
| Market cap | 230 | Operating margin | 683 |
| Price to earnings | 479 | Gross margin | 881 |
| Price to sales | 538 | Return on equity | 259 |
| Enterprise value | 805 | Return on assets | 173 |
| Revenue growth, latest quarter | 282 | Net debt | 504 |
| Revenue growth, trailing year | 433 | Current ratio | 381 |
| EPS growth, latest quarter | 539 | Free cash flow growth, latest quarter | 631 |
| Segment count | 1,484 | Geography count | 1,533 |
| Reported KPI count | 711 | Insider net buying, 90 days | 1,344 |

A market cap is price times the share count on the cover page of the latest report, so 230 empty market
caps are 230 companies whose cover-page share count was not read. That is the first defect list to work.

## 2b. Does every stored item carry its source?

Counted in the database:

| Corpus | Items | Without a source |
|---|---:|---:|
| IR figures: cell or line locator | 12,128,887 | 0 |
| Alt data: source address | 835,710 | 0 |
| Supply links, current: verbatim sentence and filing document | 16,641 | 0 |
| Supply intelligence: quote and source | 3,733 | 0 |
| Insider trades: Form 4 document | 23,383 | 0 |
| Earnings releases: accession | 127,032 | 0 |

So the stored rows are sourced. The gaps are on the pages (which figures have no button to open the
source), listed in the plan, section 5. One content gap: only 20 of 1,993 filing redlines have a written
summary.

## 3. Products served only by the partner pipeline

The app reads about 45 file families from the partner service (`filedunderai`). Only the universe, company
files, price files, IR indexes and document tables have a copy in this Cloud. Everything else below has
no local copy: when the partner service is down, these pages are empty.

| Product | Companies | Built |
|---|---:|---|
| Screener (243 fields), estimates index, redlines index, sectors | 1,844 | daily |
| Technical states | 1,842 | daily |
| Cross-company quant ranks | 1,662 | daily |
| Situations | 1,292 rows | daily |
| Earnings season | 1,213 reported, 107 upcoming | daily |
| What changed feed | 1,200 events | daily |
| KPI insights | 785 | daily |
| Clinical-trial catalysts | 785 rows | daily |
| **Filing insights** | **79** | **last built 8 Nov** |

Filing insights are the clear outlier: 79 companies, three weeks old, while our own redlines cover 1,742.

## 4. Vendor archive (stopped 27 Nov)

Collected between 19 and 24 Nov through the Firecrawl data gateway. Nothing new has been stored since
24 Nov. No page or research table reads it (`scripts/AGENTS.md`: "Archives never feed research tables or
pages"). No licence text granting display or redistribution rights was found in the repository.

| Provider | Content | Companies |
|---|---|---:|
| Fiscal.ai | Profile; income statement, balance sheet, cash flow (standardised and as reported); adjusted metrics; shares outstanding; ratios; institutional and insider holders; IR events | 1,740 to 1,744 each |
| Fiscal.ai | Earnings-call transcripts | 1,657 |
| Fiscal.ai | Segments and KPIs | 1,349 |
| EODHD | Fundamentals, dividends, splits | 1,745 to 1,748 |
| EODHD | Earnings calendar | 1,842 |
| Benzinga | Analyst ratings, consensus ratings | 1,740 to 1,742 |
| Data Legion | Company enrichment | 1,720 |

Spend and yield by day (credits charged, files stored), from the collector's own ledger:

| Day | Credits | Files stored |
|---|---:|---:|
| 19 Nov | 483,238 | 18,907 |
| 20 Nov | 278,979 | 10,704 |
| 21 Nov | 215,443 | 8,475 |
| 22 Nov | 11,250 | 0 |
| 23 to 27 Nov | 1,552 in total | 91 in total |

About 990,000 credits in all, 98.7% of them in the first three days. The collection was in effect
complete on 21 Nov. From 22 Nov the collector did the following, over and over:

- It walked all 1,844 companies again (phase A started 52 times, finished 23 times, was cut off by a
  restart 18 times). To check whether a file exists it downloads the whole file: about 16 GB of reading
  per full pass.
- After every finished pass it began its clean-up step and never completed it: there is no
  "withdrawals-cleaned" entry in the ledger, ever, and a new copy started about ten minutes after each
  finished pass. Why the step dies is not established yet. Because of it, phases B and C (the
  non-company archives: Fed, World Bank, EIA, CFTC, FDIC, lobbying, courts, patents) never started and
  hold no files.
- 227 companies' "segments and KPIs" requests are answered by the provider with "already completed, the
  response is no longer kept", and we do not have those answers stored. The collector asked again three
  times per pass: with the "no data for this company" answers, about 10,000 calls in three days that
  could not succeed (no credits charged).
- The worker was redeployed 16 times in 27 hours (26 to 27 Nov); each redeploy restarts every lane and
  sends the collector back to company 1.

## 5. Asset-backed securities and official sources (both already on a page)

- **ABS-EE** is shown at Alt data → Securitized credit. 824 filings stored: 499 auto loan (111 deals),
  225 commercial mortgage (39 deals), 100 auto lease (24 deals). Another 10,277 filings are listed and
  not read: every one was filed before July 2026, which is before the watch range starts. The assistant has no tool for it.
- **Official sources** are shown in the Alt data library: 1,059 tables, 1,200 published snapshots,
  3 held back. Banks link from their company page to their FDIC records. No other sector has a reviewed
  company-to-record link yet.

## 6. Background work

21 scheduled calls and five worker programs (IR deep builds with 20 side steps, official sources with
four lanes, bank sector, call transcripts with three lanes, vendor collector).

Not working on 27 Nov:

| What | State | Needs |
|---|---|---|
| AI gateway | out of credit since 26 Nov 03:00 UTC | **owner: add credit** |
| OpenAI paid key | credit ran out 26 Nov; free daily allowance spent by 07:00 UTC | **owner: add credit** |
| Options (Cboe) | refused with 403 since 19 to 24 Nov; data 8 days old | a slower pace or another source |
| IR label canon | no successful run on record; needs the paid model | credit |
| Supply intelligence | "retry 6: interrupted" since 20 Nov | restart-safe run |
| Analytics publish | timed out at 30 min, 9 runs of 10 | split the step |
| IR prose reader | timed out at 2 h, twice | resume inside the step |
| IR rebuild | BAC and C payloads over the size limit | split the payload |
| EIA table T01.10 | "undefined is not a function" | parser fix |
| FRED refresh | download deadline | transport |
| Worker restarts | 16 deploys in 27 h (26 Nov 08:34 to 27 Nov 11:24 UTC), each restarting every lane | deploy only when worker code changed |

Working: prices, SEC filings and discovery, macro, estimates, alt data, IR document collection, filing
cache, partner mirror, short volume, call archive, official-source refresh, setup replay (1,775 of 1,844
done; 62 too short a history, 5 delisted, 2 with a broken source bar: HUBB and WLY on 5 May 2021).

## 7. The same thing stored more than once

| Subject | Copies | Shown today |
|---|---|---|
| Statements | partner build from SEC; vendor standardised and as-reported | partner build |
| Operating KPIs | our IR figures (813 companies); partner KPI files; vendor segments and KPIs (1,349) | IR figures on the IR tab, partner files on KPI pages |
| Call transcripts | app archive (609); IR-store transcript files (681); partner call analysis; vendor (1,657) | app archive on Calls, partner analysis in the assistant |
| Filing changes | our redlines (1,742); partner redlines index (1,844); partner filing insights (79) | all three, on different pages |
| Estimates | our table (1,818); partner estimates (1,844); vendor ratings | our table and partner file, on different pages |
| Alt data | our table; partner per-company files | both |
| Technicals | partner bars and states; our setup series and bars | both |

## 8. Corrections to the stock-take given earlier on 27 Nov

- ABS-EE does have a page (Alt data → Securitized credit). The earlier note said it had none.
- The vendor collector was not "re-checking cached files" as a healthy idle loop. It finished its real
  work on 21 Nov and then repeated its first phase for six days, because its clean-up step never
  completes and because redeploys kept cutting it off (section 4).
