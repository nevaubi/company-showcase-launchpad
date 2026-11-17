# IR pipeline worker

Deploy on Render as a Background Worker from the project's GitHub repo:
- Dockerfile path `worker/Dockerfile`, docker context `.`, plan Pro (4 GB) or larger, a persistent disk at `/var/data`.
- Environment: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LOVABLE_API_KEY`, `PARTNER_DATA_KEY`.
- Auto-deploy on commit keeps the worker on the latest pipeline code. The loop holds a database lease
  (`ir-deep-loop`), so it never runs twice alongside a workspace run.
