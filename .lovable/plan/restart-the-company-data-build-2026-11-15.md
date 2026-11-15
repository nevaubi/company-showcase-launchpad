# Restart the company data build

## Where things stand
- The build is not running right now. The workspace restarted overnight, which stopped the loop and cleared its local logs.
- Nothing finished is lost. Every completed company's figures and reports are saved in the database, so about 70 companies (about 1.76 million figures, plus Hartford) are safe.
- Baker Hughes was the last company running when credits ran low. It may be only partly done.

## What I'll do once you approve
1. Check the credit balance. If it's empty, I'll stop and ask you to refill.
2. Find out which companies have saved final reports, and put Baker Hughes back in the queue if it didn't finish.
3. Restart the loop with the same settings as before: no spend cap, Gemini 3.1 Flash Lite, GPT-6 Luna for harder slides, and pause-and-retry when credits run out.
4. Start the next batch from the largest companies that have no figures yet.
5. Report each batch as it finishes, the same way as before.

## Technical notes
- Restart `scripts/ir-deep-loop.ts` in the background. Its state comes from saved reports in `ir-documents/ops/ir-deep/`, not from /tmp.
- Partner copy retries still happen every 3 hours.
