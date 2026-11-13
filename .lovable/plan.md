# Resume the investor-relations file copy, then start deep builds

## Where things stand
- Company and price files: all 1,844 copied.
- Investor-relations files: 564 of 1,844 companies copied (46 GB, 183,833 files). 528 files at 9 companies failed.
- The copy stopped when the partner hit its daily download limit. Nothing is running right now.

## Steps
1. Restart the copy. Already-finished files are skipped, and the 528 failed files are tried again.
2. When the partner's daily limit comes back, pause and pick up again after it resets. That puts the remaining ~53 GB at about 1–2 more days.
3. Once every company is copied, start the deep builds for all companies, largest first, using Gemini 3.1 Flash Lite with GPT-6 Luna as the stronger second reader, stopping at the $200 spending limit.
4. Send short progress updates for each company as it finishes.

## Technical notes
- Rerun `bun scripts/partner-mirror-ir.ts` with lower concurrency. On a 429 "Daily data limit", wait and retry rather than marking files failed.
- Optional: ask the partner to raise the daily limit for this one-time copy.
