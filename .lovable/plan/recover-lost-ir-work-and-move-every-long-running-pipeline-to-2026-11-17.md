# Recover lost IR work and move every long-running pipeline to the cloud

## What version history shows
The project's saved history goes straight from 03:36 UTC (Live plant warnings) to a 07:13 "Work in progress" save. That save only changes one generated database types file. None of the IR work done between about 04:00 and 07:10 was ever saved to the project. That work included logos for every ticker, the sentence reader, the cross-file checks, the SEC revenue check, the percentage fix and the safer name-merging rules. It lived only in the build workspace, and the workspace was reset. No newer version exists, so the work gets rebuilt. This time each piece is saved before the next one starts.

What survived is everything in the database and file storage. That includes 8.1 million IR figures for 316 companies, 237 finished deep builds, about 23,000 sentence figures and all stored IR documents for 1,844 companies. The database change that added the sentence-reader fields also survived.

## What runs automatically right now (cloud, unaffected by the reset)
These scheduled jobs run on the published app's server:
- **Prices:** every 6 minutes during market hours.
- **SEC filings:** every 6 minutes.
- **Macro:** every 10 minutes.
- **Filing cache warm-up:** every 15 minutes.
- **IR document collection** (new releases and exhibits): every 5 minutes.
- **Analyst estimates:** hourly.
- **Alt data:** every 3 minutes.
- **Government data:** every 6 hours.
- **Nightly trade setups:** 4 parallel slots.
- **Options snapshots:** evenings and overnight.

## What stopped (it ran only in the temporary build workspace)
- The deep build loop, which reads tables, slides and sentences company by company.
- The rebuild of every company.
- Spreadsheet conversion.
- Line-name merging.

None of these are browser jobs. They ran as scripts in the workspace and died when it reset.

## Plan

### 1. Never lose code again
- Save after every milestone and confirm the save landed before starting the next step. Never leave hours of work unsaved.
- Re-check the saved history at the start of every long session.

### 2. Rebuild the lost code
Rebuild in order of value:
1. Logos for every ticker.
2. File coverage for all file types.
3. The sentence reader and its cleanup tool.
4. The cross-file "confirmed by N files" checks and the confirmed-share summary.
5. The SEC revenue check.
6. The source-panel percentage fix.
7. The safer name-merging checks: date snapping, balance-sheet values, "never drop KPIs" and the answer cache.
8. Parallel lanes for the build loop.

Each step is saved, tested and checked in the browser before the next one starts.

### 3. Move the heavy pipelines onto a persistent cloud worker
The app's server stops each request after a few seconds. It can't run hour-long readers, and it doesn't have the PDF, OCR and Docling tools they need. So the readers need a small always-on worker.
- Package `scripts/` (the deep loop, readers, Docling, OCR, renditions, name merging and rebuilds) as a Docker image. Run it as a Render Background Worker on your existing Render account. Raise the instance size as needed: Standard or Pro (2–4 GB RAM) for Docling and OCR, plus a persistent disk for the working files. I'll connect Render through its API key and deploy it myself.
- The worker keeps all progress in the database: the queue, leases, ledger and per-company reports. A restart resumes where it stopped. Nothing depends on local files.
- Add a "Pipeline status" admin page showing:
  - companies done and in progress
  - the pending queue in order
  - credits used
  - the last error
  - pause and resume buttons
- Add a scheduled heartbeat check. If the worker stops reporting for 15 minutes, it shows on the admin page, with an optional email.

### 4. Order of work
Set up the Render worker and the database queue first (steps 1 and 3), so every rebuilt reader runs in the cloud from day one. Then rebuild the lost code (step 2), shipping each piece to the worker as it's done. The build workspace is used only for short tests.

## Technical details
- **Queue:** keep it in `job_state` or a new `pipeline_queue` table, not in loop memory. The pending list survives restarts and the admin page can show it.
- **Worker image:** bun, poppler-utils, tesseract, ImageMagick, Docling (Python) and LibreOffice. Secrets come from worker environment variables (gateway key, service role key and partner key).
- **Single-flight leases:** the existing leases in `job_state` stay, so the worker and a workspace run can't double-process a company.

## Needs from you
- Approve the Render connection card when it appears. I'll create a Render API key connection if none exists yet.
- Render bills the worker plan to your account, roughly $25–85 per month depending on size.
