# Onboarding

- Per-user state lives in `user_onboarding` (owner RLS); `seedStarterWorkspace` claims then seeds once and never re-adds deleted items, using FU() formulas only so starter figures stay sourced.
- Tour steps target `data-tour` selectors; one `src/lib/shortcuts.ts` list drives both key handling and the shortcuts sheet.
- Tour steps may set `path` (page to open) and `click` (element clicked to demonstrate) before spotlighting `target`; targets must be stable `data-tour`/id selectors on those pages, and CSS-keyframe previews from `tour-previews.tsx` illustrate steps without a live target.
