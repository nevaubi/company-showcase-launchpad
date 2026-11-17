# Render services

- The IR deep build loop runs on the always-on Render worker `filedunder-ir-worker` (this folder's Dockerfile), with progress kept in the database so restarts resume.
- Office engine: private repo `nevaubi/filedunder-office-engine`, Render service `filedunder-office-engine` (not shared with JuneDesk); it trusts only tokens from this app's `/api/public/office/jwks`.
