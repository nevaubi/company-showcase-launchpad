# Live browsers inside the assistant panels

## What already exists
- A `BROWSER_USE_API_KEY` is already saved, and the research assistant (⌘J) can already start up to 4 Browser Use v4 cloud browsers (`browser_task`, `browser_status`, `browser_files`, `browser_stop`).
- Today the live view only appears in the wide canvas beside the chat (Browser tab). In the chat itself you only see a "Started browser" line.
- OfficeAI (Writer, Sheets, Slides, PDF) runs the same agent loop, but it has no canvas, so its browser runs can't be watched.

## What we'll build
1. **Browser card in the chat** (assistant + OfficeAI): each run shows as a compact card in the conversation with:
   - a small live view of the browser (expandable to full panel / pop-out),
   - goal, status, current page title and address, last few steps,
   - Stop, "Take over" (opens the live view so you can click/type yourself, e.g. a login or captcha) and "Open in canvas" buttons,
   - when finished: the result text and downloaded files (PDFs, CSVs, screenshots) as file chips.
   Up to 4 cards side by side as a grid when running in parallel.
2. **OfficeAI gets browser tools**, plus "save to document": a downloaded PDF/XLSX can be imported into Office Studio, or its text cited in the open file with the source URL.
3. **Better runs**: per-run options the agent can set — US proxy (default), recording off, model `bu-4.0` by default with a faster/cheaper option for simple lookups, max steps and a time limit; structured output (agent passes a JSON shape so results come back as tables, not prose).
4. **Safety and cost**: still authed + app-access only; runs stay tied to the user (existing signed handle); per-user daily cap on runs and a concurrency cap; agent must say why it needs a browser and prefer `read_webpage`/web extract first. Cost per run shown on the card.
5. **Sourcing**: anything the browser extracts that ends up in an answer or document must list the page URLs it came from (same rule as web research).

## Key
You don't need to send a new key unless you want to replace the existing one. If you do, I'll open the secure form after approval — don't paste it in chat.

## Technical details
- Upgrade `src/lib/browser-use.server.ts` to accept `model`, `browserSettings` (`proxyCountryCode`, `record`), `maxSteps`, output schema; keep fetch-based client (no Node-only SDK needed on workerd), or use `browser-use-sdk/v4` only if it runs on workers.
- New `BrowserRunCard` component shared by `assistant-panel.tsx` and `office-ai-panel.tsx`, polling `browser.functions.ts` status; live view in a sandboxed iframe with `allow` limited, "take over" toggles pointer events.
- Register browser tools for the `office` mode in `tool-defs.ts`/`execute.ts`; add `browser_import_file` to move a run file into `office_files`.
- `browser_runs` table (user_id, run_id, status, cost, created_at) with owner RLS for caps and history.
- Tests: cap/limit rules, option defaults, run-handle ownership.
