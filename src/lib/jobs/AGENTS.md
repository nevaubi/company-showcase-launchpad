# Scheduled refresh jobs
- Empty Form 4 receipts use `job_state` keys `form4-seen:<accession>` rather than fake trade rows, so successful derivative-only reads cannot starve the parsing queue or pollute financial data.
- Refresh jobs never prune `job_runs`, because vendor lifetime spending ceilings depend on the full ledger.
- Estimates use `estimates-new` for missing-coverage rotation and `estimates-backoff` for a persistent source cooldown, so scheduled failures do not hammer the provider or skip an unattempted ticker.
- FINRA refresh uses stored SPY session dates and advances its date receipt only after a whole-session upsert, so holidays never block catch-up and interrupted writes remain retryable.