# Getting found: Google, social, ChatGPT

## Where things stand (checked today)
- Sept-Nov traffic: 245 visits, nearly all typed in directly, 14 from Google, 0 from social or AI tools.
- No sitemap (filedunder.ai/sitemap.xml returns "not found"), so Google has no list of pages to crawl.
- Only 4 public pages (home, pricing, sign-in, 3 sample companies). Everything else is behind sign-in, which Google can't read.
- Semrush (US): people rarely search for "AI equity research" (~40/mo). "SEC filings search" gets ~1,300/mo but is hard to rank for. The real demand is per-company questions like "Nvidia revenue by year", which the sample pages already answer.

## 1. Google (build now)
- Add a sitemap and point the robots file at it; also let AI crawlers in (GPTBot, OAI-SearchBot, PerplexityBot, ClaudeBot, Google-Extended).
- Grow public company pages from 3 to all 78 core companies, each with a unique title like "Apple revenue, earnings and cash flow by year (SEC-sourced)". Each page shows the same limited snapshot plus the waitlist button, and the deep tabs stay members-only.
- Add a public /companies index page and link it from the header and footer, so Google can reach every company.
- Add structured data (Organization on the home page, company/dataset details on company pages) and share images for each page.
- Connect Google Search Console and submit the sitemap. You approve the connection.

## 2. Social (content plan, no ads yet)
- Each company page becomes a shareable card with a share picture showing its headline numbers.
- Weekly post idea: "One number, one source", a figure from a fresh 10-Q with a link to the filing. Channels: X finance accounts, LinkedIn, and r/SecurityAnalysis / r/ValueInvesting where self-promotion rules allow it (I'll check each group's rules before you post).
- Tag every shared link so visits show up as social in your analytics.
- No videos for now, per your call.

## 3. ChatGPT and AI answers
- Free route first: AI assistants cite pages they can crawl. The crawler access, sitemap, public company pages and an llms.txt file (a plain summary of the site for AI tools) make Filed Under citable for questions like "what was Nvidia's FY2025 revenue".
- Paid ChatGPT ads: I can't confirm today how open they are to small advertisers or how to sign up, and I can't create them from here. I'll check OpenAI's current advertiser page and report back. If it's self-serve, the pitch would be the sample company pages with a waitlist goal.
- Google and Meta ads can be set up from here later, once the waitlist signup is tracked as a conversion.

## Order
1. Sitemap, robots and AI crawler access, llms.txt
2. Public pages for all 78 core companies, plus the index page
3. Structured data and share images
4. Connect Search Console and submit the sitemap
5. Research ChatGPT ads and share findings; draft the first 4 social posts

## Technical notes
- Sitemap as a server route `src/routes/sitemap[.]xml.tsx` built from the core coverage list; `public/robots.txt` adds the AI bots and a Sitemap line; `public/llms.txt` added.
- `PUBLIC_TICKERS` widens to the 78 core tickers in `src/lib/public-company.ts` (test updated); public server fn unchanged otherwise, still refuses others.
- New `src/routes/companies.index.tsx`; JSON-LD via route `head().scripts`; canonical on leaf routes only.
- Share images: generated per-company 1200x630 cards served from a server route so og:image is absolute.
