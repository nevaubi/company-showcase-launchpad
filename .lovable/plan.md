# While the partner copy limit resets

The remaining ~1,280 companies (~53 GB) can't be copied until the partner's daily limit resets. These steps don't need the partner service and can run now.

## 1. Start deep builds on the 564 companies already copied
- Largest companies first, one company at a time, then build figure series and the financial map.
- Readers: Gemini 3.1 Flash Lite with quality prompts, escalating hard pages to GPT-6 Luna (the same setup used for HOOD).
- Spending stops at the $200 cap. I'll report progress per company.

## 2. Finish the open HOOD and OSCR items
- OSCR: standardize figure names (the last run timed out) and fix the one figure that doesn't reconcile for two periods.
- HOOD: review the 18 scale flags, the 2 unlinked series and the future 2026-12-31 period. Check that quarters add up to years.

## 3. Prepare the copy restart
- Line up the 528 failed files at 9 companies to retry first.
- Add an automatic restart so the copy resumes once the limit resets, without waiting for you to message me.

## 4. Waiting on you
- Welcome and approval emails: these need you to set up the filedunder.ai email domain (one click).
- Live payments: these need you to claim the payment account in the Payments tab.

## Technical notes
- Deep builds read from the mirrored `ir-documents/partner/` copies, so they don't touch the partner limit.
- AI spend is tracked per run, and the job stops once the $200 total is reached.
- The automatic restart runs as a scheduled job that calls `partner-mirror-ir` in resumable mode and stops cleanly on a 429 response.
