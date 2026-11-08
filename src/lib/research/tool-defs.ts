// Function-tool definitions shared by the research agent server step and the
// browser executor. Pure data — safe to import anywhere.

const obj = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const str = (description: string, extra: Record<string, unknown> = {}) => ({ type: "string", description, ...extra });
const nullable = (schema: Record<string, unknown>) => ({ ...schema, type: [schema.type as string, "null"] });

export const TOOL_DEFS = [
  {
    type: "function",
    name: "get_coverage",
    description: "List the companies with full SEC datasets, with TTM revenue, net income, FCF, margins, growth and latest filing.",
    parameters: obj({}, []),
    strict: true,
  },
  {
    type: "function",
    name: "get_financials",
    description:
      "Reported financial statement table from XBRL company facts. Every value carries the SEC accession number it came from. Quarterly fourth quarters are derived (annual minus nine months).",
    parameters: obj(
      {
        ticker: str("Ticker, e.g. NVDA"),
        statement: { type: "string", enum: ["income", "balance", "cashflow", "kpis"] },
        frequency: { type: "string", enum: ["annual", "quarterly"] },
        periods: { type: "integer", description: "Number of most recent periods, 1-16" },
        metrics: nullable({ type: "array", items: { type: "string" }, description: "Optional metric keys to include, e.g. revenue, grossMargin. null for all rows." }),
      },
      ["ticker", "statement", "frequency", "periods", "metrics"],
    ),
    strict: true,
  },
  {
    type: "function",
    name: "get_segments",
    description: "Segment, product and geographic revenue (and segment operating income) from inline-XBRL dimensional facts in recent 10-K/10-Q filings.",
    parameters: obj({ ticker: str("Ticker"), frequency: { type: "string", enum: ["annual", "quarterly"] } }, ["ticker", "frequency"]),
    strict: true,
  },
  {
    type: "function",
    name: "list_filings",
    description: "Recent SEC filings for a company with accession numbers, form types, periods and filing dates.",
    parameters: obj(
      {
        ticker: str("Ticker"),
        forms: nullable({ type: "array", items: { type: "string" }, description: "Form types to include, e.g. ['10-K','10-Q','8-K']. null for all." }),
        limit: { type: "integer", description: "Max rows, 1-40" },
      },
      ["ticker", "forms", "limit"],
    ),
    strict: true,
  },
  {
    type: "function",
    name: "read_filing",
    description:
      "Read passages from an SEC filing document. Give a search phrase to return the passages around each match (e.g. 'risk factors', 'Data Center', 'gross margin'). Returns plain text.",
    parameters: obj(
      {
        ticker: str("Ticker of the filer"),
        accession: str("Accession number, e.g. 0001045810-26-000123"),
        document: nullable(str("Specific document file name (e.g. an exhibit). null for the primary document.")),
        query: str("Phrase to search for inside the document"),
      },
      ["ticker", "accession", "document", "query"],
    ),
    strict: true,
  },
  {
    type: "function",
    name: "search_filings",
    description: "EDGAR full-text search across all SEC filings since 2001. Optionally restrict to one covered company.",
    parameters: obj({ query: str("Search phrase; quote exact phrases"), ticker: nullable(str("Optional covered ticker")) }, ["query", "ticker"]),
    strict: true,
  },
  {
    type: "function",
    name: "get_price_history",
    description: "Daily price history summary for a ticker or ETF/index (e.g. SPY, ^VIX): returns, volatility, drawdown, moving averages and a monthly close series.",
    parameters: obj({ symbol: str("Symbol"), range: { type: "string", enum: ["6mo", "1y", "2y", "5y"] } }, ["symbol", "range"]),
    strict: true,
  },
  {
    type: "function",
    name: "get_quotes",
    description: "Latest quotes (price, day change) for up to 10 symbols.",
    parameters: obj({ symbols: { type: "array", items: { type: "string" } } }, ["symbols"]),
    strict: true,
  },
  {
    type: "function",
    name: "get_insider_trades",
    description: "Form 4 insider transactions for a covered company (open-market purchases/sales, grants, tax withholding).",
    parameters: obj({ ticker: str("Ticker"), open_market_only: { type: "boolean" }, limit: { type: "integer" } }, ["ticker", "open_market_only", "limit"]),
    strict: true,
  },
  {
    type: "function",
    name: "get_macro",
    description:
      "FRED economic series. Known ids include FEDFUNDS, DGS2, DGS10, T10Y2Y, T10Y3M, CPIAUCSL, CPILFESL, PCEPILFE, T5YIE, UNRATE, PAYEMS, ICSA, JTSJOL, A191RL1Q225SBEA, INDPRO, RSAFS, UMCSENT, M2SL, WALCL, BAMLH0A0HYM2, VIXCLS, NFCI, DTWEXBGS, HOUST, MORTGAGE30US.",
    parameters: obj({ series_id: str("FRED series id"), years: { type: "integer", description: "Years of history, 1-30" } }, ["series_id", "years"]),
    strict: true,
  },
  {
    type: "function",
    name: "get_news",
    description: "Recent news headlines (Yahoo Finance) for a ticker or topic.",
    parameters: obj({ query: str("Ticker or topic") }, ["query"]),
    strict: true,
  },
  {
    type: "function",
    name: "web_research",
    description:
      "Search the web (Tavily) for recent news, earnings call coverage, transcripts, investor-relations pages, analyst commentary and industry data. Returns titles, URLs, dates and content snippets. Prefer this over hosted web search for finance topics.",
    parameters: obj(
      {
        query: str("Search query, e.g. 'NVIDIA Q3 FY2027 earnings call gross margin guidance'"),
        topic: { type: "string", enum: ["general", "news", "finance"] },
        days: nullable({ type: "integer", description: "Only results from the last N days (news topic). null for any time." }),
      },
      ["query", "topic", "days"],
    ),
    strict: true,
  },
  {
    type: "function",
    name: "get_earnings_call",
    description:
      "Earnings-call transcript for a covered company, parsed into speaker turns (management, analysts with firms). Pick a quarter (e.g. 'Q3 2026') or null for the latest; give a search phrase to get only the turns that mention it, or a section. Lists the other available quarters.",
    parameters: obj(
      {
        ticker: str("Covered ticker"),
        quarter: nullable(str("Fiscal quarter as named on the call, e.g. 'Q4 2026'; null for the latest")),
        query: nullable(str("Phrase to search for, e.g. 'gross margin' or 'tariff'")),
        section: { type: "string", enum: ["all", "prepared", "qa"] },
      },
      ["ticker", "quarter", "query", "section"],
    ),
    strict: true,
  },
  {
    type: "function",
    name: "read_webpage",
    description:
      "Read the full text of a web page (Firecrawl) as markdown — earnings call transcripts, IR press releases, investor presentations, articles. Give an optional search phrase to return only the passages around it.",
    parameters: obj({ url: str("Full https URL"), query: nullable(str("Optional phrase to focus on")) }, ["url", "query"]),
    strict: true,
  },
  {
    type: "function",
    name: "screen_companies",
    description:
      "Screen all covered companies on TTM fundamentals. Metrics: revenue, grossProfit, operatingIncome, ebitda, netIncome, fcf, cfo, capex, sbc, rnd, buybacks, dividends, epsDiluted, cash, totalDebt, netDebt, equity, grossMargin, operatingMargin, netMargin, fcfMargin, revenueGrowthYoY, revenueCagr3y, revenueCagr5y, epsGrowthYoY, rndIntensity, capexIntensity. Ratios are fractions (0.25 = 25%).",
    parameters: obj(
      {
        filters: { type: "array", items: obj({ metric: str("Metric key"), op: { type: "string", enum: [">", ">=", "<", "<=", "="] }, value: { type: "number" } }, ["metric", "op", "value"]) },
        sector: nullable(str("Optional sector name filter (substring)")),
        sort_by: str("Metric to sort by"),
        descending: { type: "boolean" },
        limit: { type: "integer", description: "1-78" },
        columns: { type: "array", items: { type: "string" }, description: "Metric keys to show" },
      },
      ["filters", "sector", "sort_by", "descending", "limit", "columns"],
    ),
    strict: true,
  },
  {
    type: "function",
    name: "run_code",
    description:
      "Code interpreter: run JavaScript (async function body; use `return` for the result and console.log for output) in an isolated sandbox with no network. `data.universe` is every covered company's TTM fundamentals (same keys as screen_companies, plus ticker, name, sector). `data.companies[TICKER]` holds {income, balance, cashflow, kpis} each as {annual|quarterly: {periods: string[], rows: {metricKey: number[]}}} for the tickers you request. `data.prices[SYMBOL]` is [[date, close], ...] daily for requested symbols (2y). `stats` has mean, median, sum, stdev, cagr(a,b,years), corr(a,b). Use for regressions, DCFs, scenario math, custom screens, aggregations. Return {view: <render_view spec object>} or {views: [...]} to draw computed charts/tables straight into the canvas. 8s limit.",
    parameters: obj(
      {
        code: str("JavaScript function body"),
        tickers: { type: "array", items: { type: "string" }, description: "Covered tickers whose statements to load into data.companies (max 12)" },
        price_symbols: { type: "array", items: { type: "string" }, description: "Symbols whose 2y daily closes to load into data.prices (max 8)" },
        show_in_canvas: { type: "boolean", description: "Also show the code and its output as a view in the canvas (for models and analyses the user should see)" },
        title: str("Short title for the canvas view (empty string if not shown)"),
      },
      ["code", "tickers", "price_symbols", "show_in_canvas", "title"],
    ),
    strict: true,
  },
  {
    type: "function",
    name: "get_alt_data",
    description: "Public alternative data for a covered company (or the newest records across all companies when ticker is null): ownership (13D/13G holders), events (8-K items: deals, M&A, debt, restructuring, impairments, exec changes, restatements, cyber), contracts (USAspending federal obligations by FY + largest awards), regulatory (Federal Register), fda (approvals, recalls), recalls (NHTSA), complaints (CFPB per year), bank (FDIC call-report quarterlies), attention (monthly Wikipedia pageviews). Every row has a source URL — cite it.",
    parameters: obj({ ticker: nullable(str("Covered ticker")), dataset: nullable({ type: "string", enum: ["ownership", "events", "capital", "contracts", "regulatory", "fda", "trials", "recalls", "consumer", "complaints", "bank", "attention"] }), since: nullable(str("Earliest date YYYY-MM-DD")) }, ["ticker", "dataset", "since"]),
    strict: true,
  },
  {
    type: "function",
    name: "get_hedge_fund_data",
    description: "OFR Hedge Fund Monitor (SEC Form PF leverage/borrowing/liquidity/stress tests, CFTC futures positioning by trader type incl. leveraged-fund net positions in S&P, Nasdaq, VIX, Treasuries, FX, crypto; Fed SCOOS dealer survey; FICC sponsored repo). query='overview' returns the crowding composite, key leverage gauges and the most unusual readings; otherwise words to search series names/ids (e.g. 'leveraged net S&P', 'multi strategy leverage'). Returns z-score vs history, percentile, highs/lows, last 8 points and source URL.",
    parameters: obj({ query: str("'overview' or search words") }, ["query"]),
    strict: true,
  },
  {
    type: "function",
    name: "get_treasury_auctions",
    description: "Recent U.S. Treasury note/bond/TIPS/FRN auctions with stop-out yield, bid-to-cover, indirect (foreign) and dealer take-up, each graded strong/average/weak vs the prior six same-tenor auctions.",
    parameters: obj({ term: nullable(str("Tenor like '10-Year', '30-Year', '2-Year'; null for all")) }, ["term"]),
    strict: true,
  },
  {
    type: "function",
    name: "get_promises",
    description: "Management promise tracker for a covered company: forward-looking commitments from its last five earnings calls (verbatim quotes), each graded kept/partial/missed/pending against later calls with the outcome quote, plus a credibility score. Slow on first use (~1 min).",
    parameters: obj({ ticker: str("Covered ticker") }, ["ticker"]),
    strict: true,
  },
  {
    type: "function",
    name: "get_filing_changes",
    description: "Redline of a covered company's latest 10-K vs the prior 10-K (or latest 10-Q vs the same quarter a year earlier): new/removed risk factors and paragraphs, rewritten language in MD&A, legal, controls and notes, ranked by a rule-based materiality score, with the verbatim new and old text and the heading each sits under. Cite as filing:TICKER:ACCESSION with a verbatim phrase.",
    parameters: obj({ ticker: str("Covered ticker"), form: { type: "string", enum: ["10-K", "10-Q"], description: "Annual or quarterly report" } }, ["ticker", "form"]),
    strict: true,
  },
  {
    type: "function",
    name: "get_estimates",
    description: "Sell-side consensus for a covered company: EPS and revenue estimates (avg/low/high, analyst count, growth) for current/next quarter and fiscal year, 7/30/60/90-day EPS revisions, earnings surprise history, rating counts, price targets and recent upgrades/downgrades. Third-party data, not from filings.",
    parameters: obj({ ticker: str("Covered ticker") }, ["ticker"]),
    strict: true,
  },
  {
    type: "function",
    name: "get_alerts",
    description: "The user's watchlist alerts from the last 30 days: material SEC filings, open-market insider trades, new supply-chain links, alt-data events and rule-based setups, newest first.",
    parameters: obj({ ticker: nullable(str("Limit to one ticker; null for all")) }, ["ticker"]),
    strict: true,
  },
  {
    type: "function",
    name: "get_company_dossier",
    description: "One call that joins everything known about a covered company over the last 12 months: filings, open-market insider trades, Form 144 proposed sales, SEC comment letters, alt-data events (13D/G, 8-K items, contracts, FDA, recalls, regulatory), verbatim-verified supply-chain intel, supply links and rule-based trade ideas. Use first for 'what's going on with X' questions, then drill in.",
    parameters: obj({ ticker: str("Covered ticker") }, ["ticker"]),
    strict: true,
  },
  {
    type: "function",
    name: "get_supply_chain",
    description: "Named customers, suppliers, partners and competitors for a covered company from 10-K text (both its own filing and filings that name it), with stated revenue share %, dollar amount, single-source flag, regions, risk and accession.",
    parameters: obj({ ticker: str("Covered ticker"), relation: nullable({ type: "string", enum: ["customer", "supplier", "partner", "competitor"] }) }, ["ticker", "relation"]),
    strict: true,
  },
  {
    type: "function",
    name: "simulate_supply_shock",
    description: "Propagate a demand/output shock at one company through disclosed supply-chain links: suppliers lose sales sized by their disclosed revenue share; customers face supply disruption. Two steps out.",
    parameters: obj({ ticker: str("Ticker to shock"), shock_pct: { type: "number", description: "Size of drop, e.g. 20 for -20%" } }, ["ticker", "shock_pct"]),
    strict: true,
  },
  {
    type: "function",
    name: "navigate_to",
    description:
      "Open a page in the user's Filed Under app (only works in the side-panel assistant). Use when the user asks to show/open/go to something, or when a page would help them see your answer.",
    parameters: obj(
      {
        page: { type: "string", enum: ["dashboard", "company", "financials", "segments", "valuation", "filings", "filing_changes", "reports", "insiders", "calls", "ir", "supply_chain", "ideas", "markets", "macro", "sectors", "research", "theses", "docs", "companies", "hedge_funds", "alt_data"] },
        ticker: nullable(str("Ticker for company pages and supply_chain")),
      },
      ["page", "ticker"],
    ),
    strict: true,
  },
  {
    type: "function",
    name: "get_page_context",
    description: "What the user is looking at right now in the app: URL, page title and visible text. Call this first when the user says 'this', 'here', 'this page' or 'this company'.",
    parameters: obj({}, []),
    strict: true,
  },
  {
    type: "function",
    name: "update_plan",
    description:
      "Publish or revise your working plan and notes (shown live to the user). Call at the start of any multi-step task, and again whenever you learn something that changes the plan, finish a step, or need to restart with a different approach. Keep it short.",
    parameters: obj(
      {
        goal: str("One-line restatement of what the user actually needs"),
        steps: { type: "array", items: obj({ title: str("Step"), status: { type: "string", enum: ["todo", "doing", "done", "dropped"] } }, ["title", "status"]) },
        notes: str("Key findings so far, open questions, contradictions (empty string if none)"),
      },
      ["goal", "steps", "notes"],
    ),
    strict: true,
  },
  {
    type: "function",
    name: "ask_user",
    description:
      "Pause and ask the user a clarifying question when the request is genuinely ambiguous or a choice materially changes the work (ticker, time period, scenario, which of several readings). Offer 2-4 short options. Don't ask what you can find out yourself.",
    parameters: obj({ question: str("The question"), options: { type: "array", items: { type: "string" } } }, ["question", "options"]),
    strict: true,
  },
  {
    type: "function",
    name: "web_map",
    description: "List URLs on a website (sitemap discovery), optionally filtered by a keyword — e.g. find a company's IR press-release or presentation pages before reading them.",
    parameters: obj({ url: str("Site root, e.g. https://investor.nvidia.com"), search: nullable(str("Keyword to rank/filter URLs")) }, ["url", "search"]),
    strict: true,
  },
  {
    type: "function",
    name: "web_crawl",
    description: "Read several pages of one site at once (bounded crawl, max 25 pages, ~45s). Use when the answer is spread across a section of a site. Prefer web_map + read_webpage for targeted reads.",
    parameters: obj({ url: str("Start URL"), limit: { type: "integer", description: "Max pages 1-25" }, include_paths: nullable({ type: "array", items: { type: "string" }, description: "Regex path filters, e.g. ['/news/.*']" }) }, ["url", "limit", "include_paths"]),
    strict: true,
  },
  {
    type: "function",
    name: "web_extract",
    description: "Extract structured data from one web page with a prompt (e.g. 'all contract awards with date, value, counterparty'). Returns JSON. Good for tables, lists and pricing pages.",
    parameters: obj({ url: str("Page URL"), prompt: str("What to extract and in what shape") }, ["url", "prompt"]),
    strict: true,
  },
  {
    type: "function",
    name: "fetch_url",
    description: "Raw HTTP GET of a public URL — JSON/CSV APIs (e.g. data.sec.gov, api.stlouisfed.org, government open-data endpoints), robots, plain text. No JavaScript rendering; use read_webpage for normal pages and PDFs. Pipe large results into run_code by pasting the relevant part.",
    parameters: obj({ url: str("Full https URL") }, ["url"]),
    strict: true,
  },
  // ── On-page agency (side-panel assistant only). Every action carries a short `why`, shown to the user. ──
  {
    type: "function",
    name: "scroll_to",
    description:
      "Scroll the user's page to a section, heading, tab label or phrase so they can see what you are talking about. Use after navigate_to or when the answer refers to something on the current page. Find targets with get_page_context (its outline lists section names).",
    parameters: obj(
      {
        target: str("Section name, heading text, phrase on the page, or a data attribute like data-section=gaps"),
        kind: { type: "string", enum: ["auto", "heading", "text", "section", "selector"], description: "How to match target; auto tries sections/headings, then text" },
        why: str("One short line for the user, e.g. 'Scrolling to Gaps to check the open one at $182'"),
      },
      ["target", "kind", "why"],
    ),
    strict: true,
  },
  {
    type: "function",
    name: "highlight",
    description:
      "Outline the element you are discussing on the user's page, with a short callout label. Scrolls it into view. Several highlights can be on screen; they fade after ~9s. Use it when pointing at a number, row, chart or section.",
    parameters: obj(
      {
        target: str("Section name, heading, or exact phrase/number shown on the page"),
        kind: { type: "string", enum: ["auto", "heading", "text", "section", "selector"] },
        label: str("Callout text, under 80 characters, e.g. 'Open gap $182-$186, unfilled'"),
        why: str("One short line for the user"),
      },
      ["target", "kind", "label", "why"],
    ),
    strict: true,
  },
  {
    type: "function",
    name: "read_section",
    description: "Read the text of one section of the user's current page (the card or block under a heading), in more detail than get_page_context.",
    parameters: obj(
      { target: str("Section name or heading"), kind: { type: "string", enum: ["auto", "heading", "text", "section", "selector"] }, why: str("One short line for the user") },
      ["target", "kind", "why"],
    ),
    strict: true,
  },
  {
    type: "function",
    name: "click",
    description:
      "Press a safe in-app control on the user's page: a tab, a range toggle (1Y/5Y), a chart layer toggle, a segmented control, an expandable row, or an in-app link. Refuses form submits, typing, external links and anything with side effects (delete, buy, share, sign out).",
    parameters: obj({ target: str("Visible label of the control, e.g. 'Quarterly' or '5Y'"), why: str("One short line for the user") }, ["target", "why"]),
    strict: true,
  },
  {
    type: "function",
    name: "show_canvas",
    description: "Open (or close) the wide canvas beside the chat, on a tab: views (dashboards you rendered), browser (live web browsers), files (deliverables).",
    parameters: obj({ open: { type: "boolean" }, tab: { type: "string", enum: ["views", "browser", "files"] }, why: str("One short line for the user") }, ["open", "tab", "why"]),
    strict: true,
  },
  {
    type: "function",
    name: "render_view",
    description:
      "Render a view into the canvas (Datawrapper-style: title, subtitle, source line, data-table toggle). `spec` is a JSON string of ONE view. " +
      "Every view takes optional title, subtitle, source (e.g. 'SEC 10-K filings'), span (1-4 grid columns; default 4 for tables/kpis/candles, 2 for charts). " +
      "Charts with axes take annotations {lines:[{axis:'y',value:0.2,label:'Target'}], points:[{x:'FY24',y:60.9e9,label:'Blackwell ramp'}], ranges:[{axis:'x',from:'2020-03',to:'2020-06',label:'COVID'}]}. Units: $ % x bp ''. " +
      "Types: " +
      "kpis {items:[{label,value,unit,delta,note}]} | " +
      'chart {chart:"line"|"bar"|"area"|"combo"|"stacked"|"stacked100", x:"period", series:[...], data:[{period:"FY24",NVDA:60.9e9}], unit; combo adds lineSeries:[...] (right axis) and rightUnit} | ' +
      'hbar (ranked horizontal bars) {items:[{label,value}], unit, sort:"desc", highlight:["NVDA"]} | ' +
      "scatter {xLabel, yLabel, xUnit, yUnit, points:[{x,y,label,size,group}], regression:true} | " +
      "histogram {values:[...], bins, unit} | " +
      'heatmap (e.g. monthly returns by year) {rows:["2024","2025"], cols:["Jan",...], values:[[0.02,null,...]], unit:"%", diverging:true} | ' +
      'waterfall (bridge) {steps:[{label:"FY25 EBIT",value:100,total:true},{label:"Price",value:12},{label:"FY26 EBIT",value:112,total:true}], unit} | ' +
      'sparktable {columns:[{key:"t",label:"Ticker",kind:"text"},{key:"px",label:"1Y",kind:"spark"},{key:"ret",label:"1Y return",kind:"delta"},{key:"pe",label:"P/E",kind:"x"}], rows:[{t:"NVDA",px:[...closes],ret:0.42,pe:48}]} (kinds: text num $ % x spark delta) | ' +
      'candles {bars:[{t:"2026-11-02",o,h,l,c,v}], overlays:[{name:"SMA50",values:[...same length as bars]}], bands:[{from:180,to:186,label:"Open gap"}], events:[{t,label}]} | ' +
      "treemap {items:[{label,value,group,change}]} | donut (2-6 parts only) {parts:[{label,value}]} | " +
      'multiples (one small chart per item) {chart:"line"|"bar"|"area", items:[{title:"NVDA",data:[{x,y}]}], sharedY} | ' +
      'timeline {events:[{date,label,detail,tone:"positive"|"negative"|"neutral"}]} | cards (side-by-side comparison, 2-4) {items:[{title,subtitle,metrics:[{label,value,unit,delta}]}]} | ' +
      'mermaid (flowchart/sequence/org diagrams) {code:"flowchart LR\\n  A[Supplier] --> B[NVDA]"} | graph (network) {nodes:[{id,label,group}], edges:[{from,to,label,weight}], directed} | ' +
      "table {columns, rows} | note {markdown} | code {code, stdout, result} | image {src, caption} | file {fileId} | " +
      "dashboard {title, sections:[{heading, columns:1-4, items:[views with span]}]} or {tabs:[{label, sections:[...]}]}: a full layout such as a KPI row, then a 2-up, then a full-width table. " +
      "Use only numbers from tool outputs; deltas and % values as fractions (0.12 = 12%); values full, not pre-scaled. Pick the chart that fits: trend → line, composition → stacked or treemap, ranking → hbar, relationship → scatter, distribution → histogram, bridge → waterfall, price action → candles. " +
      "A rejected spec comes back as an error with a fix hint: correct it and call render_view once more. The result includes a self-check; fix reported problems.",
    parameters: obj({ spec: str("JSON string of one view spec"), why: str("One short line for the user") }, ["spec", "why"]),
    strict: true,
  },
  {
    type: "function",
    name: "create_file",
    description:
      "Make a downloadable file for the user, shown as a file card in the canvas: csv or xlsx (columns + rows), md (content = markdown), json (content = JSON text, or columns + rows). Use for tables, models, memos and data the user wants to keep.",
    parameters: obj(
      {
        format: { type: "string", enum: ["csv", "xlsx", "md", "json"] },
        name: str("File name without extension, e.g. 'semis-rnd-intensity'"),
        columns: nullable({ type: "array", items: { type: "string" }, description: "Header row (csv/xlsx/json-from-rows)" }),
        rows: nullable({ type: "array", items: { type: "array", items: { type: ["string", "number", "boolean", "null"] } }, description: "Data rows, same length as columns" }),
        content: nullable(str("Markdown or JSON text")),
        why: str("One short line for the user"),
      },
      ["format", "name", "columns", "rows", "content", "why"],
    ),
    strict: true,
  },
  {
    type: "function",
    name: "browser_task",
    description:
      "Start real web browsers (Browser Use cloud agents) that click, scroll, log through multi-page sites, fill search boxes, download files and take screenshots. Up to 4 run in parallel, each with its own goal. Use when read_webpage/web_extract can't do it: interactive sites, JS apps, paginated tables, downloading reports/CSVs, visual checks. The user watches them live in the canvas. Returns task ids; then poll browser_status until done.",
    parameters: obj(
      {
        tasks: {
          type: "array",
          items: obj(
            { goal: str("Concrete goal with what to return, e.g. 'On investor.nvidia.com find the latest 10-Q PDF, download it and report its filing date'"), start_url: nullable(str("Optional URL to start at")), screenshot: { type: "boolean", description: "Save a screenshot of the most relevant page" } },
            ["goal", "start_url", "screenshot"],
          ),
        },
        mode: { type: "string", enum: ["fast", "thorough"], description: "fast for simple lookups; thorough for long, multi-step work" },
        why: str("One short line for the user"),
      },
      ["tasks", "mode", "why"],
    ),
    strict: true,
  },
  {
    type: "function",
    name: "browser_status",
    description: "Progress of browser tasks: status, current page, recent steps, extracted text and the final result when done. Waits up to ~25s for progress before returning.",
    parameters: obj({ task_ids: { type: "array", items: { type: "string" } }, why: str("One short line for the user") }, ["task_ids", "why"]),
    strict: true,
  },
  {
    type: "function",
    name: "browser_files",
    description: "List files a browser task downloaded or saved (screenshots, PDFs, CSVs) and add them to the canvas as file cards. Text files are returned inline (truncated).",
    parameters: obj({ task_id: str("Browser task id"), why: str("One short line for the user") }, ["task_id", "why"]),
    strict: true,
  },
  {
    type: "function",
    name: "browser_stop",
    description: "Stop a running browser task.",
    parameters: obj({ task_id: str("Browser task id"), why: str("One short line for the user") }, ["task_id", "why"]),
    strict: true,
  },
] as const;

export type ToolName = (typeof TOOL_DEFS)[number]["name"];

export const TOOL_LABELS: Record<string, string> = {
  get_coverage: "Checked coverage",
  get_financials: "Pulled financials",
  get_segments: "Pulled segments",
  list_filings: "Listed filings",
  read_filing: "Read filing",
  search_filings: "Searched EDGAR",
  get_price_history: "Analyzed prices",
  get_quotes: "Fetched quotes",
  get_insider_trades: "Pulled insider trades",
  get_macro: "Pulled FRED series",
  get_news: "Read headlines",
  web_search: "Searched the web",
  web_research: "Researched the web",
  read_webpage: "Read web page",
  get_earnings_call: "Read earnings call",
  screen_companies: "Screened companies",
  run_code: "Ran code",
  get_alt_data: "Read alt data",
  get_supply_chain: "Mapped supply chain",
  get_hedge_fund_data: "Read hedge fund data",
  get_treasury_auctions: "Read Treasury auctions",
  get_promises: "Check management promises",
  get_alerts: "Read watchlist alerts",
  get_estimates: "Read analyst estimates",
  get_filing_changes: "Compared filings",
  get_company_dossier: "Built company dossier",
  simulate_supply_shock: "Simulated shock",
  navigate_to: "Opened page",
  get_page_context: "Read your screen",
  update_plan: "Planned",
  ask_user: "Asked you",
  web_map: "Mapped site",
  web_crawl: "Crawled site",
  web_extract: "Extracted data",
  fetch_url: "Fetched URL",
  scroll_to: "Scrolled",
  highlight: "Highlighted",
  read_section: "Read section",
  click: "Pressed",
  show_canvas: "Opened canvas",
  render_view: "Rendered view",
  create_file: "Created file",
  browser_task: "Started browser",
  browser_status: "Checked browser",
  browser_files: "Collected files",
  browser_stop: "Stopped browser",
  reasoning: "Thought",
};

/** Present-tense labels for running tools. */
export const TOOL_RUNNING: Record<string, string> = {
  get_coverage: "Checking coverage",
  get_financials: "Pulling financials",
  get_segments: "Pulling segments",
  list_filings: "Listing filings",
  read_filing: "Reading filing",
  search_filings: "Searching EDGAR",
  get_price_history: "Analyzing prices",
  get_quotes: "Fetching quotes",
  get_insider_trades: "Pulling insider trades",
  get_macro: "Pulling FRED series",
  get_news: "Reading headlines",
  web_search: "Searching the web",
  web_research: "Researching the web",
  read_webpage: "Reading web page",
  get_earnings_call: "Reading earnings call",
  screen_companies: "Screening companies",
  run_code: "Running code",
  get_alt_data: "Reading alt data",
  get_supply_chain: "Mapping supply chain",
  get_hedge_fund_data: "Reading hedge fund data",
  get_treasury_auctions: "Reading Treasury auctions",
  get_promises: "Checking management promises",
  get_alerts: "Reading watchlist alerts",
  get_estimates: "Reading analyst estimates",
  get_filing_changes: "Comparing filings",
  get_company_dossier: "Building company dossier",
  simulate_supply_shock: "Simulating shock",
  navigate_to: "Opening page",
  get_page_context: "Reading your screen",
  ask_user: "Waiting for you",
  web_map: "Mapping site",
  web_crawl: "Crawling site",
  web_extract: "Extracting data",
  fetch_url: "Fetching URL",
  scroll_to: "Scrolling",
  highlight: "Highlighting",
  read_section: "Reading section",
  click: "Pressing",
  show_canvas: "Opening canvas",
  render_view: "Rendering view",
  create_file: "Creating file",
  browser_task: "Starting browser",
  browser_status: "Browsing",
  browser_files: "Collecting files",
  browser_stop: "Stopping browser",
};

/** Plural nouns for grouped finished calls: "Read 4 web pages". */
export const TOOL_GROUP: Record<string, [string, string]> = {
  read_webpage: ["Read", "web pages"],
  read_filing: ["Read", "filings"],
  get_financials: ["Pulled financials for", "companies"],
  get_price_history: ["Analyzed", "price histories"],
  web_research: ["Ran", "web searches"],
  web_search: ["Ran", "web searches"],
  web_extract: ["Extracted", "pages"],
  fetch_url: ["Fetched", "URLs"],
  highlight: ["Highlighted", "items"],
  scroll_to: ["Scrolled to", "sections"],
  render_view: ["Rendered", "views"],
  create_file: ["Created", "files"],
  browser_status: ["Checked browsers", "times"],
  run_code: ["Ran code", "times"],
  get_earnings_call: ["Read", "earnings calls"],
  read_section: ["Read", "sections"],
};
