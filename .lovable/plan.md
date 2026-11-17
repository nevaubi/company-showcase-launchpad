# First-run experience: tour, starter workspace, shortcuts, always-on guide

## Goal
A new tester should understand Filed Under in under a minute: see a populated workspace, get a short guided tour of what makes it different (click-to-source, search, assistant, Office Studio), learn keyboard shortcuts, and always have a helper one keystroke away.

## 1. Starter workspace (pre-seeded on first sign-in)
- On first visit to `/app`, if the user has no watchlist and hasn't been seeded, add NVDA, MSFT, COST to their watchlist.
- Create one starter Office file: "NVIDIA — starter model" (Sheets) built from SEC-sourced revenue/net income, so Office Studio isn't empty. Built from real stored figures, never invented.
- Runs once per user (flag on profile); deleting the items never re-adds them.

## 2. Interactive guided tour (spotlight)
- Lightweight custom spotlight: dims the page, cuts out the target element, shows a small card (title, one line, Back / Next / Skip, "3 of 6").
- Steps target existing page regions by `data-tour="..."` markers:
  1. Search (⌘K) — jump to any of ~1,844 companies.
  2. Watchlist on the dashboard — your starter companies.
  3. Opens NVDA financials — click any number to see its SEC source (opens the source panel on a real value).
  4. IR KPIs tab — segment and KPI data with cited documents.
  5. Assistant (⌘J) — ask anything, it cites sources.
  6. Office Studio — AI builds cited docs, models, decks.
- Auto-starts once after the first sign-in; can be restarted any time from the help menu or by asking the assistant ("show me around").
- Mobile: same steps as centered cards without spotlight cutouts.

## 3. Quick-start checklist
- Small dismissible card on `/app`: search a ticker, trace a number to its source, ask the assistant, create an Office file. Items tick off automatically when the action happens. Hidden after all done or dismissed.

## 4. Keyboard shortcuts
- Press `?` anywhere (not while typing) to open a clean shortcuts sheet, grouped: Navigation, Company pages, Assistant, Office.
- New shortcuts: `G` then `D` dashboard, `G C` companies, `G O` Office, `G R` reports, `G W` watchlist, `/` focus search, `Esc` close panels, `[` `]` previous/next tab on company pages. Existing ⌘K and ⌘J kept.
- One shared shortcut list drives both the handler and the sheet, so they never drift. Sheet also reachable from a "?" help button in the top bar.

## 5. Assistant as an always-available guide
- Help button in the top bar: Tour, Shortcuts, Ask the guide, What's new.
- Guide mode in the existing assistant: knows the app's pages and features (from the nav map) and can answer "where do I find insider buys?" by navigating there and highlighting the section, using its existing on-page tools.
- New assistant tools: `start_tour`, `open_shortcuts`, `navigate_to_feature`.
- Page-aware starter prompts: on each page, the empty assistant shows 3 suggestions relevant to that page (e.g. on Financials: "Explain the margin change and cite the 10-K").
- Guide answers about the app use the in-app feature map only; financial answers keep the existing citation rules.

## Out of scope
- Removing "Lovable" from the Google sign-in screen (needs your own Google credentials — separate step).

## Technical details
- Migration: `profiles.onboarding jsonb` (seeded_at, tour_done_at, checklist, dismissed). Owner can update own row only.
- Seeding via an authenticated server function (`requireAppAccess`) so it is idempotent and server-checked; starter workbook built from the dataset loader with SourceRefs.
- Tour: `src/components/onboarding/tour.tsx` + `src/lib/onboarding/steps.ts`; `data-tour` attributes added to app-shell, dashboard, company tabs, assistant toggle, Office nav.
- Shortcuts: `src/lib/shortcuts.ts` registry, handler in app-shell (ignores inputs/contenteditable/Office editors), `shortcuts-sheet.tsx` dialog.
- Assistant: feature map generated from `src/lib/nav.ts`; tools added in `src/lib/research/execute.ts`; suggestions keyed by route.
- Tests: seeding runs once and never re-adds deleted items; shortcut registry has no duplicate keys; `?` ignored while typing.
