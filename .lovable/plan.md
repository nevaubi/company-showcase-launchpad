# Restart the company build

The workspace restarted again (uptime under a minute), so the build loop and partner file copy stopped. All finished companies are saved; batch 16 (Cheniere through Vistra) may be partly done.

## Steps
1. Restart the build loop with the same settings: no spend cap, GPT-6 Luna for hard slides, skip companies that are finished.
2. It resumes batch 16 where saved work left off, then keeps going batch after batch.
3. Restart the partner file copy in the background.
4. Start the keeper script so the loop restarts itself if it dies while the workspace is awake.
5. Report each finished batch (figures, series, quarter checks, credits).

## Limitation
The build stops whenever the workspace restarts. Running nonstop needs an always-on server outside this workspace, which needs your hosting account.

## Technical details
- `nohup bun scripts/ir-deep-loop.ts --force > /tmp/ir-deep/loop.log 2>&1 &`
- Recreate `/tmp/ir-deep/watch.sh` keeper and `summ.py` (wiped with /tmp).
