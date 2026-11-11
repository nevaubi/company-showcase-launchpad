# Fix: Financials sub-tabs crash ("This page didn't load")

## Why it happens
On the Financials tab, the page asks "is this user allowed to export?" only on the Normalized view. When you switch to As reported, Industry template or Adjusted, that check gets skipped. React requires the same checks to run in the same order on every render, so the switch makes it throw ("Rendered more hooks than during the previous render", React error #310) and the error page appears. "Try again" works because it starts the page fresh on the new tab, so the order is consistent again.

The 404 lines for SPCX in the console are separate and harmless: the partner data service has no statements for that ticker, and the page already falls back. They don't cause the crash.

## Fix
- In the Financials page, move the export-permission check (`useFeatureGate()`) up to the top of the component, next to the other hooks, before any early return (basis switch, error, loading).
- Quickly scan the Reports tab and IR breakdowns (the other places using this check) for the same pattern and move it up if needed.

## Verify
- In the browser as admin, open a company's Financials and click Normalized → As reported → Industry template → Adjusted → Normalized; confirm no error page and no React #310 in the console.
