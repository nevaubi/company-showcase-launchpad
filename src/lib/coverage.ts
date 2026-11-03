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
  co("META", "1326801", "Meta", "Communication Services", "Interactive Media & Services", "XLC", "https://about.meta.com", "https://investor.atmeta.com", 2004,
    "Runs Facebook, Instagram, WhatsApp and Messenger, monetized mainly through advertising (Family of Apps), and invests heavily in AI infrastructure and Reality Labs (VR/AR hardware).",
    ["GOOGL", "AMZN", "MSFT"]),
  co("AVGO", "1730168", "Broadcom", "Information Technology", "Semiconductors", "XLK", "https://www.broadcom.com", "https://investors.broadcom.com", 1961,
    "Designs custom AI accelerators, networking and broadband semiconductors, and sells infrastructure software (VMware, mainframe, security) to large enterprises.",
    ["NVDA", "AMD", "ORCL"]),
  co("AMD", "2488", "AMD", "Information Technology", "Semiconductors", "XLK", "https://www.amd.com", "https://ir.amd.com", 1969,
    "Designs CPUs (Ryzen, EPYC), Instinct data-center GPUs, adaptive chips (Xilinx) and semi-custom game-console silicon, reporting Data Center, Client, Gaming and Embedded segments.",
    ["NVDA", "AVGO", "MSFT"]),
  co("ORCL", "1341439", "Oracle", "Information Technology", "Application Software", "XLK", "https://www.oracle.com", "https://investor.oracle.com", 1977,
    "Sells database and enterprise application software and Oracle Cloud Infrastructure (OCI), with a large backlog of AI training and inference capacity contracts.",
    ["MSFT", "AMZN", "GOOGL"]),
  co("JPM", "19617", "JPMorgan Chase", "Financials", "Diversified Banks", "XLF", "https://www.jpmorganchase.com", "https://www.jpmorganchase.com/ir", 1799,
    "Largest US bank by assets, reporting Consumer & Community Banking, Commercial & Investment Bank, and Asset & Wealth Management.",
    ["BAC", "GS", "V"]),
  co("BAC", "70858", "Bank of America", "Financials", "Diversified Banks", "XLF", "https://www.bankofamerica.com", "https://investor.bankofamerica.com", 1904,
    "US bank serving consumers, small businesses and corporations through Consumer Banking, Global Wealth & Investment Management (Merrill), Global Banking and Global Markets.",
    ["JPM", "GS", "MA"]),
  co("GS", "886982", "Goldman Sachs", "Financials", "Investment Banking & Brokerage", "XLF", "https://www.goldmansachs.com", "https://www.goldmansachs.com/investor-relations", 1869,
    "Investment bank reporting Global Banking & Markets (advisory, underwriting, trading) and Asset & Wealth Management, plus Platform Solutions.",
    ["JPM", "BAC"]),
  co("V", "1403161", "Visa", "Financials", "Transaction & Payment Processing Services", "XLF", "https://www.visa.com", "https://investor.visa.com", 1958,
    "Operates the world's largest card payments network, earning service, data processing and international transaction fees on purchase volume.",
    ["MA", "JPM", "AAPL"]),
  co("MA", "1141391", "Mastercard", "Financials", "Transaction & Payment Processing Services", "XLF", "https://www.mastercard.com", "https://investor.mastercard.com", 1966,
    "Runs a global card payments network and sells value-added services (cyber, data analytics, loyalty) to issuers, merchants and governments.",
    ["V", "JPM", "BAC"]),
  co("LLY", "59478", "Eli Lilly", "Health Care", "Pharmaceuticals", "XLV", "https://www.lilly.com", "https://investor.lilly.com", 1876,
    "Pharmaceutical company whose GLP-1 incretin medicines (Mounjaro, Zepbound) for diabetes and obesity drive growth, alongside oncology, immunology and neuroscience drugs.",
    ["MRK", "JNJ", "UNH"]),
  co("UNH", "731766", "UnitedHealth", "Health Care", "Managed Health Care", "XLV", "https://www.unitedhealthgroup.com", "https://www.unitedhealthgroup.com/investors.html", 1977,
    "Largest US health insurer (UnitedHealthcare) and health services company (Optum Health, Optum Insight, Optum Rx).",
    ["LLY", "JNJ", "MRK"]),
  co("JNJ", "200406", "Johnson & Johnson", "Health Care", "Pharmaceuticals", "XLV", "https://www.jnj.com", "https://www.investor.jnj.com", 1886,
    "Health care company reporting Innovative Medicine (oncology, immunology, neuroscience) and MedTech (surgery, orthopaedics, cardiovascular, vision).",
    ["MRK", "LLY", "UNH"]),
  co("MRK", "310158", "Merck", "Health Care", "Pharmaceuticals", "XLV", "https://www.merck.com", "https://www.merck.com/investor-relations", 1891,
    "Pharmaceutical company led by cancer immunotherapy Keytruda and the Gardasil HPV vaccine, with a separate Animal Health segment.",
    ["LLY", "JNJ"]),
  co("WMT", "104169", "Walmart", "Consumer Staples", "Consumer Staples Merchandise Retail", "XLP", "https://corporate.walmart.com", "https://stock.walmart.com", 1962,
    "World's largest retailer, reporting Walmart U.S., Walmart International and Sam's Club, with growing e-commerce, advertising and membership income.",
    ["COST", "AMZN", "HD"]),
  co("COST", "909832", "Costco", "Consumer Staples", "Consumer Staples Merchandise Retail", "XLP", "https://www.costco.com", "https://investor.costco.com", 1983,
    "Membership warehouse club operator; membership fees provide most operating profit while merchandise is sold at low markups.",
    ["WMT", "AMZN", "HD"]),
  co("XOM", "34088", "ExxonMobil", "Energy", "Integrated Oil & Gas", "XLE", "https://corporate.exxonmobil.com", "https://investor.exxonmobil.com", 1870,
    "Integrated oil and gas company reporting Upstream, Energy Products, Chemical Products and Specialty Products, with major Permian and Guyana production.",
    ["CVX"]),
  co("CVX", "93410", "Chevron", "Energy", "Integrated Oil & Gas", "XLE", "https://www.chevron.com", "https://www.chevron.com/investors", 1879,
    "Integrated energy company reporting Upstream and Downstream segments, with Permian, Tengiz and (after acquiring Hess) Guyana assets.",
    ["XOM"]),
  co("CAT", "18230", "Caterpillar", "Industrials", "Construction Machinery & Heavy Transportation Equipment", "XLI", "https://www.caterpillar.com", "https://investors.caterpillar.com", 1925,
    "Largest maker of construction and mining equipment, engines and turbines, reporting Construction Industries, Resource Industries, Energy & Transportation and Financial Products.",
    ["HD", "XOM"]),
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

/** Industries whose statements carry bank-style lines (net interest income, deposits, loans). */
export const BANK_INDUSTRY = /bank|brokerage|consumer finance/i;
export const isBankLike = (industry: string) => BANK_INDUSTRY.test(industry);

function co(
  ticker: string, cik: string, shortName: string, sector: string, industry: string, sectorEtf: string,
  website: string, ir: string, founded: number, description: string, peers: string[],
): CoverageCompany {
  return { ticker, cik, shortName, sector, industry, sectorEtf, website, ir, founded, description, peers };
}

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
