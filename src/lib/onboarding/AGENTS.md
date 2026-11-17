# Onboarding

- Per-user state lives in `user_onboarding` (owner RLS); `seedStarterWorkspace` claims then seeds once and never re-adds deleted items, using FU() formulas only so starter figures stay sourced.
- Tour steps target `data-tour` selectors; one `src/lib/shortcuts.ts` list drives both key handling and the shortcuts sheet.
