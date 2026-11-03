// Coverage universe and reference series. Company facts come from SEC filings;
// the fields here are descriptive metadata that EDGAR does not publish.

export interface CoverageCompany {
  ticker: string;
  cik: string;
  shortName: string;
  sector: string;
  industry: string;
  sectorEtf: string;
  website: string;
  ir: string;
  founded: number;
  description: string;
  peers: string[];
}

export const COVERAGE: CoverageCompany[] = [
  {
    ticker: "AAPL",
    cik: "320193",
    shortName: "Apple",
    sector: "Information Technology",
    industry: "Technology Hardware, Storage & Peripherals",
    sectorEtf: "XLK",
    website: "https://www.apple.com",
    ir: "https://investor.apple.com",
    founded: 1976,
    description:
      "Designs and sells iPhone, Mac, iPad and wearables, and runs a fast-growing services business spanning the App Store, iCloud, Apple Music, AppleCare, advertising and payments.",
    peers: ["MSFT", "GOOGL", "AMZN"],
  },
  {
    ticker: "MSFT",
    cik: "789019",
    shortName: "Microsoft",
    sector: "Information Technology",
    industry: "Systems Software",
    sectorEtf: "XLK",
    website: "https://www.microsoft.com",
    ir: "https://www.microsoft.com/en-us/investor",
    founded: 1975,
    description:
      "Software and cloud platform company reporting three segments: Productivity and Business Processes (Microsoft 365, LinkedIn, Dynamics), Intelligent Cloud (Azure, server products) and More Personal Computing (Windows, Xbox, Surface, search).",
    peers: ["AAPL", "GOOGL", "AMZN", "NVDA"],
  },
  {
    ticker: "NVDA",
    cik: "1045810",
    shortName: "NVIDIA",
    sector: "Information Technology",
    industry: "Semiconductors",
    sectorEtf: "XLK",
    website: "https://www.nvidia.com",
    ir: "https://investor.nvidia.com",
    founded: 1993,
    description:
      "Accelerated computing company whose GPUs, networking and software platforms (CUDA) power AI data centers, gaming PCs, professional visualization and automotive systems.",
    peers: ["MSFT", "GOOGL", "AMZN"],
  },
  {
    ticker: "AMZN",
    cik: "1018724",
    shortName: "Amazon",
    sector: "Consumer Discretionary",
    industry: "Broadline Retail",
    sectorEtf: "XLY",
    website: "https://www.amazon.com",
    ir: "https://ir.aboutamazon.com",
    founded: 1994,
    description:
      "Operates the world's largest online marketplace and Amazon Web Services, reporting North America, International and AWS segments, with growing advertising and subscription revenue.",
    peers: ["MSFT", "GOOGL", "AAPL"],
  },
  {
    ticker: "GOOGL",
    cik: "1652044",
    shortName: "Alphabet",
    sector: "Communication Services",
    industry: "Interactive Media & Services",
    sectorEtf: "XLC",
    website: "https://abc.xyz",
    ir: "https://abc.xyz/investor",
    founded: 1998,
    description:
      "Parent of Google. Generates most revenue from Search, YouTube and network advertising, alongside Google Cloud, subscriptions and devices, and invests in Other Bets such as Waymo.",
    peers: ["MSFT", "AMZN", "AAPL"],
  },
  {
    ticker: "TSLA",
    cik: "1318605",
    shortName: "Tesla",
    sector: "Consumer Discretionary",
    industry: "Automobile Manufacturers",
    sectorEtf: "XLY",
    website: "https://www.tesla.com",
    ir: "https://ir.tesla.com",
    founded: 2003,
    description:
      "Designs and manufactures electric vehicles, and sells energy generation and storage products such as Megapack and Powerwall, plus services including Supercharging and software.",
    peers: ["AMZN", "NVDA", "AAPL"],
  },
];

export const COVERAGE_TICKERS = COVERAGE.map((c) => c.ticker);
export const coverageOf = (ticker: string) => COVERAGE.find((c) => c.ticker === ticker.toUpperCase());

export interface Benchmark {
  symbol: string;
  name: string;
  group: "index" | "sector" | "macro";
  sector?: string;
}

export const BENCHMARKS: Benchmark[] = [
  { symbol: "SPY", name: "S&P 500 (SPY)", group: "index" },
  { symbol: "QQQ", name: "Nasdaq-100 (QQQ)", group: "index" },
  { symbol: "DIA", name: "Dow Jones (DIA)", group: "index" },
  { symbol: "IWM", name: "Russell 2000 (IWM)", group: "index" },
  { symbol: "^VIX", name: "CBOE Volatility Index", group: "macro" },
  { symbol: "TLT", name: "20+ Yr Treasury (TLT)", group: "macro" },
  { symbol: "GLD", name: "Gold (GLD)", group: "macro" },
  { symbol: "USO", name: "Crude Oil (USO)", group: "macro" },
  { symbol: "UUP", name: "US Dollar (UUP)", group: "macro" },
  { symbol: "XLK", name: "Technology", group: "sector", sector: "Information Technology" },
  { symbol: "XLC", name: "Communication Services", group: "sector", sector: "Communication Services" },
  { symbol: "XLY", name: "Consumer Discretionary", group: "sector", sector: "Consumer Discretionary" },
  { symbol: "XLP", name: "Consumer Staples", group: "sector", sector: "Consumer Staples" },
  { symbol: "XLF", name: "Financials", group: "sector", sector: "Financials" },
  { symbol: "XLV", name: "Health Care", group: "sector", sector: "Health Care" },
  { symbol: "XLI", name: "Industrials", group: "sector", sector: "Industrials" },
  { symbol: "XLE", name: "Energy", group: "sector", sector: "Energy" },
  { symbol: "XLB", name: "Materials", group: "sector", sector: "Materials" },
  { symbol: "XLU", name: "Utilities", group: "sector", sector: "Utilities" },
  { symbol: "XLRE", name: "Real Estate", group: "sector", sector: "Real Estate" },
  { symbol: "SMH", name: "Semiconductors (SMH)", group: "sector", sector: "Semiconductors" },
];

export const ALL_SYMBOLS = [...COVERAGE_TICKERS, ...BENCHMARKS.map((b) => b.symbol)];

export interface MacroDef {
  id: string;
  title: string;
  units: string;
  frequency: string;
  since: string;
  group: "rates" | "inflation" | "labor" | "growth" | "liquidity" | "risk" | "housing" | "curve";
  transform?: "yoy" | "diff";
  source: string;
}

const fred = (id: string) => `https://fred.stlouisfed.org/series/${id}`;

export const MACRO_SERIES: MacroDef[] = [
  { id: "FEDFUNDS", title: "Effective federal funds rate", units: "%", frequency: "Monthly", since: "1990-01-01", group: "rates", source: fred("FEDFUNDS") },
  { id: "DGS2", title: "2-year Treasury yield", units: "%", frequency: "Daily", since: "2005-01-01", group: "rates", source: fred("DGS2") },
  { id: "DGS10", title: "10-year Treasury yield", units: "%", frequency: "Daily", since: "2005-01-01", group: "rates", source: fred("DGS10") },
  { id: "T10Y2Y", title: "10Y minus 2Y Treasury spread", units: "pp", frequency: "Daily", since: "2005-01-01", group: "rates", source: fred("T10Y2Y") },
  { id: "T10Y3M", title: "10Y minus 3M Treasury spread", units: "pp", frequency: "Daily", since: "2005-01-01", group: "rates", source: fred("T10Y3M") },
  { id: "MORTGAGE30US", title: "30-year fixed mortgage rate", units: "%", frequency: "Weekly", since: "2000-01-01", group: "housing", source: fred("MORTGAGE30US") },
  { id: "CPIAUCSL", title: "CPI, all items", units: "Index 1982-84=100", frequency: "Monthly", since: "1990-01-01", group: "inflation", transform: "yoy", source: fred("CPIAUCSL") },
  { id: "CPILFESL", title: "Core CPI (ex food & energy)", units: "Index 1982-84=100", frequency: "Monthly", since: "1990-01-01", group: "inflation", transform: "yoy", source: fred("CPILFESL") },
  { id: "PCEPILFE", title: "Core PCE price index", units: "Index 2017=100", frequency: "Monthly", since: "1990-01-01", group: "inflation", transform: "yoy", source: fred("PCEPILFE") },
  { id: "T5YIE", title: "5-year breakeven inflation", units: "%", frequency: "Daily", since: "2005-01-01", group: "inflation", source: fred("T5YIE") },
  { id: "UNRATE", title: "Unemployment rate", units: "%", frequency: "Monthly", since: "1990-01-01", group: "labor", source: fred("UNRATE") },
  { id: "PAYEMS", title: "Nonfarm payrolls", units: "Thousands of persons", frequency: "Monthly", since: "1990-01-01", group: "labor", transform: "diff", source: fred("PAYEMS") },
  { id: "ICSA", title: "Initial jobless claims", units: "Claims", frequency: "Weekly", since: "2000-01-01", group: "labor", source: fred("ICSA") },
  { id: "JTSJOL", title: "Job openings (JOLTS)", units: "Thousands", frequency: "Monthly", since: "2001-01-01", group: "labor", source: fred("JTSJOL") },
  { id: "A191RL1Q225SBEA", title: "Real GDP growth (SAAR)", units: "% q/q annualized", frequency: "Quarterly", since: "1990-01-01", group: "growth", source: fred("A191RL1Q225SBEA") },
  { id: "INDPRO", title: "Industrial production", units: "Index 2017=100", frequency: "Monthly", since: "1990-01-01", group: "growth", transform: "yoy", source: fred("INDPRO") },
  { id: "RSAFS", title: "Retail sales", units: "Millions of dollars", frequency: "Monthly", since: "1992-01-01", group: "growth", transform: "yoy", source: fred("RSAFS") },
  { id: "UMCSENT", title: "Consumer sentiment (UMich)", units: "Index 1966:Q1=100", frequency: "Monthly", since: "1990-01-01", group: "growth", source: fred("UMCSENT") },
  { id: "M2SL", title: "M2 money supply", units: "Billions of dollars", frequency: "Monthly", since: "1990-01-01", group: "liquidity", transform: "yoy", source: fred("M2SL") },
  { id: "WALCL", title: "Fed balance sheet (total assets)", units: "Millions of dollars", frequency: "Weekly", since: "2003-01-01", group: "liquidity", source: fred("WALCL") },
  { id: "BAMLH0A0HYM2", title: "High-yield credit spread (OAS)", units: "%", frequency: "Daily", since: "2005-01-01", group: "risk", source: fred("BAMLH0A0HYM2") },
  { id: "VIXCLS", title: "VIX", units: "Index", frequency: "Daily", since: "2005-01-01", group: "risk", source: fred("VIXCLS") },
  { id: "NFCI", title: "Chicago Fed financial conditions", units: "Index", frequency: "Weekly", since: "2000-01-01", group: "risk", source: fred("NFCI") },
  { id: "DTWEXBGS", title: "Trade-weighted US dollar", units: "Index Jan 2006=100", frequency: "Daily", since: "2006-01-01", group: "risk", source: fred("DTWEXBGS") },
  { id: "HOUST", title: "Housing starts", units: "Thousands of units (SAAR)", frequency: "Monthly", since: "1990-01-01", group: "housing", source: fred("HOUST") },
  { id: "USREC", title: "NBER recession indicator", units: "0/1", frequency: "Monthly", since: "1990-01-01", group: "growth", source: fred("USREC") },
  { id: "DGS1MO", title: "1-month Treasury", units: "%", frequency: "Daily", since: "2022-01-01", group: "curve", source: fred("DGS1MO") },
  { id: "DGS3MO", title: "3-month Treasury", units: "%", frequency: "Daily", since: "2022-01-01", group: "curve", source: fred("DGS3MO") },
  { id: "DGS6MO", title: "6-month Treasury", units: "%", frequency: "Daily", since: "2022-01-01", group: "curve", source: fred("DGS6MO") },
  { id: "DGS1", title: "1-year Treasury", units: "%", frequency: "Daily", since: "2022-01-01", group: "curve", source: fred("DGS1") },
  { id: "DGS3", title: "3-year Treasury", units: "%", frequency: "Daily", since: "2022-01-01", group: "curve", source: fred("DGS3") },
  { id: "DGS5", title: "5-year Treasury", units: "%", frequency: "Daily", since: "2022-01-01", group: "curve", source: fred("DGS5") },
  { id: "DGS7", title: "7-year Treasury", units: "%", frequency: "Daily", since: "2022-01-01", group: "curve", source: fred("DGS7") },
  { id: "DGS20", title: "20-year Treasury", units: "%", frequency: "Daily", since: "2022-01-01", group: "curve", source: fred("DGS20") },
  { id: "DGS30", title: "30-year Treasury", units: "%", frequency: "Daily", since: "2022-01-01", group: "curve", source: fred("DGS30") },
];

export const CURVE_TENORS: { id: string; label: string; years: number }[] = [
  { id: "DGS1MO", label: "1M", years: 1 / 12 },
  { id: "DGS3MO", label: "3M", years: 0.25 },
  { id: "DGS6MO", label: "6M", years: 0.5 },
  { id: "DGS1", label: "1Y", years: 1 },
  { id: "DGS2", label: "2Y", years: 2 },
  { id: "DGS3", label: "3Y", years: 3 },
  { id: "DGS5", label: "5Y", years: 5 },
  { id: "DGS7", label: "7Y", years: 7 },
  { id: "DGS10", label: "10Y", years: 10 },
  { id: "DGS20", label: "20Y", years: 20 },
  { id: "DGS30", label: "30Y", years: 30 },
];
