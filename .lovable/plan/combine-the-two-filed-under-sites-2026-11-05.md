# Combine the two Filed Under sites

## What the other site's code shows (changes my earlier advice)
- It's built very differently: plain JavaScript pages with no framework, Python data scripts, Vercel functions and its own separate database.
- This site is a React app. Moving its features (supply-chain map, assistant panel, estimates, alerts, trade ideas, sectors, company layout) over there means rewriting nearly all of them from scratch. That's months of work and very risky.
- Its data, on the other hand, is mostly published as ready-made public files: company statements, IR/KPI series, prices, insiders, sectors and screener data for about 500 to 1,000 tickers. This site can read those directly or copy them.

**New recommendation: bring that site's data into this site.** All the features you listed stay exactly as they are.

## Steps
1. **Inventory.** List every data file and database table the other site produces, map each to what this site uses today (statements, IR series, KPIs, insiders, prices, sectors), and confirm the ticker count.
2. **Connect to the other site's database (read-only).** This site connects from the server to the other site's backend. Its address and a read-only key are saved as secure secrets, so they're never visible in the browser. Its IR corpus becomes the main source of IR data for every ticker; nothing gets copied or hand-edited. Statements, prices, insiders and sector files are read the same way and converted to this site's formats. Every number keeps its SEC accession, concept and period, so click-to-source still works. If that site is unreachable, the page falls back to this site's own data.
3. **Expand coverage** from 78 to the full list. Company pages, search and sectors pick up the new tickers automatically.
4. **The other site's IR corpus wins.** For the 78 companies on both sites, the IR page shows the other site's IR data. This site's own backfill stops, and its stored IR data is kept only as a backup.
5. **Fill the new tickers** by running this site's own pipelines for them: supply chain, alt data, estimates, trade ideas and company context. These run in small batches with a spend cap. Supply-chain AI reading costs scale with ticker count.
6. **Bring over unique pieces** from that site only where they add value (its macro store, its 189-field screener, its workspace), rebuilt as React pages one at a time.
7. **Verify.** Run the tests, then check pages signed in for NVDA, AAPL and a few newly added small companies.

## Needs from you
- When building starts, you'll get a secure form for the other backend's project URL and a read-only key, ideally one limited to reading data. Please don't paste them into chat.
- After this, the Vercel site can be retired.
