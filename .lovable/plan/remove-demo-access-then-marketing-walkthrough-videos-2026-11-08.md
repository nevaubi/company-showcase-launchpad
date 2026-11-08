# Remove demo access, then marketing + walkthrough videos

## 1. Remove the demo workspace completely
- Remove "Try the demo" (site header), "Open the demo" (pricing page) and "Open the demo workspace" (sign-in page); update sign-in page description text.
- Delete the demo sign-in server code and hook so it can't be triggered even by calling it directly.
- Database: `has_app_access` no longer counts demo profiles; mark existing demo profile(s) as not demo and sign out / disable the shared demo account so any open demo sessions lose access.
- Remove the "Shared demo workspace" label in the app sidebar.
- Verify: signed-out pages show no demo buttons; the demo account gets the waitlist screen; admin still gets in.

## 2. Exposure, marketing and engagement (discussion, no app changes)
After step 1 I'll research and come back with a ranked plan:
- Site checks: page titles/descriptions, sitemap, Google Search Console, signup flow works end to end.
- Search demand (Semrush) for terms like "SEC filing search", "10-K AI", "AI equity research", plus 2-3 competitors (e.g. Fintool, AlphaSense, Koyfin).
- Communities to reach investors (relevant subreddits, X fintwit, Hacker News Show HN, Product Hunt), each opened and checked before recommending.
- Engagement ideas: public sample report pages (SEO + shareable), weekly "filing redline of the week" posts, waitlist referral, onboarding emails.
- Saved to your Files as research + plan.

## 3. Short walkthrough videos (motion graphics)
Record real screenshots of the live app (signed in as you), then hand them to the video maker for 3 short animated walkthroughs, 15-25s each, landscape 16:9 plus a vertical 9:16 cut for social:
1. Click any number, see the exact SEC filing sentence highlighted.
2. Ask the research assistant a question, get a cited answer.
3. Filing redline: what changed between two 10-Ks.
Saved to your Files for review; nothing added to the site unless you ask.

## Technical notes
- Files: `site-chrome.tsx`, `pricing.tsx`, `auth.tsx`, `app-shell.tsx`, delete `demo.server.ts`, `demo.functions.ts`, `use-demo-sign-in.ts`; migration updating `has_app_access` and demo profiles; AGENTS.md access rule drops "or demo".
- Screenshots via Playwright at 1280 wide into /mnt/documents; videos via the animation sub-agent into /mnt/documents/videos/.
