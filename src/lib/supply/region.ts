// Pure helpers for region risk dossiers and agreement-term extraction on the supply-chain page.
// No browser/Node APIs — shared by server functions, the app and tests.

/** ISO3 codes the World Bank API expects, keyed by the canonical country names used across the app. */
export const ISO3: Record<string, string> = {
  "United States": "USA", China: "CHN", Taiwan: "TWN", "Hong Kong": "HKG", Japan: "JPN", "South Korea": "KOR",
  India: "IND", Vietnam: "VNM", Thailand: "THA", Malaysia: "MYS", Singapore: "SGP", Indonesia: "IDN", Philippines: "PHL",
  Israel: "ISR", Russia: "RUS", Ukraine: "UKR", Mexico: "MEX", Canada: "CAN", Brazil: "BRA", Argentina: "ARG", Chile: "CHL",
  Peru: "PER", Colombia: "COL", Germany: "DEU", France: "FRA", "United Kingdom": "GBR", Ireland: "IRL", Netherlands: "NLD",
  Belgium: "BEL", Switzerland: "CHE", Italy: "ITA", Spain: "ESP", Poland: "POL", Czechia: "CZE", Hungary: "HUN", Sweden: "SWE",
  Denmark: "DNK", Finland: "FIN", Norway: "NOR", Austria: "AUT", Luxembourg: "LUX", Portugal: "PRT", Greece: "GRC", Turkey: "TUR",
  "Saudi Arabia": "SAU", "United Arab Emirates": "ARE", Qatar: "QAT", Egypt: "EGY", "South Africa": "ZAF", Nigeria: "NGA",
  Australia: "AUS", "New Zealand": "NZL", "Costa Rica": "CRI", "Puerto Rico": "PRI", Bermuda: "BMU", "Dominican Republic": "DOM",
  Kazakhstan: "KAZ", Pakistan: "PAK", Bangladesh: "BGD", "Sri Lanka": "LKA", Morocco: "MAR", Kenya: "KEN", Guatemala: "GTM",
};

export const WGI = [
  { id: "GOV_WGI_PV.EST", key: "stability", label: "Political stability" },
  { id: "GOV_WGI_RL.EST", key: "ruleOfLaw", label: "Rule of law" },
  { id: "GOV_WGI_RQ.EST", key: "regulatory", label: "Regulatory quality" },
] as const;
export type WgiKey = (typeof WGI)[number]["key"];

export interface CountryScore {
  country: string;
  iso3: string | null;
  /** World Bank Worldwide Governance Indicators, approx. −2.5 (weak) … +2.5 (strong) */
  stability: number | null;
  ruleOfLaw: number | null;
  regulatory: number | null;
  gdpGrowth: number | null;
  year: string | null;
  tier: RiskTier;
  sourceUrl: string | null;
}
export type RiskTier = "high" | "elevated" | "moderate" | "low" | "unrated";

/** Governance risk tier from the weakest of the three WGI estimates (the World Bank does not publish Taiwan). */
export function riskTier(s: Pick<CountryScore, "stability" | "ruleOfLaw" | "regulatory">): RiskTier {
  const v = [s.stability, s.ruleOfLaw, s.regulatory].filter((x): x is number => typeof x === "number");
  if (!v.length) return "unrated";
  const min = Math.min(...v);
  if (min < -1) return "high";
  if (min < -0.25) return "elevated";
  if (min < 0.75) return "moderate";
  return "low";
}

type WbRow = { countryiso3code: string; date: string; value: number | null };
/** Latest non-null value per ISO3 from a World Bank v2 JSON response (`[meta, rows]`). */
export function latestByCountry(body: unknown): Record<string, { value: number; date: string }> {
  const rows = Array.isArray(body) && Array.isArray(body[1]) ? (body[1] as WbRow[]) : [];
  const out: Record<string, { value: number; date: string }> = {};
  for (const r of rows) {
    if (r.value == null || !r.countryiso3code) continue;
    const cur = out[r.countryiso3code];
    if (!cur || r.date > cur.date) out[r.countryiso3code] = { value: r.value, date: r.date };
  }
  return out;
}

// ---------------------------------------------------------------- agreement terms

export interface AgreementTerms {
  dates: string[];
  durations: string[];
  amounts: string[];
  percents: string[];
  clauses: string[];
}

const MONTH = "(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan\\.?|Feb\\.?|Mar\\.?|Apr\\.?|Jun\\.?|Jul\\.?|Aug\\.?|Sept?\\.?|Oct\\.?|Nov\\.?|Dec\\.?)";
const DATE_RE = new RegExp(
  `\\b${MONTH}\\s+\\d{1,2},\\s*(?:19|20)\\d{2}\\b|\\b${MONTH}\\s+(?:19|20)\\d{2}\\b|\\b(?:fiscal(?: year)?|FY)\\s*(?:19|20)\\d{2}\\b|\\b(?:Q[1-4]|(?:first|second|third|fourth) quarter(?: of)?)\\s+(?:fiscal\\s+)?(?:19|20)\\d{2}\\b|\\b(?:through|until|by|in|since|beginning|ending)\\s+(?:19|20)\\d{2}\\b`,
  "gi",
);
const NUMWORD = "(?:\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)";
const DURATION_RE = new RegExp(`\\b${NUMWORD}[- ](?:year|month|quarter)s?\\b(?:[- ](?:term|agreement|contract|period|commitment|supply agreement))?`, "gi");
const AMOUNT_RE = /(?:US)?\$\s?\d[\d,]*(?:\.\d+)?\s?(?:trillion|billion|million|thousand|bn|mm|[BMK]\b)?/gi;
const PCT_RE = /\b\d{1,3}(?:\.\d+)?\s?(?:%|percent\b)/gi;
const CLAUSES: [RegExp, string][] = [
  [/take[- ]or[- ]pay/i, "Take-or-pay"],
  [/prepay|prepaid|advance payment|deposit/i, "Prepayment / deposit"],
  [/non[- ]?cancel+able|cannot be cancel+ed/i, "Non-cancellable"],
  [/purchase (?:obligation|commitment)s?|minimum purchase|commit(?:ted|ment)s? to (?:buy|purchase)/i, "Purchase commitment"],
  [/capacity (?:reservation|agreement|commitment)|reserve(?:d)? capacity/i, "Capacity reservation"],
  [/exclusiv/i, "Exclusivity"],
  [/sole[- ]source|single[- ]source|only (?:supplier|source)|limited number of suppliers/i, "Sole / limited source"],
  [/long[- ]term (?:supply|agreement|contract)/i, "Long-term agreement"],
  [/terminat/i, "Termination right"],
  [/renew|extend(?:ed)? (?:the|its|our) (?:agreement|term)|extension/i, "Renewal / extension"],
  [/licens/i, "Licence"],
  [/warrant(?:s)? to (?:purchase|acquire)|equity stake|invest(?:ed|ment) in/i, "Equity / warrant"],
  [/most[- ]favou?red/i, "Most-favoured terms"],
  [/volume (?:discount|rebate|commitment)|rebate/i, "Volume rebate"],
  [/penalt|liquidated damages/i, "Penalties"],
  [/tariff|export control|license requirement|sanction/i, "Trade-control exposure"],
];

const uniq = (xs: string[]) => [...new Map(xs.map((x) => [x.toLowerCase().replace(/\s+/g, " ").trim(), x.replace(/\s+/g, " ").trim()])).values()];

/** Every date, term length, dollar amount, percentage and contract clause stated in a verbatim quote. */
export function agreementTerms(text: string): AgreementTerms {
  const t = text ?? "";
  return {
    dates: uniq(t.match(DATE_RE) ?? []),
    durations: uniq(t.match(DURATION_RE) ?? []),
    amounts: uniq((t.match(AMOUNT_RE) ?? []).filter((a) => /\d/.test(a))),
    percents: uniq(t.match(PCT_RE) ?? []),
    clauses: CLAUSES.filter(([re]) => re.test(t)).map(([, l]) => l),
  };
}

export const termCount = (a: AgreementTerms) => a.dates.length + a.durations.length + a.amounts.length + a.percents.length + a.clauses.length;

/** Split a quote into plain / highlighted runs for every extracted term, so the UI marks the exact words. */
export function markTerms(text: string, a: AgreementTerms): { s: string; hit: boolean }[] {
  const needles = [...a.dates, ...a.durations, ...a.amounts, ...a.percents].filter(Boolean).sort((x, y) => y.length - x.length);
  if (!needles.length) return [{ s: text, hit: false }];
  const esc = needles.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"));
  const re = new RegExp(`(${esc.join("|")})`, "gi");
  return text.split(re).filter((s) => s !== "").map((s) => ({ s, hit: re.test(s) && (re.lastIndex = 0, true) }));
}
