# IR worker audit and fix plan

## What is actually happening (checked today in the worker's crash history, logs and saved progress)

1. **The worker still only has 4 GB of memory.** The plan was upgraded to the largest tier at 09:29, but every crash since then (09:32, 09:44, 09:59, 10:18, 10:34, 10:48, 11:05) reports a 4 GB limit. The running machine was never replaced after the upgrade, so the 32 GB we pay for isn't in use. Meanwhile the worker was tuned for 32 GB (6 file converters, 24 parallel readers, 8 GB heap), so it now runs out of memory faster than before.
2. **Why it looks like "once every 15 minutes".** Each crash leaves the worker's "I'm running" lock in place for 15 minutes. The restarted worker sees its own old lock and sits idle until it expires (the logs show minute after minute of "another loop holds the lease — waiting"), works 1–3 minutes, crashes, and the cycle repeats. Roughly 85% of the time is spent waiting.
3. **Why no ticker ever finishes.** It works through a batch of 10 companies in one go, and only writes a company's "finished" report at the very end. A crash anywhere loses the finished status for all 10. No new finished report has been saved since 07:04.
4. **Why it isn't "smart".** Two rules fight each other: after 3 crashed attempts a company is "left for review", then the next cycle's "done with no figures" or "new unread files" rule puts it back in the queue. KLAC, WDC, BLDR, AA, BWA, J, DVA, AMTM and others are now at 5 attempts. The crashes also count against the company even though the company wasn't the cause.
5. **Smaller faults:** `pgrep` isn't installed on the worker (it logs an error every start); the partner mirror and other side jobs start in the same memory space at boot; work already done isn't lost (110k figures saved in the last 6 hours), but no company gets credit for it.

## Plan

### 1. Actually get the 32 GB machine (right away)
- Trigger a fresh deploy so the worker restarts on the Pro Ultra machine, and confirm the new memory limit in the crash/restart events.
- Until that's confirmed, start the worker at safe settings and scale up automatically based on the memory it detects (below).

### 2. No more 15-minute idle gaps
- Every worker start gets its own ID. A restarted worker that finds a lock left by a dead run takes it over right away. It only waits when another live worker is still sending heartbeats.
- Shorter lock (3 min, renewed every minute) as a backup.

### 3. One company at a time, with saved checkpoints
- The batch of 10 becomes a queue processed one company at a time, with 2–3 companies running in parallel depending on memory.
- Save progress after each stage (dates, conversion, tables, slides, rebuild, final report), so a crash resumes at the stage it stopped at instead of starting over.
- Write the "finished" report per company as soon as that company is done.

### 4. Memory-aware settings
- At start, read the real memory limit and set converter/reader counts and heap size from it, rather than using fixed numbers.
- Run large PDF conversion in isolated child processes with a per-file memory cap and timeout. One huge file gets skipped and marked, and the worker keeps running.
- Track memory use. Above 80%, pause starting new files until it drops.

### 5. A smarter queue
- One clear status per company: queued / running (stage) / finished / needs review (with reason) / waiting for files.
- Crashes caused by the machine running out of memory don't count against the company. Only errors specific to the company do.
- "Needs review" is final unless new files arrive, and it's never re-queued by the "no figures" rule.
- Priority order: interrupted companies, then companies with files but no figures (largest first), then finished companies with new files.
- Reset the attempt counters that the out-of-memory crashes inflated, so KLAC, WDC, BLDR and the others get a fair run.

### 6. Side jobs off the main path
- The partner mirror, filing detail, government data and earnings reactions start only after the main loop is stable, one at a time, at low priority, so they don't add memory at startup.
- Install `pgrep` (procps) in the worker image.

### 7. Visibility in the admin worker page
- Show: real memory limit and current use, restarts and out-of-memory crashes in the last 24h, the current company and stage, companies finished per hour, and the review list with reasons.
- Alert on the page if the worker has been idle or restarting for more than 10 minutes.

### 8. Verify
- After deploy: confirm a 32 GB limit, no idle "waiting" gaps after a restart, and at least 3 companies reaching a finished report within the first hour, all visible on the admin worker page.

## Technical details
- Files: `scripts/ir-deep-loop.ts` (lease with instance id + heartbeat takeover, per-company queue, status model, side-job scheduling), `scripts/ir-deep.ts` (stage checkpoints in `ops/ir-deep/<T>.json`, per-company report), `scripts/ir-docling.ts` (per-file subprocess with memory/timeout cap), `worker/Dockerfile` (procps, cgroup-derived sizing in an entry script instead of fixed ENV), admin worker page + `ir_live_progress` (memory/restart fields).
- The memory limit is read from `/sys/fs/cgroup/memory.max`. Render's restart events are read through the Render connection for the admin view.
- Already-saved figures are never deleted. All reading stays incremental.
