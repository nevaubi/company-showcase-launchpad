# New city video hero for the landing mockup

Rebuild the opening screen of **/mockups/landing** using your uploaded Chicago hero designs. The real landing page stays untouched.

## What you'll see
1. **Night aerial hero (main):** full-screen night flight over downtown Chicago, centered headline "Equity research, written from the filings", short pitch, "Start free" / "See a sample memo" buttons, and a slowly scrolling filing tape along the bottom (BAC 8-K, JPM 10-Q, CME, ADM, MCD, NTRS...).
2. **Split city hero (second section, right below):** copy on the left, video panel on the right with a scene switcher that crossfades between River at dusk and Gold Coast.
3. Both videos fade in smoothly, pause when scrolled offscreen, show a still image for visitors who prefer less motion, and have a pause button.
4. Small Pexels credits in the corner.

The trading-terminal hero from your files is skipped, as you asked for city ones only.

## Things to know
- You uploaded 3 of the 5 clips. The Lakefront clip is missing, so the switcher will have 2 scenes unless you send it.
- The tape rows and the split hero stats (4 min, 6,200+, 100%) are sample copy from your files; I'll mark them as placeholders.

## Technical details
- Upload the 3 MP4s with lovable-assets; generate a JPG poster per clip with ffmpeg (first frame) and upload those too.
- Port `video-backdrop.tsx`, `hero-video.tsx` (night + split only) and the CSS module into `src/components/landing-video/`, pointing `video-clips.ts` at the asset URLs.
- Swap the current Chicago hero in `src/routes/mockups.landing.tsx` for `ChicagoNightVideoHero`, insert `ChicagoSplitVideoHero` after it, recolor CSS to Filed Under tokens/Geist.
- Verify in the browser at desktop and phone width.
