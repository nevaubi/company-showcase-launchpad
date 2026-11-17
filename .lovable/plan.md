# Smoother, higher-quality first-run tour

## Why it feels laggy and jumpy today
- The highlight is found by checking the page every 150 ms; while it searches, the highlight disappears and the card jumps to the centre, then snaps back.
- Steps 3–4 switch pages mid-tour, so the whole screen reloads behind the card.
- The page scrolls instantly to the target, and the card is placed after the scroll, so it lands a beat late.
- Steps are plain text, with nothing showing what the feature actually does.

## What changes for the user
1. **Welcome screen first** — a short, polished intro card (logo, one line, "Start tour / Skip") with a soft fade-in, before anything is highlighted.
2. **Each step gets a looping preview** — a small 4–6 second animated clip at the top of the card showing the feature in action (search typing "NVDA", a number opening its SEC source with the highlight, IR table filling in, assistant answering with a citation, OfficeAI building a model). Built as lightweight animated illustrations in our black line-art style, so they load instantly and stay sharp.
3. **Smooth motion** — the highlight glides from one target to the next, the card slides with it, the page scrolls smoothly, and the dim backdrop fades rather than flickers. A thin progress bar and step dots replace "3 / 6".
4. **No page jumps** — the tour stays on the dashboard; the source-trace and IR steps show their preview instead of loading the NVIDIA page. A final "Try it on NVIDIA" button opens the real page afterwards.
5. **Keyboard and reduced-motion friendly** — arrows/Esc kept; users with "reduce motion" get fades only.

## Technical details
- `src/components/onboarding/tour.tsx`: replace polling with a `MutationObserver` + `ResizeObserver`, keep the previous box until the new one is found, smooth `scrollIntoView` then measure, animate box/card with CSS transforms (`transform`/`opacity` only, ~280 ms ease-out), add welcome + finish steps.
- `src/lib/onboarding/steps.ts`: add `preview` key per step; drop `path` for steps 3–4.
- New `src/components/onboarding/previews/*.tsx`: small SVG/CSS keyframe loops using design tokens (no video files, no new library), paused when off-screen and static under `prefers-reduced-motion`.
- Tokens for backdrop, highlight glow and motion timing added to `src/styles.css`.
- Verify with Playwright: screenshots per step, check no layout shift between steps, and console clean.

## Question left open
If you'd rather have real screen-recorded clips of the app instead of animated illustrations, I can record them with the browser instead — heavier to load, but literal.
