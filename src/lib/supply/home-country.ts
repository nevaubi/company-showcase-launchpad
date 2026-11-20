// Home countries of large foreign companies, by whole distinctive name. Pure, no browser/Node APIs.
// Shared by the globe placement (geo.ts) and the country exposure tallies (analytics.ts), so a counterparty
// lands in the same country on the map and in the World exposure panel.

/**
 * Home countries of large foreign companies that U.S. filings name constantly but that carry no U.S. ticker in the link.
 * Deliberately short and strict: every pattern is a whole, distinctive company name (never a fragment such as "acer", "teva"
 * inside "Corteva", "smic" inside "Prismic" or "vale" inside "Midvale"), so an unrelated name cannot land abroad.
 * Country level only; anything not listed stays without a country.
 */
const KNOWN_HOME: [RegExp, string][] = [
  [/\b(taiwan semiconductor|tsmc|hon hai precision|foxconn|wistron|quanta computer|pegatron|compal electronics|inventec|mediatek|united microelectronics|ase technology|advanced semiconductor engineering|largan precision|delta electronics|unimicron|nanya technology|realtek|asustek)\b/, "Taiwan"],
  [/\b(samsung|sk hynix|lg electronics|lg display|lg energy solution|lg chem|hyundai motor|hyundai heavy industries|kia corporation|sk on co|posco)\b/, "South Korea"],
  [/\b(sony|toyota|panasonic|murata manufacturing|kioxia|tokyo electron|hitachi|toshiba|nidec|kyocera|renesas|shin-etsu|sumco|tdk corporation|fujitsu|nintendo|honda motor|nissan motor|softbank|takeda|astellas|daiichi sankyo|mitsubishi tanabe pharma|denso)\b/, "Japan"],
  [/\b(huawei|byd|byd company|contemporary amperex|catl|alibaba|tencent|baidu|xiaomi|lenovo|zte corporation|semiconductor manufacturing international|smic|bytedance|luxshare|goertek|boe technology|sinopec|petrochina|cnooc)\b/, "China"],
  [/\b(asml|nxp semiconductors|philips|stellantis|heineken)\b/, "Netherlands"],
  [/\b(infineon|siemens|basf|sap se|robert bosch|carl zeiss|volkswagen|bmw|mercedes-benz|bayer ag|bayer aktiengesellschaft|bayer consumer care ag|bayer healthcare ag|merck kgaa|deutsche telekom)\b/, "Germany"],
  [/\b(novo nordisk|maersk|vestas|genmab)\b/, "Denmark"],
  [/\b(nestle|novartis|roche holding|hoffmann-la roche|stmicroelectronics|logitech|glencore)\b/, "Switzerland"],
  [/\b(teva pharmaceutical|check point software|mobileye|tower semiconductor|elbit systems)\b/, "Israel"],
  [/\b(tata consultancy|tata motors|tata steel|infosys|wipro|reliance industries|hcl technologies)\b/, "India"],
  [/\b(nokia)\b/, "Finland"], [/\b(ericsson|spotify|ab volvo|volvo cars)\b/, "Sweden"],
  [/\b(astrazeneca|glaxosmithkline|gsk plc|bp plc|unilever|arm holdings|rolls-royce|bae systems|vodafone|hsbc|barclays|diageo|rio tinto)\b/, "United Kingdom"],
  [/\b(airbus|sanofi|lvmh|totalenergies|schneider electric|safran|thales|capgemini|danone|dassault)\b/, "France"],
  [/\b(bhp group)\b/, "Australia"], [/\b(enbridge|shopify|canadian national railway|magna international)\b/, "Canada"],
  [/\b(petrobras|embraer)\b/, "Brazil"], [/\b(saudi aramco)\b/, "Saudi Arabia"], [/\b(coca-cola femsa)\b/, "Mexico"],
];

/**
 * Bare brand names that filings use on their own ("SAP", "Bayer", "Roche"). They count only when they are the whole name,
 * so "SAP America, Inc.", "UBS Securities LLC" or "Shell Energy North America" (U.S. entities) keep no foreign country.
 */
const WHOLE_NAME: Record<string, string> = {
  sap: "Germany", bayer: "Germany", bosch: "Germany", allianz: "Germany", "allianz se": "Germany", "continental ag": "Germany",
  roche: "Switzerland", "roche group": "Switzerland", abb: "Switzerland", ubs: "Switzerland",
  honda: "Japan", canon: "Japan", "canon inc": "Japan", "mitsubishi corporation": "Japan",
  hyundai: "South Korea", lg: "South Korea", teva: "Israel", volvo: "Sweden", gsk: "United Kingdom",
  nanya: "Taiwan", umc: "Taiwan", compal: "Taiwan",
};

/** Lower case, accents dropped ("Nestlé" meets "nestle"), whitespace collapsed. */
const fold = (name: string) => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Home country of a well-known foreign company by its full name; null for anything else. */
export function knownHomeCountry(name: string): string | null {
  const n = fold(name);
  const whole = WHOLE_NAME[n.replace(/[.,]/g, "").trim()];
  if (whole) return whole;
  for (const [re, country] of KNOWN_HOME) if (re.test(n)) return country;
  return null;
}
