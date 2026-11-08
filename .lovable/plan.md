# Replace the homepage with the uploaded landing page

Your homepage (filedunder.ai) becomes exactly the page in the zip: the "Verification" version it opens by default. None of the earlier mockup versions get used.

## What visitors will see (top to bottom, as in the zip)
1. Top navigation bar
2. Night aerial Chicago video with the headline
3. Strip of the sources we read
4. Source-highlighting demo on BAC's 3Q26 supplement pages
5. Accuracy checks section
6. Verification ledger
7. Product section ("Research that does the reading for you")
8. FAQ
9. Lakefront video closing section, then footer

## Notes
- The zip also has two other versions (Markets desk, Editorial). I'll leave them out, since you asked for this one only.
- The sample figures, stats and people in the zip stay as you wrote them. They'll go live on the real site, so check them against the filings before you publish.
- The "Request access" and sign-in buttons will go to the existing sign-in page.
- The mockup pages stay where they are, untouched.

## Technical details
- Copy `fu-hero/src/components/arc/*` and `fu-hero/src/landing/*` as-is into `src/components/fu-landing/` (no design edits). Change only imports, plus the `next-image`/media shims, so they work in this app.
- Upload the 10 videos/posters and the 32 BAC page images with lovable-assets. Point `video-clips.ts` BASE and the provenance image paths at those asset URLs.
- Scope the Arc `foundation.css` and the `data-theme` setup to a wrapper so they don't change the signed-in app's styles.
- `src/routes/index.tsx` renders `<LandingVerification />` and gets its own head() title and description. Wire the nav and CTA links to the existing auth routes.
- Install any missing deps (radix tabs/tooltip/dropdown if absent). Verify on desktop and phone width with Playwright.
