# Onboarding

- Per-user state lives in `user_onboarding` (owner RLS); `seedStarterWorkspace` claims then seeds once and never re-adds deleted items, using FU() formulas only so starter figures stay sourced.
- Tour steps target `data-tour` selectors; one `src/lib/shortcuts.ts` list drives both key handling and the shortcuts sheet.
- The tour stays on the dashboard (no page switches mid-tour); feature steps without a dashboard target show a CSS-keyframe preview from `tour-previews.tsx` instead.
