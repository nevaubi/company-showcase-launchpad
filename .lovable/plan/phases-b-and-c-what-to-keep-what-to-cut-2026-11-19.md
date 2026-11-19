# Phases B and C: what to keep, what to cut

The company pass is the only thing running now. When it ends, the collector moves to phase B (market-wide economic data, run once) and then phase C (government and legal records, per company). Both follow the 12,000-credit hourly budget. Nothing changes until you approve this plan.

## Phase B, run once (estimate 10,000 to 30,000 credits, worst case about 90,000)

| Source | What it collects | Already in the app? | Recommendation |
|---|---|---|---|
| FRED | Economic series since 1996 | Yes, the app reads FRED itself | Cut |
| BLS | Jobs and price series | Partly through FRED | Cut |
| Treasury | Rates and debt data | Mostly through FRED | Cut |
| Fed | FOMC meeting list | No | Keep (one call) |
| World Bank | Six US and world indicators | No | Keep (small) |
| EIA | Energy prices and production, crawled route by route | No | Keep, cap at 300 calls |
| Census | US population by year | No, low value | Cut |
| CFTC | Futures positioning reports since 1996 | No | Keep |
| Nasdaq | Latest headlines | News, which you cut | Cut |

## Phase C, per company (estimate 90,000 to 185,000 credits)

| Source | What it collects | Already in the app? | Recommendation |
|---|---|---|---|
| Lobbying filings | Lobbying spend by company | No | Keep |
| Federal awards | Government contracts since 2007 | The alt-data job collects some | Keep only if you want history beyond it |
| Court dockets | Federal lawsuits naming the company | No | Keep |
| Legal entity records | Parent and subsidiary tree | No | Keep |
| Trademarks, patents | Owned marks and patents | No | Keep, first page only |
| Government documents | Laws and records naming the company | No, noisy matches | Cut |
| FDA, CMS (healthcare) | Approvals, orphan drugs, facilities | Partly in alt data | Keep |
| FDIC (banks) | Bank financials and deposits | SEC already has bank financials | Keep deposits and history only |
| NHTSA (carmakers) | Vehicle recalls | Yes, alt-data job collects recalls | Cut |

Phase C also gets a per-company ceiling of 150 credits, like the company pass has, so one company with many matches can't run away.

## Result if approved as recommended

- Phase B: about 5,000 to 15,000 credits, roughly an hour.
- Phase C: about 70,000 to 140,000 credits, roughly 6 to 12 hours at the hourly budget.

## Technical details

- Edit `scripts/vendor/phases.ts` only: remove the cut `collect` calls (fred, bls-gov, treasury, census-gov, nasdaq-com, govinfo-gov, nhtsa-gov, fdic institutions/financials), cap EIA route crawling at 300 calls, keep first page for trademarks/patents.
- Add a 150-credit per-company ceiling to `phaseC` using the existing company-pass ceiling helper.
- Extend the cut-capability test to fail if any cut capability appears in phase B or C.
- Keep `contracts.json` entries and all stored files; no UI, migrations, env changes, or publishing.
- Typecheck and vendor tests, one commit, then deploy to `filedunder-ir-worker` after you send "deploy", confirming the live commit from the deploy record.
