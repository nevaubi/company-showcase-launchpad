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
};
