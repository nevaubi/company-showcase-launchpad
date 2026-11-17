# Filed Under Office Engine on Render

## Goal
Run Filed Under's own document engine on Render, the always-on service behind the Sheets (.xlsx) and Slides (.pptx) editors. It shares no code, settings, keys or service with JuneDesk.

## What the engine is
It is the `services/office-engine` folder from the uploaded office suite, about 8 MB:
- A Node server that keeps one worker per open workbook or deck.
- A small Rust program that reads and writes .xlsx files exactly.
- Real fonts, so slide text breaks the same way it does in PowerPoint.

It holds no database, no storage keys and no AI. It trusts only short-lived sign-in tokens issued by our app, and it saves through our app.

## Steps

1. **New private GitHub repo: `nevaubi/filedunder-office-engine`**
   - Copy in only the engine folder.
   - Remove JuneDesk/Seeger Weiss names: package name, user-agent, README.
   - Keep the Apache-2.0 LICENSE and NOTICE files as required.
   - Include no `.git` data, `node_modules` or build output.
2. **New Render web service: `filedunder-office-engine`**
   - Same Render account, but its own service.
   - Docker build from the new repo, Oregon region (next to the IR worker; JuneDesk's engine is in Singapore).
   - Standard plan to start (2 GB), with a health check at `/health`.
   - Redeploys automatically on every push to `main`.
3. **Settings on that service only**
   - `OFFICE_PLATFORM_URL` = https://filedunder.ai
   - `OFFICE_ENGINE_JWKS_URL` = https://filedunder.ai/api/public/office/jwks
   - Issuer and audience `filedunder-office-engine`, tenant `filedunder`.
   - Allowed origins: filedunder.ai, www.filedunder.ai, the preview and the published app address.
   - Session limits: 40 in total, 4 per user.
4. **Verify the deploy**
   - The build passes the fidelity test that runs inside the image.
   - `/health` returns OK.
   - A request without a token is refused.
5. **Record it**
   - Add one line to `AGENTS.md` naming the engine service and repo.
   - Add a worker/engine status card on the admin Live worker page.

## Not in this step
These belong to the next plan, the Office integration that replaces Docs & sheets:
- The app-side token issuer and `/api/public/office/jwks` route.
- The document save routes and the editors.

Until that lands, the engine runs but sits idle: nothing can open a document in it yet.

## Technical details
- Repo creation and file upload use the linked GitHub account through the API, committing the whole tree at once.
- Render service creation uses the Render connection (`POST /services`, type `web_service`, runtime docker).
- The token signing key (`OFFICE_ENGINE_JWT_PRIVATE_KEY`) will be generated later as an app secret. The engine only ever sees the public key, via the JWKS route.
- Cost: Render Standard is about $25/month. Move to Pro (4 GB) if many workbooks are open at once.
