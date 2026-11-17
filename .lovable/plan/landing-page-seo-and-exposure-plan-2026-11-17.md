# Landing page, SEO and exposure — plan

## What I found
- Public company pages, the company index and the sitemap only cover the original 78 companies, and the index page says "78 large US companies". The platform now covers ~1,844, so about 96% of the companies we have are invisible to Google and AI search. This is the biggest single gain available.
- The home page has good basics (title, description, canonical, Organization data) but no share image, and it doesn't show the product's strongest features (IR KPIs, supply chain, Office Studio, assistant).
- No share images exist for company pages, so links on X, LinkedIn, Slack and iMessage show no picture.
- No content pages exist for features or comparisons ("Koyfin alternative", "SEC filing data with sources").

## 1. Open all companies to search (biggest win)
- Public page for every covered company: revenue, earnings, cash flow, margins by year, each linked to its SEC filing, plus a short company description and links to peers in the same sector.
- Company index grouped by sector and A–Z, no "78" wording.
- Sitemap lists every company, split into parts if large; llms.txt updated.
- Each page gets Corporation/Dataset structured data and breadcrumbs.

## 2. Landing page refresh
- Hero that shows a real number being clicked and opening its SEC source (short looping animation, same style as the tour).
- Feature sections with real screenshots: IR KPIs and segments, supply-chain map, point-in-time valuation, filing redlines, research assistant, Office Studio.
- Proof strip with live counts (companies, sourced figures, IR documents) read from the database, not hand-typed.
- Clear "Join the waitlist / Start trial" buttons above the fold and at the bottom; pricing teaser.
- Faster first load: keep the hero light, load animations after the page is visible.

## 3. Share images
- Generated 1200x630 card per company (logo, name, ticker, latest revenue and net income with "sourced to 10-K") and one for the home and pricing pages.

## 4. Feature pages (new public pages)
- /features/click-to-source, /features/ir-kpis, /features/supply-chain, /features/office-studio, /features/research-assistant — each with its own title, description and screenshot, linked from the home page.
- I'll check real search demand with Semrush before choosing wording, and won't invent claims.

## 5. Exposure (after the above is published)
- Rescan SEO, resubmit the sitemap in Search Console.
- Then from the saved marketing plan: Show HN / Product Hunt once first test users give feedback, and ChatGPT ads to company pages.

## Technical details
- Company pages read the bundled/partner datasets already used by `companies.$ticker.tsx`; extend coverage to the full universe manifest and make the sitemap a generated index.
- Share cards rendered by a server route that returns an image per ticker, cached.
- Live counts via a public read-only server function with narrow fields.
- Every new route gets its own head() with unique title, description, og tags and canonical.

## Order
1, then 2, then 3, then 4, then publish and do 5.
