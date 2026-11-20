// SEC EDGAR business addresses, read from SEC's own index (data.sec.gov/submissions/CIK##########.json),
// turned into something the head-office matcher can place, plus the rule that chooses between head-office sources.
// Pure: no browser or Node APIs. Used by scripts/company-hq.ts; the gazetteer matching itself lives in src/lib/supply/geo.ts.
import { cityKey, type HqRow, US_STATES } from "../supply/geo";

/** One address block from the submissions file, as SEC publishes it (every field may be null). */
export interface SecAddress {
  street1: string | null;
  street2: string | null;
  city: string | null;
  stateOrCountry: string | null;
  stateOrCountryDescription: string | null;
  zipCode: string | null;
  /** present on the live index for foreign addresses, sometimes when stateOrCountry is empty */
  country: string | null;
  countryCode: string | null;
}
/** The parts of a submissions file the head-office script and the cross-checks use. */
export interface SecProfile {
  cik: string;
  name: string;
  sic: string | null;
  sicDescription: string | null;
  fiscalYearEnd: string | null;
  stateOfIncorporation: string | null;
  business: SecAddress | null;
  mailing: SecAddress | null;
}

const short = (v: unknown, max = 120): string | null => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null);
function readAddress(v: unknown): SecAddress | null {
  if (!v || typeof v !== "object") return null;
  const a = v as Record<string, unknown>;
  const out: SecAddress = {
    street1: short(a.street1), street2: short(a.street2), city: short(a.city, 80), stateOrCountry: short(a.stateOrCountry, 4),
    stateOrCountryDescription: short(a.stateOrCountryDescription, 80), zipCode: short(a.zipCode, 20), country: short(a.country, 80), countryCode: short(a.countryCode, 4),
  };
  return Object.values(out).some((x) => x !== null) ? out : null;
}
/** Decode a submissions file. Remote input: only short plain strings are kept; anything else reads as absent. */
export function readSubmissions(json: unknown): SecProfile | null {
  if (!json || typeof json !== "object") return null;
  const j = json as Record<string, unknown>;
  const cik = typeof j.cik === "string" || typeof j.cik === "number" ? String(j.cik).replace(/^0+/, "") : "";
  if (!/^\d{1,10}$/.test(cik)) return null;
  const addr = (j.addresses && typeof j.addresses === "object" ? j.addresses : {}) as Record<string, unknown>;
  return {
    cik, name: short(j.name, 200) ?? "", sic: short(j.sic, 6), sicDescription: short(j.sicDescription, 120),
    fiscalYearEnd: typeof j.fiscalYearEnd === "string" && /^\d{4}$/.test(j.fiscalYearEnd) ? j.fiscalYearEnd : null,
    stateOfIncorporation: short(j.stateOfIncorporation, 4), business: readAddress(addr.business), mailing: readAddress(addr.mailing),
  };
}

/* ---------- countries ---------- */

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
/** Display names matching the spelling used across the supply-chain page and the base map. */
const DISPLAY: Record<string, string> = { HK: "Hong Kong", MO: "Macau", TR: "Turkey", CZ: "Czechia", US: "United States", GB: "United Kingdom", KR: "South Korea", TW: "Taiwan", RU: "Russia", VN: "Vietnam" };
/** English display name of an ISO 3166 alpha-2 code. */
export const countryName = (iso: string): string => DISPLAY[iso] ?? regionNames.of(iso) ?? iso;
const ISO_BY_NAME = new Map<string, string>();
for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
  const iso = String.fromCharCode(a, b);
  let name: string | undefined;
  try { name = regionNames.of(iso); } catch { name = undefined; }
  if (name && name !== iso) ISO_BY_NAME.set(name.toLowerCase(), iso);
}
for (const [iso, name] of Object.entries(DISPLAY)) ISO_BY_NAME.set(name.toLowerCase(), iso);
for (const [alias, iso] of Object.entries({
  "united states of america": "US", usa: "US", us: "US", uk: "GB", "great britain": "GB", england: "GB", scotland: "GB", wales: "GB", "northern ireland": "GB",
  "korea, republic of": "KR", "republic of korea": "KR", "the netherlands": "NL", holland: "NL", "czech republic": "CZ", "russian federation": "RU", "viet nam": "VN",
  "hong kong sar china": "HK", "macao sar china": "MO", "people's republic of china": "CN", "mainland china": "CN", "cayman islands": "KY", bermuda: "BM",
  "türkiye": "TR", "u.s.": "US", "u.k.": "GB", "taiwan, province of china": "TW", "british virgin islands": "VG", "virgin islands, british": "VG",
})) ISO_BY_NAME.set(alias, iso);
/** ISO code of a country name in any of the usual English spellings; null when it is not one. */
export const countryIso = (name: string | null | undefined): string | null => (name ? ISO_BY_NAME.get(name.trim().toLowerCase()) ?? null : null);

/** SEC EDGAR codes for Canadian provinces, mapped to the province codes GeoNames uses. */
export const SEC_CANADA: Record<string, string> = { A0: "01", A1: "02", A2: "03", A3: "04", A4: "05", A5: "07", A6: "08", A7: "09", A8: "10", A9: "11", B0: "12" };
/**
 * SEC EDGAR country codes seen in the covered companies' business addresses, each confirmed against the country name SEC
 * gives beside it. Used only when SEC leaves the name out; an unlisted code is not guessed.
 */
export const SEC_COUNTRY: Record<string, string> = {
  C5: "BS", D0: "BM", E9: "KY", L2: "IE", L3: "IL", O5: "MX", U0: "SG", V8: "CH", X0: "GB",
};

/* ---------- where an address points ---------- */

export type SecPlace =
  | { kind: "us"; state: string; cities: string[] }
  | { kind: "ca"; province: string; cities: string[] }
  | { kind: "foreign"; iso: string; cities: string[] }
  | { kind: "none"; why: string };

/** UK counties and similar regions that SEC filers append to a town ("WOKING SURREY"). */
const TRAILING_REGION = new Set(["surrey", "essex", "kent", "middlesex", "berkshire", "hertfordshire", "hampshire", "oxfordshire", "cambridgeshire", "buckinghamshire", "wiltshire", "bristol", "county dublin", "co dublin", "england", "scotland", "wales"]);

/**
 * City names to try for an SEC city field, most literal first. SEC writes what the filer typed: "HAMILTON BERMUDA",
 * "WARMLEY, BRISTOL", "CO. DUBLIN", "WOKING SURREY". Country and region words are stripped only when they are the
 * address's own country or a known county, so a real two-word city ("NEW YORK") is always tried whole first.
 */
export function cityCandidates(raw: string | null | undefined, countryWords: string[] = []): string[] {
  const out: string[] = [];
  const push = (s: string) => { const t = s.replace(/\s+/g, " ").trim(); if (t.length >= 2 && !out.includes(t)) out.push(t); };
  const base = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!base) return out;
  push(base);
  const parts = base.split(",").map((p) => p.trim()).filter(Boolean);
  for (const p of parts) push(p);
  const strip = new Set([...countryWords.map((w) => cityKey(w)), ...TRAILING_REGION]);
  for (const p of parts.length ? parts : [base]) {
    /* "CO. DUBLIN", "COUNTY CORK" */
    const noCounty = p.replace(/^(co\.?|county)\s+/i, "");
    push(noCounty);
    const words = noCounty.split(" ");
    for (let n = words.length - 1; n >= 1; n--) {
      const tail = cityKey(words.slice(n).join(" "));
      if (strip.has(tail)) push(words.slice(0, n).join(" "));
    }
  }
  return out;
}

/** Read the state or country of an SEC address. Foreign addresses use SEC's own country codes, so the name SEC gives wins. */
export function secPlace(a: SecAddress | null | undefined): SecPlace {
  if (!a) return { kind: "none", why: "no business address" };
  if (!a.city) return { kind: "none", why: "no city in the business address" };
  const code = (a.stateOrCountry ?? a.countryCode ?? "").toUpperCase();
  if (US_STATES[code] && !a.country) return { kind: "us", state: code, cities: cityCandidates(a.city, code === "PR" ? ["puerto rico"] : []) };
  const province = SEC_CANADA[code];
  if (province) return { kind: "ca", province, cities: cityCandidates(a.city, ["canada"]) };
  /* "Ontario, Canada" for provinces; plain country names otherwise */
  const described = [a.country, a.stateOrCountryDescription].map((d) => (d ? d.split(",").pop()!.trim() : null));
  const iso = described.map(countryIso).find(Boolean) ?? SEC_COUNTRY[code] ?? null;
  if (iso === "US") return { kind: "none", why: `U.S. address without a state code (${code || "blank"})` };
  if (iso) return { kind: "foreign", iso, cities: cityCandidates(a.city, [countryName(iso), ...described.filter((d): d is string => !!d)]) };
  return { kind: "none", why: `country code ${code || "blank"} with no country name` };
}

/* ---------- addresses that are not an operating office ---------- */

/** Corporate-services and registered-agent firms whose offices appear as a filer's "business address" (c/o lines). */
const AGENT_NAMES = /\b(maples|intertrust|walkers|conyers|appleby|ogier|mourant|harneys|corporation service company|ct corporation|corporation trust|corporate creations|cogency global|national registered agents|registered agents?|incorp services|corporate services|trust company of)\b/i;
/**
 * Offices of the large Delaware registered agents. Two of them (251 Little Falls Drive) were the SEC business address of
 * covered companies whose cover pages give an operating office elsewhere. Keys are lower-case, punctuation-free "street|city|state".
 */
const AGENT_STREETS: Record<string, string> = {
  "1209 orange street|wilmington|de": "1209 Orange Street, Wilmington DE (CT Corporation, registered agent)",
  "251 little falls drive|wilmington|de": "251 Little Falls Drive, Wilmington DE (Corporation Service Company, registered agent)",
  "2711 centerville road|wilmington|de": "2711 Centerville Road, Wilmington DE (Corporation Service Company, registered agent)",
  "8 the green|dover|de": "8 The Green, Dover DE (registered-agent address)",
  "16192 coastal highway|lewes|de": "16192 Coastal Highway, Lewes DE (Harvard Business Services, registered agent)",
};
const streetKey = (s: string | null) => (s ?? "").toLowerCase().replace(/[.,#]/g, " ").replace(/\b(suite|ste|unit|floor|fl)\b.*$/, "").replace(/\s+/g, " ").trim();
/** A post-office box: SEC still gives the town it sits in, so the city is kept. */
export const isPoBox = (street: string | null | undefined): boolean => /^\s*(p\.?\s*o\.?\s*box|post office box|box\s+\d)/i.test(street ?? "") || /\bp\.?\s*o\.?\s*box\b/i.test(street ?? "");

/**
 * Why an SEC business address is not where the company is run from, or null when nothing says so.
 * A company found here is not placed from SEC: a hand-checked row or the directory is used and the company is listed for checking.
 */
export function agentAddress(a: SecAddress | null | undefined): string | null {
  if (!a) return null;
  const streets = [a.street1, a.street2].filter((s): s is string => !!s);
  for (const s of streets) if (/^\s*c\s*\/\s*o\b/i.test(s) && AGENT_NAMES.test(s)) return `care of a registered agent (${s})`;
  for (const s of streets) if (AGENT_NAMES.test(s)) return `office of a registered agent (${s})`;
  const city = (a.city ?? "").toLowerCase().trim(), state = (a.stateOrCountry ?? "").toLowerCase();
  for (const s of streets) {
    const hit = AGENT_STREETS[`${streetKey(s)}|${city}|${state}`];
    if (hit) return hit;
  }
  return null;
}

/* ---------- choosing between sources ---------- */

/**
 * Head-office row for one company. Order: hand-checked against the filing cover page, then the SEC business address,
 * then the pipeline directory. The directory is used only where SEC gives no usable city: an SEC row placed only to the
 * country gives way to a directory city in that same country, but never to a directory row in another country.
 */
export function chooseHq(verified: HqRow | null | undefined, sec: HqRow | null | undefined, directory: HqRow | null | undefined): HqRow | null {
  if (verified) return verified;
  if (sec && sec[4] === "c") return sec;
  if (sec) return directory && directory[4] === "c" && directory[3] === sec[3] ? directory : sec;
  return directory ?? null;
}

/** Great-circle distance in km between two rows. */
export function kmApart(a: HqRow, b: HqRow): number {
  const R = Math.PI / 180, dLat = (b[0] - a[0]) * R, dLon = (b[1] - a[1]) * R;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * R) * Math.cos(b[0] * R) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
