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
      "Code interpreter: run JavaScript (async function body; use `return` for the result and console.log for output) in an isolated sandbox with no network. `data.universe` is every covered company's TTM fundamentals (same keys as screen_companies, plus ticker, name, sector). `data.companies[TICKER]` holds {income, balance, cashflow, kpis} each as {annual|quarterly: {periods: string[], rows: {metricKey: number[]}}} for the tickers you request. `data.prices[SYMBOL]` is [[date, close], ...] daily for requested symbols (2y). `stats` has mean, median, sum, stdev, cagr(a,b,years), corr(a,b). Use for regressions, DCFs, scenario math, custom screens, aggregations. 8s limit.",
    parameters: obj(
      {
        code: str("JavaScript function body"),
        tickers: { type: "array", items: { type: "string" }, description: "Covered tickers whose statements to load into data.companies (max 12)" },
        price_symbols: { type: "array", items: { type: "string" }, description: "Symbols whose 2y daily closes to load into data.prices (max 8)" },
      },
      ["code", "tickers", "price_symbols"],
    ),
    strict: true,
  },
  {
    type: "function",
    name: "get_alt_data",
    description: "Public alternative data for a covered company (or the newest records across all companies when ticker is null): ownership (13D/13G holders), events (8-K items: deals, M&A, debt, restructuring, impairments, exec changes, restatements, cyber), contracts (USAspending federal obligations by FY + largest awards), regulatory (Federal Register), fda (approvals, recalls), recalls (NHTSA), complaints (CFPB per year), bank (FDIC call-report quarterlies), attention (monthly Wikipedia pageviews). Every row has a source URL — cite it.",
    parameters: obj({ ticker: nullable(str("Covered ticker")), dataset: nullable({ type: "string", enum: ["ownership", "events", "contracts", "regulatory", "fda", "recalls", "complaints", "bank", "attention"] }), since: nullable(str("Earliest date YYYY-MM-DD")) }, ["ticker", "dataset", "since"]),
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
    description: "One call that joins everything known about a covered company over the last 12 months: filings, open-market insider trades, alt-data events (13D/G, 8-K items, contracts, FDA, recalls, regulatory), verbatim-verified supply-chain intel, supply links and rule-based trade ideas. Use first for 'what's going on with X' questions, then drill in.",
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
        page: { type: "string", enum: ["dashboard", "company", "financials", "segments", "valuation", "filings", "insiders", "calls", "ir", "supply_chain", "ideas", "markets", "macro", "sectors", "research", "theses", "docs", "all_insiders", "companies", "hedge_funds", "alt_data"] },
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
  get_company_dossier: "Built company dossier",
  simulate_supply_shock: "Simulated shock",
  navigate_to: "Opened page",
  get_page_context: "Read your screen",
};
