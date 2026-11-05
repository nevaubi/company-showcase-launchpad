// Coverage universe and reference series. Company facts come from SEC filings;
// the fields here are descriptive metadata that EDGAR does not publish.
import { CURATED_GROUPS, EXTRA_COVERAGE } from "./coverage-extra";

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
  /** Industry group shared across the whole universe (partner taxonomy), for peer grouping */
  group?: string;
}

/** Hand-curated companies; their datasets are bundled under public/data. */
export const CURATED_COVERAGE: CoverageCompany[] = [
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
    peers: ["MSFT", "GOOGL", "AMZN", "QCOM"],
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
  co("META", "1326801", "Meta", "Communication Services", "Interactive Media & Services", "XLC", "https://about.meta.com", "https://investor.atmeta.com", 2004,
    "Runs Facebook, Instagram, WhatsApp and Messenger, monetized mainly through advertising (Family of Apps), and invests heavily in AI infrastructure and Reality Labs (VR/AR hardware).",
    ["GOOGL", "NFLX", "AMZN", "MSFT"]),
  co("AVGO", "1730168", "Broadcom", "Information Technology", "Semiconductors", "XLK", "https://www.broadcom.com", "https://investors.broadcom.com", 1961,
    "Designs custom AI accelerators, networking and broadband semiconductors, and sells infrastructure software (VMware, mainframe, security) to large enterprises.",
    ["NVDA", "AMD", "QCOM", "TXN"]),
  co("AMD", "2488", "AMD", "Information Technology", "Semiconductors", "XLK", "https://www.amd.com", "https://ir.amd.com", 1969,
    "Designs CPUs (Ryzen, EPYC), Instinct data-center GPUs, adaptive chips (Xilinx) and semi-custom game-console silicon, reporting Data Center, Client, Gaming and Embedded segments.",
    ["NVDA", "INTC", "AVGO", "MU", "QCOM"]),
  co("ORCL", "1341439", "Oracle", "Information Technology", "Application Software", "XLK", "https://www.oracle.com", "https://investor.oracle.com", 1977,
    "Sells database and enterprise application software and Oracle Cloud Infrastructure (OCI), with a large backlog of AI training and inference capacity contracts.",
    ["MSFT", "CRM", "IBM", "NOW"]),
  co("JPM", "19617", "JPMorgan Chase", "Financials", "Diversified Banks", "XLF", "https://www.jpmorganchase.com", "https://www.jpmorganchase.com/ir", 1799,
    "Largest US bank by assets, reporting Consumer & Community Banking, Commercial & Investment Bank, and Asset & Wealth Management.",
    ["BAC", "WFC", "C", "GS", "MS"]),
  co("BAC", "70858", "Bank of America", "Financials", "Diversified Banks", "XLF", "https://www.bankofamerica.com", "https://investor.bankofamerica.com", 1904,
    "US bank serving consumers, small businesses and corporations through Consumer Banking, Global Wealth & Investment Management (Merrill), Global Banking and Global Markets.",
    ["JPM", "WFC", "C", "GS"]),
  co("GS", "886982", "Goldman Sachs", "Financials", "Investment Banking & Brokerage", "XLF", "https://www.goldmansachs.com", "https://www.goldmansachs.com/investor-relations", 1869,
    "Investment bank reporting Global Banking & Markets (advisory, underwriting, trading) and Asset & Wealth Management, plus Platform Solutions.",
    ["MS", "JPM", "BAC", "SCHW"]),
  co("V", "1403161", "Visa", "Financials", "Transaction & Payment Processing Services", "XLF", "https://www.visa.com", "https://investor.visa.com", 1958,
    "Operates the world's largest card payments network, earning service, data processing and international transaction fees on purchase volume.",
    ["MA", "AXP", "JPM", "SPGI"]),
  co("MA", "1141391", "Mastercard", "Financials", "Transaction & Payment Processing Services", "XLF", "https://www.mastercard.com", "https://investor.mastercard.com", 1966,
    "Runs a global card payments network and sells value-added services (cyber, data analytics, loyalty) to issuers, merchants and governments.",
    ["V", "AXP", "JPM", "SPGI"]),
  co("LLY", "59478", "Eli Lilly", "Health Care", "Pharmaceuticals", "XLV", "https://www.lilly.com", "https://investor.lilly.com", 1876,
    "Pharmaceutical company whose GLP-1 incretin medicines (Mounjaro, Zepbound) for diabetes and obesity drive growth, alongside oncology, immunology and neuroscience drugs.",
    ["MRK", "ABBV", "AMGN", "JNJ", "PFE"]),
  co("UNH", "731766", "UnitedHealth", "Health Care", "Managed Health Care", "XLV", "https://www.unitedhealthgroup.com", "https://www.unitedhealthgroup.com/investors.html", 1977,
    "Largest US health insurer (UnitedHealthcare) and health services company (Optum Health, Optum Insight, Optum Rx).",
    ["LLY", "JNJ", "MRK", "ABT"]),
  co("JNJ", "200406", "Johnson & Johnson", "Health Care", "Pharmaceuticals", "XLV", "https://www.jnj.com", "https://www.investor.jnj.com", 1886,
    "Health care company reporting Innovative Medicine (oncology, immunology, neuroscience) and MedTech (surgery, orthopaedics, cardiovascular, vision).",
    ["MRK", "PFE", "ABT", "LLY"]),
  co("MRK", "310158", "Merck", "Health Care", "Pharmaceuticals", "XLV", "https://www.merck.com", "https://www.merck.com/investor-relations", 1891,
    "Pharmaceutical company led by cancer immunotherapy Keytruda and the Gardasil HPV vaccine, with a separate Animal Health segment.",
    ["LLY", "PFE", "ABBV", "JNJ"]),
  co("WMT", "104169", "Walmart", "Consumer Staples", "Consumer Staples Merchandise Retail", "XLP", "https://corporate.walmart.com", "https://stock.walmart.com", 1962,
    "World's largest retailer, reporting Walmart U.S., Walmart International and Sam's Club, with growing e-commerce, advertising and membership income.",
    ["COST", "AMZN", "HD", "PG"]),
  co("COST", "909832", "Costco", "Consumer Staples", "Consumer Staples Merchandise Retail", "XLP", "https://www.costco.com", "https://investor.costco.com", 1983,
    "Membership warehouse club operator; membership fees provide most operating profit while merchandise is sold at low markups.",
    ["WMT", "AMZN", "PG"]),
  co("XOM", "34088", "ExxonMobil", "Energy", "Integrated Oil & Gas", "XLE", "https://corporate.exxonmobil.com", "https://investor.exxonmobil.com", 1870,
    "Integrated oil and gas company reporting Upstream, Energy Products, Chemical Products and Specialty Products, with major Permian and Guyana production.",
    ["CVX", "COP", "SLB"]),
  co("CVX", "93410", "Chevron", "Energy", "Integrated Oil & Gas", "XLE", "https://www.chevron.com", "https://www.chevron.com/investors", 1879,
    "Integrated energy company reporting Upstream and Downstream segments, with Permian, Tengiz and (after acquiring Hess) Guyana assets.",
    ["XOM", "COP", "SLB"]),
  co("CAT", "18230", "Caterpillar", "Industrials", "Construction Machinery & Heavy Transportation Equipment", "XLI", "https://www.caterpillar.com", "https://investors.caterpillar.com", 1925,
    "Largest maker of construction and mining equipment, engines and turbines, reporting Construction Industries, Resource Industries, Energy & Transportation and Financial Products.",
    ["DE", "HON", "GE", "UNP"]),
  co("HD", "354950", "Home Depot", "Consumer Discretionary", "Home Improvement Retail", "XLY", "https://corporate.homedepot.com", "https://ir.homedepot.com", 1978,
    "Largest US home improvement retailer, serving DIY customers and professional contractors (expanded through the SRS Distribution acquisition).",
    ["LOW", "WMT", "COST"]),

  // ---- Information Technology ----
  co("CRM", "1108524", "Salesforce", "Information Technology", "Application Software", "XLK", "https://www.salesforce.com", "https://investor.salesforce.com", 1999,
    "Cloud CRM leader selling Sales, Service, Marketing and Commerce clouds, the Data Cloud, Slack, Tableau and MuleSoft, with Agentforce AI agents layered on top.",
    ["NOW", "ADBE", "ORCL", "MSFT"]),
  co("ADBE", "796343", "Adobe", "Information Technology", "Application Software", "XLK", "https://www.adobe.com", "https://www.adobe.com/investor-relations.html", 1982,
    "Sells creative software (Photoshop, Illustrator, Premiere, Firefly generative AI), Acrobat and Document Cloud, and the Experience Cloud marketing suite, mostly by subscription.",
    ["CRM", "NOW", "MSFT"]),
  co("NOW", "1373715", "ServiceNow", "Information Technology", "Systems Software", "XLK", "https://www.servicenow.com", "https://investors.servicenow.com", 2004,
    "Subscription workflow platform for IT service management, IT operations, HR, customer service and security operations, sold to large enterprises and governments.",
    ["CRM", "ADBE", "MSFT"]),
  co("CSCO", "858877", "Cisco", "Information Technology", "Communications Equipment", "XLK", "https://www.cisco.com", "https://investor.cisco.com", 1984,
    "Largest maker of enterprise networking equipment (switches, routers, wireless) and a growing software business in security and observability (Splunk).",
    ["AVGO", "IBM", "ORCL"]),
  co("IBM", "51143", "IBM", "Information Technology", "IT Consulting & Other Services", "XLK", "https://www.ibm.com", "https://www.ibm.com/investor", 1911,
    "Hybrid-cloud and AI company reporting Software (Red Hat, automation, data), Consulting, Infrastructure (IBM Z mainframes, storage) and Financing.",
    ["MSFT", "ORCL", "CSCO"]),
  co("INTC", "50863", "Intel", "Information Technology", "Semiconductors", "XLK", "https://www.intel.com", "https://www.intc.com", 1968,
    "Designs and manufactures x86 processors for PCs and data centers and is building a contract chip-manufacturing business (Intel Foundry).",
    ["AMD", "NVDA", "TXN"]),
  co("QCOM", "804328", "Qualcomm", "Information Technology", "Semiconductors", "XLK", "https://www.qualcomm.com", "https://investor.qualcomm.com", 1985,
    "Designs Snapdragon chips for smartphones, PCs, autos and IoT (QCT) and licenses its cellular patent portfolio to device makers (QTL).",
    ["AVGO", "TXN", "AAPL"]),
  co("TXN", "97476", "Texas Instruments", "Information Technology", "Semiconductors", "XLK", "https://www.ti.com", "https://investor.ti.com", 1930,
    "Makes analog and embedded-processing chips sold to industrial, automotive and consumer markets, mostly from its own 300mm fabs.",
    ["QCOM", "INTC", "AVGO"]),
  co("MU", "723125", "Micron", "Information Technology", "Semiconductors", "XLK", "https://www.micron.com", "https://investors.micron.com", 1978,
    "Manufactures DRAM, high-bandwidth memory (HBM) for AI accelerators and NAND flash storage for data centers, PCs, phones and autos.",
    ["NVDA", "AMD", "INTC"]),

  // ---- Communication Services ----
  co("NFLX", "1065280", "Netflix", "Communication Services", "Movies & Entertainment", "XLC", "https://www.netflix.com", "https://ir.netflix.net", 1997,
    "Largest subscription streaming service, earning membership fees across roughly 190 countries plus a growing advertising tier.",
    ["DIS", "GOOGL", "META"]),
  co("DIS", "1744489", "Disney", "Communication Services", "Movies & Entertainment", "XLC", "https://thewaltdisneycompany.com", "https://thewaltdisneycompany.com/investor-relations/", 1923,
    "Media and entertainment company reporting Entertainment (studios, Disney+, Hulu, linear networks), Sports (ESPN) and Experiences (parks, cruises, consumer products).",
    ["NFLX", "CMCSA"]),
  co("CMCSA", "1166691", "Comcast", "Communication Services", "Cable & Satellite", "XLC", "https://corporate.comcast.com", "https://www.cmcsa.com", 1963,
    "Owns Xfinity broadband, wireless and video (Connectivity & Platforms) and NBCUniversal media, Peacock and theme parks (Content & Experiences).",
    ["DIS", "T", "VZ"]),
  co("T", "732717", "AT&T", "Communication Services", "Integrated Telecommunication Services", "XLC", "https://www.att.com", "https://investors.att.com", 1983,
    "US wireless and fiber broadband carrier reporting Communications (Mobility, Business Wireline, Consumer Wireline) and Latin America (Mexico).",
    ["VZ", "CMCSA"]),
  co("VZ", "732712", "Verizon", "Communication Services", "Integrated Telecommunication Services", "XLC", "https://www.verizon.com", "https://www.verizon.com/about/investors", 2000,
    "Largest US wireless carrier by revenue, reporting Consumer and Business groups across mobile, Fios fiber and fixed-wireless broadband.",
    ["T", "CMCSA"]),

  // ---- Consumer Discretionary ----
  co("LOW", "60667", "Lowe's", "Consumer Discretionary", "Home Improvement Retail", "XLY", "https://corporate.lowes.com", "https://ir.lowes.com", 1921,
    "Second-largest US home improvement retailer, serving DIY homeowners and a growing base of professional customers.",
    ["HD", "WMT", "COST"]),
  co("MCD", "63908", "McDonald's", "Consumer Discretionary", "Restaurants", "XLY", "https://corporate.mcdonalds.com", "https://corporate.mcdonalds.com/corpmcd/investors.html", 1940,
    "World's largest restaurant chain; about 95% of its restaurants are franchised, so rent and royalties make up most of its revenue.",
    ["SBUX", "KO", "PEP"]),
  co("SBUX", "829224", "Starbucks", "Consumer Discretionary", "Restaurants", "XLY", "https://www.starbucks.com", "https://investor.starbucks.com", 1971,
    "Largest coffeehouse chain, operating and licensing stores across North America and International, plus Channel Development (packaged coffee).",
    ["MCD", "NKE"]),
  co("NKE", "320187", "Nike", "Consumer Discretionary", "Footwear", "XLY", "https://about.nike.com", "https://investors.nike.com", 1964,
    "Largest athletic footwear and apparel company, selling Nike, Jordan and Converse through wholesale partners and its own stores and apps.",
    ["SBUX", "AMZN"]),
  co("BKNG", "1075531", "Booking Holdings", "Consumer Discretionary", "Hotels, Resorts & Cruise Lines", "XLY", "https://www.bookingholdings.com", "https://ir.bookingholdings.com", 1997,
    "Online travel company behind Booking.com, Priceline, Agoda, Kayak and OpenTable, earning mostly merchant and agency commissions on hotel bookings.",
    ["AMZN", "GOOGL"]),

  // ---- Consumer Staples ----
  co("PG", "80424", "Procter & Gamble", "Consumer Staples", "Household Products", "XLP", "https://us.pg.com", "https://pginvestor.com", 1837,
    "Largest household-products maker (Tide, Pampers, Gillette, Charmin, Crest), reporting Fabric & Home Care, Baby Feminine & Family Care, Beauty, Health Care and Grooming.",
    ["KO", "PEP", "COST"]),
  co("KO", "21344", "Coca-Cola", "Consumer Staples", "Soft Drinks & Non-alcoholic Beverages", "XLP", "https://www.coca-colacompany.com", "https://investors.coca-colacompany.com", 1892,
    "Sells beverage concentrates and finished drinks (Coca-Cola, Sprite, Fanta, Powerade, Costa) largely through independent bottling partners.",
    ["PEP", "PG", "MCD"]),
  co("PEP", "77476", "PepsiCo", "Consumer Staples", "Soft Drinks & Non-alcoholic Beverages", "XLP", "https://www.pepsico.com", "https://www.pepsico.com/investors", 1965,
    "Snacks and beverages company (Frito-Lay, Pepsi, Gatorade, Quaker) that, unlike Coca-Cola, bottles and distributes much of its own product.",
    ["KO", "PG", "MCD"]),
  co("PM", "1413329", "Philip Morris Intl", "Consumer Staples", "Tobacco", "XLP", "https://www.pmi.com", "https://www.pmi.com/investor-relations", 1847,
    "International tobacco company (Marlboro outside the US) shifting toward smoke-free products: IQOS heated tobacco and ZYN nicotine pouches.",
    ["KO", "PG"]),

  // ---- Financials ----
  co("WFC", "72971", "Wells Fargo", "Financials", "Diversified Banks", "XLF", "https://www.wellsfargo.com", "https://www.wellsfargo.com/about/investor-relations/", 1852,
    "Large US bank reporting Consumer Banking & Lending, Commercial Banking, Corporate & Investment Banking and Wealth & Investment Management.",
    ["JPM", "BAC", "C"]),
  co("C", "831001", "Citigroup", "Financials", "Diversified Banks", "XLF", "https://www.citigroup.com", "https://www.citigroup.com/global/investors", 1812,
    "Global bank reporting Services (treasury, trade, securities services), Markets, Banking, Wealth and US Personal Banking.",
    ["JPM", "BAC", "WFC"]),
  co("MS", "895421", "Morgan Stanley", "Financials", "Investment Banking & Brokerage", "XLF", "https://www.morganstanley.com", "https://www.morganstanley.com/about-us-ir", 1935,
    "Investment bank and wealth manager reporting Institutional Securities, Wealth Management (incl. E*TRADE) and Investment Management.",
    ["GS", "JPM", "SCHW"]),
  co("SCHW", "316709", "Charles Schwab", "Financials", "Investment Banking & Brokerage", "XLF", "https://www.aboutschwab.com", "https://www.aboutschwab.com/investor-relations", 1971,
    "Largest US retail brokerage and custodian for independent advisors; most revenue is net interest income on client cash plus asset-management fees.",
    ["MS", "GS"]),
  co("AXP", "4962", "American Express", "Financials", "Consumer Finance", "XLF", "https://www.americanexpress.com", "https://ir.americanexpress.com", 1850,
    "Closed-loop card network and issuer earning discount revenue from merchants, card fees and net interest income on card loans.",
    ["V", "MA", "JPM"]),
  co("SPGI", "64040", "S&P Global", "Financials", "Financial Exchanges & Data", "XLF", "https://www.spglobal.com", "https://investor.spglobal.com", 1860,
    "Credit ratings, market data and analytics (Market Intelligence, Commodity Insights, Mobility) and S&P Dow Jones Indices.",
    ["MA", "V", "MS"]),

  // ---- Health Care ----
  co("ABBV", "1551152", "AbbVie", "Health Care", "Biotechnology", "XLV", "https://www.abbvie.com", "https://investors.abbvie.com", 2013,
    "Biopharma company led by immunology drugs Skyrizi and Rinvoq (succeeding Humira), plus neuroscience (Botox, Vraylar), oncology and aesthetics.",
    ["LLY", "MRK", "AMGN"]),
  co("PFE", "78003", "Pfizer", "Health Care", "Pharmaceuticals", "XLV", "https://www.pfizer.com", "https://investors.pfizer.com", 1849,
    "Pharmaceutical company with vaccines (Prevnar), oncology (incl. Seagen), cardiovascular (Eliquis, Vyndaqel) and COVID-19 products.",
    ["MRK", "JNJ", "ABBV"]),
  co("AMGN", "318154", "Amgen", "Health Care", "Biotechnology", "XLV", "https://www.amgen.com", "https://investors.amgen.com", 1980,
    "Biotech company selling bone, cardiovascular, oncology and inflammation medicines (Prolia, Repatha, Tezspire) and rare-disease drugs from Horizon.",
    ["ABBV", "LLY", "PFE"]),
  co("TMO", "97745", "Thermo Fisher", "Health Care", "Life Sciences Tools & Services", "XLV", "https://www.thermofisher.com", "https://ir.thermofisher.com", 1956,
    "Largest supplier of lab instruments, reagents and consumables, and a contract development and clinical-research (PPD) services provider to pharma.",
    ["ABT", "JNJ"]),
  co("ABT", "1800", "Abbott", "Health Care", "Health Care Equipment", "XLV", "https://www.abbott.com", "https://www.abbottinvestor.com", 1888,
    "Diversified health care company reporting Medical Devices (FreeStyle Libre, cardiovascular), Diagnostics, Nutrition and Established Pharmaceuticals.",
    ["JNJ", "TMO", "ISRG"]),
  co("ISRG", "1035267", "Intuitive Surgical", "Health Care", "Health Care Equipment", "XLV", "https://www.intuitive.com", "https://isrg.intuitive.com", 1995,
    "Maker of the da Vinci robotic surgery systems and Ion lung biopsy platform; most revenue is recurring instruments, accessories and service.",
    ["ABT", "TMO", "JNJ"]),

  // ---- Industrials ----
  co("GE", "40545", "GE Aerospace", "Industrials", "Aerospace & Defense", "XLI", "https://www.geaerospace.com", "https://www.geaerospace.com/investor-relations", 1892,
    "Jet engine maker (with Safran via CFM) whose installed base drives aftermarket services; became a pure-play aerospace company after spinning off GE HealthCare and GE Vernova.",
    ["RTX", "BA", "HON"]),
  co("RTX", "101829", "RTX", "Industrials", "Aerospace & Defense", "XLI", "https://www.rtx.com", "https://investors.rtx.com", 1922,
    "Aerospace and defense company reporting Collins Aerospace, Pratt & Whitney engines and Raytheon missiles and defense systems.",
    ["GE", "LMT", "BA"]),
  co("BA", "12927", "Boeing", "Industrials", "Aerospace & Defense", "XLI", "https://www.boeing.com", "https://investors.boeing.com", 1916,
    "Largest US aircraft maker, reporting Commercial Airplanes (737, 787), Defense, Space & Security, and Global Services.",
    ["GE", "RTX", "LMT"]),
  co("LMT", "936468", "Lockheed Martin", "Industrials", "Aerospace & Defense", "XLI", "https://www.lockheedmartin.com", "https://investors.lockheedmartin.com", 1995,
    "Largest US defense contractor (F-35, missiles, helicopters, space systems), with most sales to the US government.",
    ["RTX", "BA", "GE"]),
  co("HON", "773840", "Honeywell", "Industrials", "Industrial Conglomerates", "XLI", "https://www.honeywell.com", "https://investor.honeywell.com", 1906,
    "Industrial technology company reporting Aerospace Technologies, Industrial Automation, Building Automation and Energy & Sustainability Solutions.",
    ["GE", "CAT", "DE"]),
  co("DE", "315189", "Deere", "Industrials", "Agricultural & Farm Machinery", "XLI", "https://www.deere.com", "https://investor.deere.com", 1837,
    "Largest maker of agricultural equipment (John Deere), plus construction and forestry machinery and a captive financial services arm.",
    ["CAT", "HON"]),
  co("UNP", "100885", "Union Pacific", "Industrials", "Rail Transportation", "XLI", "https://www.up.com", "https://investor.unionpacific.com", 1862,
    "Largest US freight railroad by revenue, hauling bulk, industrial and premium (intermodal and automotive) freight across 23 western states.",
    ["UPS", "CAT"]),
  co("UPS", "1090727", "UPS", "Industrials", "Air Freight & Logistics", "XLI", "https://www.ups.com", "https://investors.ups.com", 1907,
    "Global package delivery company reporting US Domestic Package, International Package and Supply Chain Solutions.",
    ["UNP", "AMZN"]),

  // ---- Energy ----
  co("COP", "1163165", "ConocoPhillips", "Energy", "Oil & Gas Exploration & Production", "XLE", "https://www.conocophillips.com", "https://www.conocophillips.com/investor-relations/", 2002,
    "Largest independent oil and gas producer, with Lower 48 shale (Permian, Eagle Ford, Bakken), Alaska, LNG and international assets; acquired Marathon Oil in 2024.",
    ["XOM", "CVX", "SLB"]),
  co("SLB", "87347", "SLB", "Energy", "Oil & Gas Equipment & Services", "XLE", "https://www.slb.com", "https://investorcenter.slb.com", 1926,
    "Largest oilfield services company, reporting Digital & Integration, Reservoir Performance, Well Construction and Production Systems.",
    ["XOM", "CVX", "COP"]),

  // ---- Materials ----
  co("LIN", "1707925", "Linde", "Materials", "Industrial Gases", "XLB", "https://www.linde.com", "https://investors.linde.com", 1879,
    "Largest industrial gases company, supplying oxygen, nitrogen, hydrogen and specialty gases under long-term contracts and building engineered plants.",
    ["FCX", "HON"]),
  co("FCX", "831259", "Freeport-McMoRan", "Materials", "Copper", "XLB", "https://www.fcx.com", "https://investors.fcx.com", 1912,
    "One of the largest copper miners, with the Grasberg district in Indonesia and mines in North and South America, plus gold and molybdenum.",
    ["LIN", "CAT"]),

  // ---- Utilities ----
  co("NEE", "753308", "NextEra Energy", "Utilities", "Electric Utilities", "XLU", "https://www.nexteraenergy.com", "https://www.investor.nexteraenergy.com", 1925,
    "Owns Florida Power & Light, the largest US electric utility, and NextEra Energy Resources, the largest generator of wind and solar power.",
    ["DUK", "SO"]),
  co("DUK", "1326160", "Duke Energy", "Utilities", "Electric Utilities", "XLU", "https://www.duke-energy.com", "https://investors.duke-energy.com", 1904,
    "Regulated electric and gas utility serving the Carolinas, Florida and the Midwest, reporting Electric Utilities & Infrastructure and Gas Utilities & Infrastructure.",
    ["SO", "NEE"]),
  co("SO", "92122", "Southern Company", "Utilities", "Electric Utilities", "XLU", "https://www.southerncompany.com", "https://investor.southerncompany.com", 1945,
    "Regulated utility holding company (Georgia Power, Alabama Power, Mississippi Power, Southern Company Gas) that completed the Vogtle nuclear expansion.",
    ["DUK", "NEE"]),

  // ---- Real Estate ----
  co("PLD", "1045609", "Prologis", "Real Estate", "Industrial REITs", "XLRE", "https://www.prologis.com", "https://ir.prologis.com", 1983,
    "Largest owner of logistics real estate (warehouses and distribution centers) worldwide, leasing to e-commerce, retail and 3PL tenants.",
    ["AMT", "EQIX"]),
  co("AMT", "1053507", "American Tower", "Real Estate", "Telecom Tower REITs", "XLRE", "https://www.americantower.com", "https://www.americantower.com/investor-relations/", 1995,
    "Owns roughly 150,000 wireless towers worldwide and CoreSite data centers, leasing space to carriers such as AT&T, Verizon and T-Mobile.",
    ["EQIX", "PLD", "VZ"]),
  co("EQIX", "1101239", "Equinix", "Real Estate", "Data Center REITs", "XLRE", "https://www.equinix.com", "https://investor.equinix.com", 1998,
    "Largest global colocation data-center operator, with 260+ facilities where networks, clouds and enterprises interconnect.",
    ["AMT", "PLD", "MSFT"]),
];


function co(
  ticker: string, cik: string, shortName: string, sector: string, industry: string, sectorEtf: string,
  website: string, ir: string, founded: number, description: string, peers: string[],
): CoverageCompany {
  return { ticker, cik, shortName, sector, industry, sectorEtf, website, ir, founded, description, peers };
}

const CURATED_SET = new Set(CURATED_COVERAGE.map((c) => c.ticker));

/** Every covered company: the curated list plus the generated partner-universe list (scripts/expand-coverage.ts). */
export const COVERAGE: CoverageCompany[] = [
  ...CURATED_COVERAGE.map((c) => ({ ...c, group: CURATED_GROUPS[c.ticker] ?? c.industry })),
  ...EXTRA_COVERAGE.filter((c) => !CURATED_SET.has(c.ticker)),
];
const BY_TICKER = new Map(COVERAGE.map((c) => [c.ticker, c]));

export const COVERAGE_TICKERS = COVERAGE.map((c) => c.ticker);
export const coverageOf = (ticker: string) => BY_TICKER.get(ticker.toUpperCase());
/** Datasets and price snapshots for curated companies ship in public/data; the rest are served from storage. */
export const isBundled = (ticker: string) => CURATED_SET.has(ticker.toUpperCase());
/** Peer-grouping key: the shared industry group when known, else the industry label. */
export const groupOf = (c: Pick<CoverageCompany, "group" | "industry"> | undefined) => c?.group ?? c?.industry ?? "";

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

export type MacroGroup =
  | "rates"
  | "curve"
  | "inflation"
  | "labor"
  | "growth"
  | "consumer"
  | "business"
  | "housing"
  | "liquidity"
  | "credit"
  | "fiscal"
  | "energy"
  | "industry";

export interface MacroDef {
  id: string;
  title: string;
  units: string;
  frequency: "Daily" | "Weekly" | "Monthly" | "Quarterly" | "Annual";
  since: string;
  group: MacroGroup;
  /** yoy = % change vs 12 months earlier; diff = change vs prior observation; sum12 = trailing 12-month total */
  transform?: "yoy" | "diff" | "sum12";
  /** Page with the series' official documentation */
  source: string;
  /** Government agency (or institution) that produces the numbers */
  agency: string;
  /** Where the ingest fetches it: FRED mirror (default) or the U.S. Treasury Fiscal Data API directly */
  provider?: "fred" | "treasury";
  /** Display formatting for raw (untransformed) values */
  fmt?: { div?: number; prefix?: string; suffix?: string; digits?: number };
  /** Sectors this is a fundamental driver for (sector pages) */
  sectors?: string[];
  /** Is a rising reading usually good or bad for risk assets? Colors the macro monitor. */
  rising?: "good" | "bad";
}

const fred = (id: string) => `https://fred.stlouisfed.org/series/${id}`;
const FISCAL = "https://fiscaldata.treasury.gov/datasets";

const BLS = "Bureau of Labor Statistics";
const BEA = "Bureau of Economic Analysis";
const CENSUS = "Census Bureau";
const FRB = "Federal Reserve Board";
const NYFED = "Federal Reserve Bank of New York";
const TSY = "U.S. Treasury";
const EIA = "Energy Information Administration";
const DOL = "Department of Labor";

const T = { div: 1e6, prefix: "$", suffix: "T", digits: 2 }; // millions → trillions
const B = { prefix: "$", suffix: "B", digits: 0 }; // billions
const K = { div: 1e3, suffix: "k", digits: 0 };

type M = Omit<MacroDef, "source"> & { source?: string };
const m = (d: M): MacroDef => ({ ...d, source: d.source ?? fred(d.id) });

export const MACRO_SERIES: MacroDef[] = [
  // ---- Rates ----
  m({ id: "FEDFUNDS", title: "Effective federal funds rate", units: "%", frequency: "Monthly", since: "1990-01-01", group: "rates", agency: FRB }),
  m({ id: "SOFR", title: "Secured overnight financing rate", units: "%", frequency: "Daily", since: "2018-04-01", group: "rates", agency: NYFED }),
  m({ id: "DTB3", title: "3-month Treasury bill", units: "%", frequency: "Daily", since: "2005-01-01", group: "rates", agency: FRB }),
  m({ id: "DGS2", title: "2-year Treasury yield", units: "%", frequency: "Daily", since: "2005-01-01", group: "rates", agency: FRB, sectors: ["Financials"] }),
  m({ id: "DGS10", title: "10-year Treasury yield", units: "%", frequency: "Daily", since: "2005-01-01", group: "rates", agency: FRB, sectors: ["Utilities", "Real Estate"], rising: "bad" }),
  m({ id: "DFII10", title: "10-year real yield (TIPS)", units: "%", frequency: "Daily", since: "2005-01-01", group: "rates", agency: FRB, rising: "bad" }),
  m({ id: "THREEFYTP10", title: "10-year term premium (Kim–Wright)", units: "pp", frequency: "Daily", since: "2005-01-01", group: "rates", agency: FRB }),
  m({ id: "T10Y2Y", title: "10Y minus 2Y Treasury spread", units: "pp", frequency: "Daily", since: "2005-01-01", group: "rates", agency: FRB, sectors: ["Financials"] }),
  m({ id: "T10Y3M", title: "10Y minus 3M Treasury spread", units: "pp", frequency: "Daily", since: "2005-01-01", group: "rates", agency: FRB }),
  m({ id: "MORTGAGE30US", title: "30-year fixed mortgage rate", units: "%", frequency: "Weekly", since: "2000-01-01", group: "housing", agency: "Freddie Mac", sectors: ["Real Estate", "Consumer Discretionary"], rising: "bad" }),

  // ---- Inflation ----
  m({ id: "CPIAUCSL", title: "CPI, all items", units: "Index 1982-84=100", frequency: "Monthly", since: "1990-01-01", group: "inflation", transform: "yoy", agency: BLS, rising: "bad" }),
  m({ id: "CPILFESL", title: "Core CPI (ex food & energy)", units: "Index 1982-84=100", frequency: "Monthly", since: "1990-01-01", group: "inflation", transform: "yoy", agency: BLS, rising: "bad" }),
  m({ id: "CUSR0000SAH1", title: "CPI: shelter", units: "Index 1982-84=100", frequency: "Monthly", since: "1990-01-01", group: "inflation", transform: "yoy", agency: BLS, rising: "bad" }),
  m({ id: "CUSR0000SASLE", title: "CPI: services less energy", units: "Index 1982-84=100", frequency: "Monthly", since: "1990-01-01", group: "inflation", transform: "yoy", agency: BLS, rising: "bad" }),
  m({ id: "CPIUFDSL", title: "CPI: food", units: "Index 1982-84=100", frequency: "Monthly", since: "1990-01-01", group: "inflation", transform: "yoy", agency: BLS }),
  m({ id: "CPIENGSL", title: "CPI: energy", units: "Index 1982-84=100", frequency: "Monthly", since: "1990-01-01", group: "inflation", transform: "yoy", agency: BLS }),
  m({ id: "PCEPI", title: "PCE price index", units: "Index 2017=100", frequency: "Monthly", since: "1990-01-01", group: "inflation", transform: "yoy", agency: BEA, rising: "bad" }),
  m({ id: "PCEPILFE", title: "Core PCE price index", units: "Index 2017=100", frequency: "Monthly", since: "1990-01-01", group: "inflation", transform: "yoy", agency: BEA, rising: "bad" }),
  m({ id: "CORESTICKM159SFRBATL", title: "Sticky-price core CPI", units: "% y/y", frequency: "Monthly", since: "1990-01-01", group: "inflation", agency: "Federal Reserve Bank of Atlanta", fmt: { suffix: "%", digits: 1 }, rising: "bad" }),
  m({ id: "PPIFIS", title: "PPI: final demand", units: "Index Nov 2009=100", frequency: "Monthly", since: "2010-01-01", group: "inflation", transform: "yoy", agency: BLS }),
  m({ id: "ECIALLCIV", title: "Employment cost index", units: "Index Dec 2005=100", frequency: "Quarterly", since: "2001-01-01", group: "inflation", transform: "yoy", agency: BLS }),
  m({ id: "T5YIE", title: "5-year breakeven inflation", units: "%", frequency: "Daily", since: "2005-01-01", group: "inflation", agency: FRB }),
  m({ id: "T5YIFR", title: "5y5y forward inflation expectation", units: "%", frequency: "Daily", since: "2005-01-01", group: "inflation", agency: FRB }),
  m({ id: "MICH", title: "Consumer 1-year inflation expectations", units: "%", frequency: "Monthly", since: "1990-01-01", group: "inflation", agency: "University of Michigan" }),

  // ---- Labor ----
  m({ id: "UNRATE", title: "Unemployment rate", units: "%", frequency: "Monthly", since: "1990-01-01", group: "labor", agency: BLS, rising: "bad" }),
  m({ id: "U6RATE", title: "U-6 underemployment rate", units: "%", frequency: "Monthly", since: "1994-01-01", group: "labor", agency: BLS, rising: "bad" }),
  m({ id: "PAYEMS", title: "Nonfarm payrolls", units: "Thousands of persons", frequency: "Monthly", since: "1990-01-01", group: "labor", transform: "diff", agency: BLS, rising: "good" }),
  m({ id: "LNS12300060", title: "Prime-age employment-population ratio", units: "%", frequency: "Monthly", since: "1990-01-01", group: "labor", agency: BLS, rising: "good" }),
  m({ id: "CIVPART", title: "Labor force participation", units: "%", frequency: "Monthly", since: "1990-01-01", group: "labor", agency: BLS }),
  m({ id: "CES0500000003", title: "Average hourly earnings", units: "$ per hour", frequency: "Monthly", since: "2006-03-01", group: "labor", transform: "yoy", agency: BLS }),
  m({ id: "ICSA", title: "Initial jobless claims", units: "Claims", frequency: "Weekly", since: "2000-01-01", group: "labor", agency: DOL, fmt: K, rising: "bad" }),
  m({ id: "CCSA", title: "Continuing jobless claims", units: "Claims", frequency: "Weekly", since: "2000-01-01", group: "labor", agency: DOL, fmt: { div: 1e6, suffix: "M", digits: 2 }, rising: "bad" }),
  m({ id: "JTSJOL", title: "Job openings (JOLTS)", units: "Thousands", frequency: "Monthly", since: "2001-01-01", group: "labor", agency: BLS, fmt: { div: 1e3, suffix: "M", digits: 2 } }),
  m({ id: "JTSQUR", title: "Quits rate (JOLTS)", units: "%", frequency: "Monthly", since: "2001-01-01", group: "labor", agency: BLS }),

  // ---- Growth & output ----
  m({ id: "A191RL1Q225SBEA", title: "Real GDP growth (SAAR)", units: "% q/q annualized", frequency: "Quarterly", since: "1990-01-01", group: "growth", agency: BEA, fmt: { suffix: "%", digits: 1 }, rising: "good" }),
  m({ id: "GDPC1", title: "Real GDP", units: "Billions of chained 2017 dollars", frequency: "Quarterly", since: "1990-01-01", group: "growth", transform: "yoy", agency: BEA, rising: "good" }),
  m({ id: "GDPNOW", title: "GDPNow nowcast (current quarter)", units: "% q/q annualized", frequency: "Quarterly", since: "2011-07-01", group: "growth", agency: "Federal Reserve Bank of Atlanta", fmt: { suffix: "%", digits: 1 } }),
  m({ id: "CP", title: "Corporate profits after tax", units: "Billions of dollars (SAAR)", frequency: "Quarterly", since: "1990-01-01", group: "growth", transform: "yoy", agency: BEA, rising: "good" }),
  m({ id: "INDPRO", title: "Industrial production", units: "Index 2017=100", frequency: "Monthly", since: "1990-01-01", group: "growth", transform: "yoy", agency: FRB, rising: "good" }),
  m({ id: "TCU", title: "Capacity utilization", units: "% of capacity", frequency: "Monthly", since: "1990-01-01", group: "growth", agency: FRB, fmt: { suffix: "%", digits: 1 }, sectors: ["Industrials", "Materials"] }),
  m({ id: "USREC", title: "NBER recession indicator", units: "0/1", frequency: "Monthly", since: "1990-01-01", group: "growth", agency: "NBER" }),

  // ---- Consumer ----
  m({ id: "RSAFS", title: "Retail sales", units: "Millions of dollars", frequency: "Monthly", since: "1992-01-01", group: "consumer", transform: "yoy", agency: CENSUS, rising: "good" }),
  m({ id: "RSFSXMV", title: "Retail sales ex autos", units: "Millions of dollars", frequency: "Monthly", since: "1992-01-01", group: "consumer", transform: "yoy", agency: CENSUS, sectors: ["Consumer Discretionary"] }),
  m({ id: "PCEC96", title: "Real personal consumption", units: "Billions of chained 2017 dollars", frequency: "Monthly", since: "2002-01-01", group: "consumer", transform: "yoy", agency: BEA, sectors: ["Consumer Staples", "Consumer Discretionary"], rising: "good" }),
  m({ id: "DSPIC96", title: "Real disposable income", units: "Billions of chained 2017 dollars", frequency: "Monthly", since: "1990-01-01", group: "consumer", transform: "yoy", agency: BEA, rising: "good" }),
  m({ id: "PSAVERT", title: "Personal saving rate", units: "%", frequency: "Monthly", since: "1990-01-01", group: "consumer", agency: BEA }),
  m({ id: "TOTALSL", title: "Consumer credit outstanding", units: "Millions of dollars", frequency: "Monthly", since: "1990-01-01", group: "consumer", transform: "yoy", agency: FRB, sectors: ["Financials"] }),
  m({ id: "DRCCLACBS", title: "Credit card delinquency rate", units: "%", frequency: "Quarterly", since: "1991-01-01", group: "consumer", agency: FRB, sectors: ["Financials"], rising: "bad" }),
  m({ id: "TDSP", title: "Household debt service ratio", units: "% of disposable income", frequency: "Quarterly", since: "1990-01-01", group: "consumer", agency: FRB, fmt: { suffix: "%", digits: 1 } }),
  m({ id: "UMCSENT", title: "Consumer sentiment (UMich)", units: "Index 1966:Q1=100", frequency: "Monthly", since: "1990-01-01", group: "consumer", agency: "University of Michigan", fmt: { digits: 1 }, sectors: ["Consumer Discretionary"], rising: "good" }),
  m({ id: "TOTALSA", title: "Light vehicle sales (SAAR)", units: "Millions of units", frequency: "Monthly", since: "1990-01-01", group: "consumer", agency: BEA, fmt: { suffix: "M", digits: 1 }, sectors: ["Consumer Discretionary"] }),
  m({ id: "ECOMPCTSA", title: "E-commerce share of retail sales", units: "%", frequency: "Quarterly", since: "1999-10-01", group: "consumer", agency: CENSUS, sectors: ["Consumer Discretionary", "Consumer Staples"] }),

  // ---- Business ----
  m({ id: "NEWORDER", title: "Core capital goods orders", units: "Millions of dollars", frequency: "Monthly", since: "1992-01-01", group: "business", transform: "yoy", agency: CENSUS, sectors: ["Industrials"], rising: "good" }),
  m({ id: "DGORDER", title: "Durable goods orders", units: "Millions of dollars", frequency: "Monthly", since: "1992-01-01", group: "business", transform: "yoy", agency: CENSUS, rising: "good" }),
  m({ id: "IPMAN", title: "Manufacturing output", units: "Index 2017=100", frequency: "Monthly", since: "1990-01-01", group: "business", transform: "yoy", agency: FRB, sectors: ["Industrials", "Materials"] }),
  m({ id: "Y033RC1Q027SBEA", title: "Business equipment investment", units: "Billions of dollars (SAAR)", frequency: "Quarterly", since: "1990-01-01", group: "business", transform: "yoy", agency: BEA, sectors: ["Industrials"] }),
  m({ id: "A679RC1Q027SBEA", title: "Info-processing equipment & software investment", units: "Billions of dollars (SAAR)", frequency: "Quarterly", since: "1990-01-01", group: "business", transform: "yoy", agency: BEA, sectors: ["Information Technology"] }),
  m({ id: "ISRATIO", title: "Business inventories-to-sales ratio", units: "Ratio", frequency: "Monthly", since: "1992-01-01", group: "business", agency: CENSUS, fmt: { suffix: "×", digits: 2 } }),
  m({ id: "TTLCONS", title: "Construction spending", units: "Millions of dollars (SAAR)", frequency: "Monthly", since: "1993-01-01", group: "business", transform: "yoy", agency: CENSUS, sectors: ["Industrials", "Materials"] }),
  m({ id: "BOPGSTB", title: "Trade balance (goods & services)", units: "Millions of dollars", frequency: "Monthly", since: "1992-01-01", group: "business", agency: CENSUS, fmt: { div: 1e3, prefix: "$", suffix: "B", digits: 1 } }),

  // ---- Housing ----
  m({ id: "HOUST", title: "Housing starts", units: "Thousands of units (SAAR)", frequency: "Monthly", since: "1990-01-01", group: "housing", agency: CENSUS, fmt: { suffix: "k", digits: 0 }, sectors: ["Consumer Discretionary"] }),
  m({ id: "PERMIT", title: "Building permits", units: "Thousands of units (SAAR)", frequency: "Monthly", since: "1990-01-01", group: "housing", agency: CENSUS, fmt: { suffix: "k", digits: 0 } }),
  m({ id: "HSN1F", title: "New home sales", units: "Thousands of units (SAAR)", frequency: "Monthly", since: "1990-01-01", group: "housing", agency: CENSUS, fmt: { suffix: "k", digits: 0 } }),
  m({ id: "MSPUS", title: "Median price of houses sold", units: "Dollars", frequency: "Quarterly", since: "1990-01-01", group: "housing", agency: CENSUS, fmt: { div: 1e3, prefix: "$", suffix: "k", digits: 0 } }),
  m({ id: "USSTHPI", title: "FHFA house price index", units: "Index 1980:Q1=100", frequency: "Quarterly", since: "1990-01-01", group: "housing", transform: "yoy", agency: "Federal Housing Finance Agency", sectors: ["Real Estate"] }),
  m({ id: "CSUSHPINSA", title: "Case-Shiller national home prices", units: "Index Jan 2000=100", frequency: "Monthly", since: "1990-01-01", group: "housing", transform: "yoy", agency: "S&P Dow Jones Indices" }),
  m({ id: "RRVRUSQ156N", title: "Rental vacancy rate", units: "%", frequency: "Quarterly", since: "1990-01-01", group: "housing", agency: CENSUS, sectors: ["Real Estate"] }),
  m({ id: "TLNRESCONS", title: "Nonresidential construction spending", units: "Millions of dollars (SAAR)", frequency: "Monthly", since: "1993-01-01", group: "housing", transform: "yoy", agency: CENSUS, sectors: ["Real Estate", "Industrials"] }),

  // ---- Liquidity ----
  m({ id: "M2SL", title: "M2 money supply", units: "Billions of dollars", frequency: "Monthly", since: "1990-01-01", group: "liquidity", transform: "yoy", agency: FRB }),
  m({ id: "WALCL", title: "Fed balance sheet (total assets)", units: "Millions of dollars", frequency: "Weekly", since: "2003-01-01", group: "liquidity", agency: FRB, fmt: T }),
  m({ id: "WRESBAL", title: "Bank reserve balances at the Fed", units: "Millions of dollars", frequency: "Weekly", since: "2003-01-01", group: "liquidity", agency: FRB, fmt: T }),
  m({ id: "RRPONTSYD", title: "Overnight reverse repo usage", units: "Billions of dollars", frequency: "Daily", since: "2014-01-01", group: "liquidity", agency: NYFED, fmt: B }),
  m({ id: "WTREGEN", title: "Treasury General Account balance", units: "Millions of dollars", frequency: "Weekly", since: "2003-01-01", group: "liquidity", agency: FRB, fmt: { div: 1e3, prefix: "$", suffix: "B", digits: 0 } }),
  m({ id: "TOTBKCR", title: "Commercial bank credit", units: "Billions of dollars", frequency: "Weekly", since: "2000-01-01", group: "liquidity", transform: "yoy", agency: FRB, sectors: ["Financials"] }),
  m({ id: "DPSACBW027SBOG", title: "Commercial bank deposits", units: "Billions of dollars", frequency: "Weekly", since: "2000-01-01", group: "liquidity", transform: "yoy", agency: FRB, sectors: ["Financials"] }),

  // ---- Credit & risk ----
  m({ id: "BAMLH0A0HYM2", title: "High-yield credit spread (OAS)", units: "%", frequency: "Daily", since: "2005-01-01", group: "credit", agency: "ICE Data Indices", rising: "bad" }),
  m({ id: "BAA10Y", title: "Baa corporate minus 10Y Treasury", units: "pp", frequency: "Daily", since: "2005-01-01", group: "credit", agency: "Moody's", rising: "bad" }),
  m({ id: "DRTSCILM", title: "Banks tightening C&I lending standards", units: "Net % of banks", frequency: "Quarterly", since: "1990-04-01", group: "credit", agency: FRB, fmt: { suffix: "%", digits: 1 }, sectors: ["Financials"], rising: "bad" }),
  m({ id: "BUSLOANS", title: "Commercial & industrial loans", units: "Billions of dollars", frequency: "Monthly", since: "1990-01-01", group: "credit", transform: "yoy", agency: FRB, sectors: ["Financials"] }),
  m({ id: "DRCRELEXFACBS", title: "Commercial real estate loan delinquency", units: "%", frequency: "Quarterly", since: "1991-01-01", group: "credit", agency: FRB, sectors: ["Real Estate", "Financials"], rising: "bad" }),
  m({ id: "VIXCLS", title: "VIX", units: "Index", frequency: "Daily", since: "2005-01-01", group: "credit", agency: "Cboe", fmt: { digits: 1 }, rising: "bad" }),
  m({ id: "NFCI", title: "Chicago Fed financial conditions", units: "Index", frequency: "Weekly", since: "2000-01-01", group: "credit", agency: "Federal Reserve Bank of Chicago", fmt: { digits: 2 }, rising: "bad" }),
  m({ id: "DTWEXBGS", title: "Trade-weighted US dollar", units: "Index Jan 2006=100", frequency: "Daily", since: "2006-01-01", group: "credit", agency: FRB, fmt: { digits: 1 } }),

  // ---- Fiscal (U.S. Treasury Fiscal Data, direct) ----
  m({ id: "TSY_DEBT", title: "Total public debt outstanding", units: "Dollars", frequency: "Daily", since: "2005-01-01", group: "fiscal", agency: TSY, provider: "treasury", fmt: { div: 1e12, prefix: "$", suffix: "T", digits: 2 }, source: `${FISCAL}/debt-to-the-penny/debt-to-the-penny` }),
  m({ id: "TSY_DEBT_PUBLIC", title: "Debt held by the public", units: "Dollars", frequency: "Daily", since: "2005-01-01", group: "fiscal", agency: TSY, provider: "treasury", fmt: { div: 1e12, prefix: "$", suffix: "T", digits: 2 }, source: `${FISCAL}/debt-to-the-penny/debt-to-the-penny` }),
  m({ id: "TSY_AVG_RATE", title: "Average interest rate on federal debt", units: "%", frequency: "Monthly", since: "2001-01-01", group: "fiscal", agency: TSY, provider: "treasury", fmt: { suffix: "%", digits: 2 }, source: `${FISCAL}/average-interest-rates-treasury-securities/average-interest-rates-on-u-s-treasury-securities` }),
  m({ id: "MTSDS133FMS", title: "Federal deficit, trailing 12 months", units: "Millions of dollars", frequency: "Monthly", since: "1990-01-01", group: "fiscal", transform: "sum12", agency: TSY, fmt: T }),
  m({ id: "A091RC1Q027SBEA", title: "Federal interest payments (SAAR)", units: "Billions of dollars", frequency: "Quarterly", since: "1990-01-01", group: "fiscal", agency: BEA, fmt: { div: 1e3, prefix: "$", suffix: "T", digits: 2 } }),
  m({ id: "GFDEGDQ188S", title: "Federal debt to GDP", units: "% of GDP", frequency: "Quarterly", since: "1990-01-01", group: "fiscal", agency: "OMB / Federal Reserve Bank of St. Louis", fmt: { suffix: "%", digits: 1 } }),
  m({ id: "FYFSGDA188S", title: "Federal surplus or deficit to GDP", units: "% of GDP", frequency: "Annual", since: "1990-01-01", group: "fiscal", agency: "Office of Management and Budget", fmt: { suffix: "%", digits: 1 } }),

  // ---- Energy & commodities ----
  m({ id: "DCOILWTICO", title: "WTI crude oil", units: "$ per barrel", frequency: "Daily", since: "2005-01-01", group: "energy", agency: EIA, fmt: { prefix: "$", digits: 2 }, sectors: ["Energy"] }),
  m({ id: "DCOILBRENTEU", title: "Brent crude oil", units: "$ per barrel", frequency: "Daily", since: "2005-01-01", group: "energy", agency: EIA, fmt: { prefix: "$", digits: 2 }, sectors: ["Energy"] }),
  m({ id: "DHHNGSP", title: "Henry Hub natural gas", units: "$ per MMBtu", frequency: "Daily", since: "2005-01-01", group: "energy", agency: EIA, fmt: { prefix: "$", digits: 2 }, sectors: ["Energy", "Utilities"] }),
  m({ id: "GASREGW", title: "Regular gasoline, retail", units: "$ per gallon", frequency: "Weekly", since: "2005-01-01", group: "energy", agency: EIA, fmt: { prefix: "$", digits: 2 }, sectors: ["Energy", "Consumer Discretionary"] }),
  m({ id: "PCOPPUSDM", title: "Copper price", units: "$ per metric ton", frequency: "Monthly", since: "1990-01-01", group: "energy", agency: "International Monetary Fund", fmt: { prefix: "$", digits: 0 }, sectors: ["Materials"] }),
  m({ id: "PPIACO", title: "PPI: all commodities", units: "Index 1982=100", frequency: "Monthly", since: "1990-01-01", group: "energy", transform: "yoy", agency: BLS, sectors: ["Materials"] }),

  // ---- Industry drivers (sector pages) ----
  m({ id: "IPG3344S", title: "Semiconductor production", units: "Index 2017=100", frequency: "Monthly", since: "1990-01-01", group: "industry", transform: "yoy", agency: FRB, sectors: ["Information Technology"] }),
  m({ id: "USINFO", title: "Information-sector employment", units: "Thousands of persons", frequency: "Monthly", since: "1990-01-01", group: "industry", transform: "yoy", agency: BLS, sectors: ["Communication Services"] }),
  m({ id: "RSNSR", title: "Online & nonstore retail sales", units: "Millions of dollars", frequency: "Monthly", since: "1992-01-01", group: "industry", transform: "yoy", agency: CENSUS, sectors: ["Consumer Discretionary", "Communication Services"] }),
  m({ id: "RSFSDP", title: "Restaurant & bar sales", units: "Millions of dollars", frequency: "Monthly", since: "1992-01-01", group: "industry", transform: "yoy", agency: CENSUS, sectors: ["Consumer Discretionary"] }),
  m({ id: "RSDBS", title: "Grocery & beverage store sales", units: "Millions of dollars", frequency: "Monthly", since: "1992-01-01", group: "industry", transform: "yoy", agency: CENSUS, sectors: ["Consumer Staples"] }),
  m({ id: "CUSR0000SAF11", title: "CPI: food at home", units: "Index 1982-84=100", frequency: "Monthly", since: "1990-01-01", group: "industry", transform: "yoy", agency: BLS, sectors: ["Consumer Staples"] }),
  m({ id: "CPIMEDSL", title: "CPI: medical care", units: "Index 1982-84=100", frequency: "Monthly", since: "1990-01-01", group: "industry", transform: "yoy", agency: BLS, sectors: ["Health Care"] }),
  m({ id: "CES6562000001", title: "Health care employment", units: "Thousands of persons", frequency: "Monthly", since: "1990-01-01", group: "industry", transform: "yoy", agency: BLS, sectors: ["Health Care"] }),
  m({ id: "MANEMP", title: "Manufacturing employment", units: "Thousands of persons", frequency: "Monthly", since: "1990-01-01", group: "industry", transform: "yoy", agency: BLS, sectors: ["Industrials"] }),
  m({ id: "IPG325S", title: "Chemical production", units: "Index 2017=100", frequency: "Monthly", since: "1990-01-01", group: "industry", transform: "yoy", agency: FRB, sectors: ["Materials"] }),
  m({ id: "PCU325325", title: "PPI: chemical manufacturing", units: "Index Dec 1984=100", frequency: "Monthly", since: "1990-01-01", group: "industry", transform: "yoy", agency: BLS, sectors: ["Materials"] }),
  m({ id: "IPG2211A2N", title: "Electric power generation output", units: "Index 2017=100", frequency: "Monthly", since: "1990-01-01", group: "industry", transform: "yoy", agency: FRB, sectors: ["Utilities"] }),
  m({ id: "CUSR0000SEHF01", title: "CPI: electricity", units: "Index 1982-84=100", frequency: "Monthly", since: "1990-01-01", group: "industry", transform: "yoy", agency: BLS, sectors: ["Utilities"] }),

  // ---- Yield curve tenors ----
  m({ id: "DGS1MO", title: "1-month Treasury", units: "%", frequency: "Daily", since: "2022-01-01", group: "curve", agency: FRB }),
  m({ id: "DGS3MO", title: "3-month Treasury", units: "%", frequency: "Daily", since: "2022-01-01", group: "curve", agency: FRB }),
  m({ id: "DGS6MO", title: "6-month Treasury", units: "%", frequency: "Daily", since: "2022-01-01", group: "curve", agency: FRB }),
  m({ id: "DGS1", title: "1-year Treasury", units: "%", frequency: "Daily", since: "2022-01-01", group: "curve", agency: FRB }),
  m({ id: "DGS3", title: "3-year Treasury", units: "%", frequency: "Daily", since: "2022-01-01", group: "curve", agency: FRB }),
  m({ id: "DGS5", title: "5-year Treasury", units: "%", frequency: "Daily", since: "2022-01-01", group: "curve", agency: FRB }),
  m({ id: "DGS7", title: "7-year Treasury", units: "%", frequency: "Daily", since: "2022-01-01", group: "curve", agency: FRB }),
  m({ id: "DGS20", title: "20-year Treasury", units: "%", frequency: "Daily", since: "2022-01-01", group: "curve", agency: FRB }),
  m({ id: "DGS30", title: "30-year Treasury", units: "%", frequency: "Daily", since: "2022-01-01", group: "curve", agency: FRB }),
];

export const macroDef = (id: string) => MACRO_SERIES.find((d) => d.id === id);
/** Series shown in the macro dashboard tiles (curve tenors and the recession flag are used as overlays). */
export const MACRO_TILES = MACRO_SERIES.filter((d) => d.group !== "curve" && d.id !== "USREC");

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
