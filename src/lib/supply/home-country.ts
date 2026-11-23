// Home countries of large foreign companies, by whole distinctive name, and the reading of a filing's region
// entries that name a U.S. state. Pure, no browser/Node APIs.
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

/**
 * U.S. federal bodies that filings name as customers or regulators ("U.S. government", "U.S. Department of Defense",
 * "United States Air Force"). They carry no ticker and their sentences write "U.S.", which the region check does not
 * read as a country name, so they would otherwise stay off the map. Only names that start with the country count.
 */
const US_PUBLIC_BODY = /^(the )?(u\.s\.|us|united states) (federal )?(government|department of [a-z ,&]+|air force|army|navy|marine corps|space force|postal service|treasury|congress|food and drug administration|securities and exchange commission|environmental protection agency|federal [a-z ]+|general services administration|centers for [a-z &]+|patent and trademark office|customs and border protection)$/;

/** Home country of a well-known foreign company, or of a U.S. federal body, by its full name; null for anything else. */
export function knownHomeCountry(name: string): string | null {
  const n = fold(name);
  const whole = WHOLE_NAME[n.replace(/[.,]/g, "").trim()];
  if (whole) return whole;
  for (const [re, country] of KNOWN_HOME) if (re.test(n)) return country;
  if (US_PUBLIC_BODY.test(n)) return "United States";
  return null;
}

/* ---------- U.S. states ---------- */
export const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine",
  MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", PR: "Puerto Rico", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};
const STATE_BY_NAME: Record<string, string> = Object.fromEntries(Object.entries(US_STATES).map(([code, name]) => [name.toLowerCase(), code]));
/** Two-letter code of a U.S. state given its code or name; null when it is not one. */
export function usState(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  const up = t.toUpperCase();
  if (US_STATES[up]) return up;
  return STATE_BY_NAME[t.toLowerCase()] ?? null;
}

/** Wording that makes "Georgia" the country in the Caucasus rather than the U.S. state. */
const GEORGIA_COUNTRY = /\b(republic of georgia|country of georgia|georgia \(country\)|tbilisi|batumi|georgian lari|south caucasus)\b|\bgeorgia\b[^.;]{0,80}\b(armenia|azerbaijan|kazakhstan|uzbekistan|russia|ukraine|turkey|turkiye|moldova|belarus)\b|\b(armenia|azerbaijan|kazakhstan|uzbekistan|russia|ukraine|turkey|turkiye|moldova|belarus)\b[^.;]{0,80}\bgeorgia\b/;
const DC = /\bwashington,? d\.? ?c\b/;

/**
 * The U.S. state a region entry of a filing link names, as a two-letter code; null when the entry is not a state.
 * Only full state names count ("Texas", "New Mexico"): two-letter codes collide with words and with country codes
 * (IN, OR, ME; CA, DE). U.S. filers write "Georgia" for the state far more often than for the country, so it is read
 * as the state unless the quoted sentence itself points at the Caucasus (Tbilisi, "Republic of Georgia", a list of
 * neighbouring countries). "Washington" followed by "D.C." in the sentence is the district.
 */
export function usStateOfRegion(raw: string | null | undefined, quote: string | null | undefined): string | null {
  const name = (raw ?? "").trim().replace(/\s+/g, " ").replace(/^(the )?state of /i, "").toLowerCase();
  const code = STATE_BY_NAME[name];
  if (!code) return null;
  const q = fold(quote ?? "");
  if (code === "GA" && GEORGIA_COUNTRY.test(q)) return null;
  if (code === "WA" && DC.test(q) && !/\b(washington state|state of washington)\b/.test(q)) return "DC";
  return code;
}
