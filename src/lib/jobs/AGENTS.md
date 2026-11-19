# Scheduled refresh jobs
- Empty Form 4 receipts use `job_state` keys `form4-seen:<accession>` rather than fake trade rows, so successful derivative-only reads cannot starve the parsing queue or pollute financial data.
- Refresh jobs never prune `job_runs`, because vendor lifetime spending ceilings depend on the full ledger.