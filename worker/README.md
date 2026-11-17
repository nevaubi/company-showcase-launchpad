# IR pipeline worker

Deploy on Render as a Background Worker from the project's GitHub repo:
- Dockerfile path `worker/Dockerfile`, docker context `.`, plan Pro (4 GB) or larger, a persistent disk at `/var/data`.
- Environment: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LOVABLE_API_KEY`, `PARTNER_DATA_KEY`.
- Auto-deploy on commit keeps the worker on the latest pipeline code. The loop holds a database lease
  (`ir-deep-loop`), so it never runs twice alongside a workspace run.
- Sizing: the loop reads the container's memory limit and picks parallel companies and reader counts from it.
  `IR_LANES` overrides the number of companies read at once (set on Render: 5 on Pro Ultra, 32 GB / 8 CPU);
  `IR_DOCLING_WORKERS_FIXED`, `IR_EXTRACT_CONCURRENCY_FIXED`, `IR_VISION_CONCURRENCY_FIXED` pin per-company counts.
- Render does not always redeploy on push: trigger a deploy from Render (or its API) after pipeline changes.
