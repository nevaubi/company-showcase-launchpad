// What kind of place a region a filing names is. Filings and the extraction model put countries, U.S. states, cities,
// basins, provinces and supranational regions in the same `regions` list ("Texas", "Europe", "Taiwan", "Permian Basin",
// "Quebec", "Outside the United States"), and the region register, the region shock and the dossier rate countries.
// The rule runs one way: a name is a country only when it is in the country table below (with its common aliases).
// A U.S. state, a U.S. city, county or sub-region counts toward the United States; a province or city abroad counts toward
// its country when the table knows it; a supranational region is never a country; a negated or residual name ("Outside the
// United States", "Rest of world", "Other") is never a place; anything else is unknown and is never a country row.
// "Georgia" is the U.S. state unless the row's own sentence points at the Caucasus (every filer here is a U.S. filer).

export type PlaceKind =
  | { kind: "country"; country: string }
  | { kind: "state"; state: string; country: "United States" }
  /** a city, county, province, basin or sub-region inside one country */
  | { kind: "local"; name: string; country: string; state?: string }
  | { kind: "region"; region: string }
  /** "Outside the U.S.", "Rest of world", "Other markets": names what it leaves out, or no place at all */
  | { kind: "residual"; name: string }
  | { kind: "unknown"; name: string };

const US_STATE_NAMES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho",
  "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota",
  "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey", "New Mexico", "New York",
  "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota",
  "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming", "District of Columbia",
  "Puerto Rico", "Guam", "U.S. Virgin Islands", "American Samoa", "Northern Mariana Islands",
];
const STATE = new Map(US_STATE_NAMES.map((s) => [s.toLowerCase(), s]));
for (const [k, v] of Object.entries({
  "washington, d.c.": "District of Columbia", "washington d.c.": "District of Columbia", "washington dc": "District of Columbia", "washington, dc": "District of Columbia",
  "hawai'i": "Hawaii", "hawai‘i": "Hawaii", "hawai’i": "Hawaii", "new york state": "New York", "state of new york": "New York",
})) STATE.set(k, v);
const STATE_CODES: Record<string, string> = {
  al: "Alabama", ak: "Alaska", az: "Arizona", ar: "Arkansas", ca: "California", co: "Colorado", ct: "Connecticut", de: "Delaware", dc: "District of Columbia",
  fl: "Florida", ga: "Georgia", hi: "Hawaii", id: "Idaho", il: "Illinois", in: "Indiana", ia: "Iowa", ks: "Kansas", ky: "Kentucky", la: "Louisiana", me: "Maine",
  md: "Maryland", ma: "Massachusetts", mi: "Michigan", mn: "Minnesota", ms: "Mississippi", mo: "Missouri", mt: "Montana", ne: "Nebraska", nv: "Nevada",
  nh: "New Hampshire", nj: "New Jersey", nm: "New Mexico", ny: "New York", nc: "North Carolina", nd: "North Dakota", oh: "Ohio", ok: "Oklahoma", or: "Oregon",
  pa: "Pennsylvania", pr: "Puerto Rico", ri: "Rhode Island", sc: "South Carolina", sd: "South Dakota", tn: "Tennessee", tx: "Texas", ut: "Utah", vt: "Vermont",
  va: "Virginia", wa: "Washington", wv: "West Virginia", wi: "Wisconsin", wy: "Wyoming",
};

/** Sovereign countries and the territories filings treat as one (Hong Kong, Macau, Taiwan, Bermuda...), canonical spelling. */
const COUNTRIES = [
  "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Antigua and Barbuda", "Argentina", "Armenia", "Aruba", "Australia", "Austria",
  "Azerbaijan", "Bahamas", "Bahrain", "Bangladesh", "Barbados", "Belarus", "Belgium", "Belize", "Benin", "Bermuda", "Bhutan", "Bolivia",
  "Bosnia and Herzegovina", "Botswana", "Brazil", "British Virgin Islands", "Brunei", "Bulgaria", "Burkina Faso", "Burundi", "Cambodia",
  "Cameroon", "Canada", "Cape Verde", "Cayman Islands", "Central African Republic", "Chad", "Chile", "China", "Colombia", "Comoros",
  "Costa Rica", "Croatia", "Cuba", "Curacao", "Cyprus", "Czechia", "Democratic Republic of the Congo", "Denmark", "Djibouti", "Dominica",
  "Dominican Republic", "Ecuador", "Egypt", "El Salvador", "Equatorial Guinea", "Eritrea", "Estonia", "Eswatini", "Ethiopia", "Fiji",
  "Finland", "France", "Gabon", "Gambia", "Georgia", "Germany", "Ghana", "Gibraltar", "Greece", "Greenland", "Grenada", "Guatemala",
  "Guernsey", "Guinea", "Guyana", "Haiti", "Honduras", "Hong Kong", "Hungary", "Iceland", "India", "Indonesia", "Iran", "Iraq", "Ireland",
  "Isle of Man", "Israel", "Italy", "Ivory Coast", "Jamaica", "Japan", "Jersey", "Jordan", "Kazakhstan", "Kenya", "Kosovo", "Kuwait",
  "Kyrgyzstan", "Laos", "Latvia", "Lebanon", "Lesotho", "Liberia", "Libya", "Liechtenstein", "Lithuania", "Luxembourg", "Macau",
  "Madagascar", "Malawi", "Malaysia", "Maldives", "Mali", "Malta", "Mauritania", "Mauritius", "Mexico", "Moldova", "Monaco", "Mongolia",
  "Montenegro", "Morocco", "Mozambique", "Myanmar", "Namibia", "Nepal", "Netherlands", "New Zealand", "Nicaragua", "Niger", "Nigeria",
  "North Korea", "North Macedonia", "Norway", "Oman", "Pakistan", "Palestine", "Panama", "Papua New Guinea", "Paraguay", "Peru",
  "Philippines", "Poland", "Portugal", "Qatar", "Republic of the Congo", "Romania", "Russia", "Rwanda", "San Marino", "Saudi Arabia",
  "Senegal", "Serbia", "Seychelles", "Sierra Leone", "Singapore", "Slovakia", "Slovenia", "Somalia", "South Africa", "South Korea",
  "South Sudan", "Spain", "Sri Lanka", "Sudan", "Suriname", "Sweden", "Switzerland", "Syria", "Taiwan", "Tajikistan", "Tanzania",
  "Thailand", "Togo", "Trinidad and Tobago", "Tunisia", "Turkey", "Turkmenistan", "Uganda", "Ukraine", "United Arab Emirates",
  "United Kingdom", "United States", "Uruguay", "Uzbekistan", "Venezuela", "Vietnam", "Yemen", "Zambia", "Zimbabwe",
];
const COUNTRY = new Map(COUNTRIES.map((c) => [c.toLowerCase(), c]));
for (const [k, v] of Object.entries({
  "u.s.": "United States", us: "United States", usa: "United States", "u.s.a.": "United States", "united states of america": "United States",
  america: "United States", "continental united states": "United States", "continental u.s.": "United States", conus: "United States",
  "continental united states (excluding alaska)": "United States", "contiguous united states": "United States", "domestic u.s.": "United States",
  prc: "China", "mainland china": "China", "people's republic of china": "China", "people’s republic of china": "China", "greater china": "China",
  uk: "United Kingdom", "u.k.": "United Kingdom", "great britain": "United Kingdom", britain: "United Kingdom", england: "United Kingdom",
  scotland: "United Kingdom", wales: "United Kingdom", "northern ireland": "United Kingdom",
  korea: "South Korea", "republic of korea": "South Korea", "s. korea": "South Korea", "korea, republic of": "South Korea",
  "the netherlands": "Netherlands", holland: "Netherlands", "czech republic": "Czechia", "russian federation": "Russia", "viet nam": "Vietnam",
  "republic of china": "Taiwan", "taiwan, r.o.c.": "Taiwan", "hong kong sar": "Hong Kong", "macau sar": "Macau", macao: "Macau", "macao sar": "Macau",
  uae: "United Arab Emirates", "u.a.e.": "United Arab Emirates", "türkiye": "Turkey", turkiye: "Turkey", brasil: "Brazil",
  "democratic republic of congo": "Democratic Republic of the Congo", drc: "Democratic Republic of the Congo", "cote d'ivoire": "Ivory Coast",
  "côte d'ivoire": "Ivory Coast", "palestinian authority": "Palestine", "gaza strip": "Palestine", "west bank": "Palestine",
  "kingdom of saudi arabia": "Saudi Arabia", "swiss confederation": "Switzerland", jamica: "Jamaica",
})) COUNTRY.set(k, v);

/** Provinces, states and cities abroad that filings name, with their country. Only names that are not also U.S. places. */
const ABROAD: Record<string, string> = {
  quebec: "Canada", ontario: "Canada", "british columbia": "Canada", alberta: "Canada", saskatchewan: "Canada", manitoba: "Canada",
  "nova scotia": "Canada", "new brunswick": "Canada", newfoundland: "Canada", yukon: "Canada", "northwest territories": "Canada", nunavut: "Canada",
  toronto: "Canada", montreal: "Canada", vancouver: "Canada", calgary: "Canada", montney: "Canada", "drummondville": "Canada", chippawa: "Canada",
  "new south wales": "Australia", queensland: "Australia", "western australia": "Australia", "south australia": "Australia", tasmania: "Australia",
  "northern territory": "Australia", victoria: "Australia", sydney: "Australia", melbourne: "Australia", perth: "Australia", boddington: "Australia",
  greenbushes: "Australia", wodgina: "Australia", cadia: "Australia",
  london: "United Kingdom", manchester: "United Kingdom", edinburgh: "United Kingdom",
  beijing: "China", shanghai: "China", shenzhen: "China", guangzhou: "China", "tongzhou district": "China", dingxing: "China", kazuo: "China",
  tokyo: "Japan", osaka: "Japan", yokkaichi: "Japan", kitakami: "Japan", paris: "France", frankfurt: "Germany", munich: "Germany", berlin: "Germany",
  milan: "Italy", rome: "Italy", madrid: "Spain", barcelona: "Spain", amsterdam: "Netherlands", dublin: "Ireland", zurich: "Switzerland", geneva: "Switzerland",
  "moscow region": "Russia", moscow: "Russia", "amur region": "Russia", "abu dhabi": "United Arab Emirates", dubai: "United Arab Emirates",
  jubail: "Saudi Arabia", "al zahra": "Saudi Arabia", hyderabad: "India", bangalore: "India", bengaluru: "India", mumbai: "India", "new delhi": "India",
  odisha: "India", "tamil nadu": "India", "minas gerais": "Brazil", "são paulo": "Brazil", "sao paulo": "Brazil", sonora: "Mexico", chihuahua: "Mexico",
  mexicali: "Mexico", "la laguna-durango": "Mexico", "guaymas": "Mexico", gresik: "Indonesia", "mimika regency": "Indonesia", lihir: "Papua New Guinea",
  arequipa: "Peru", "la guajira": "Colombia", "dead sea": "Israel", "safi": "Jordan", "seoul": "South Korea", "taipei": "Taiwan", hsinchu: "Taiwan",
};

/** U.S. cities, counties, basins and sub-regions filings name without a state. Ambiguous names (Birmingham, Richmond, Portsmouth) stay out. */
const US_LOCAL = new Set([
  "los angeles", "greater los angeles", "chicago", "suburban chicago", "nashville", "orlando", "denver", "pittsburgh", "atlanta", "greater atlanta",
  "dallas", "houston", "miami", "boston", "seattle", "philadelphia", "san francisco", "san francisco bay area", "south san francisco", "san antonio",
  "san diego", "new orleans", "las vegas", "las vegas strip", "baltimore", "tampa", "tucson", "austin", "albuquerque", "salt lake city", "juneau",
  "little rock", "santa fe", "raleigh-durham", "baltimore-washington", "bossier city", "joliet", "long beach", "visalia", "huntington beach",
  "park city", "new york city", "manhattan", "brooklyn", "detroit", "phoenix", "cleveland", "cincinnati", "columbus, ohio", "st. louis", "kansas city",
  "minneapolis", "milwaukee", "indianapolis", "charlotte", "jacksonville", "sacramento", "portland, oregon", "silicon valley", "long island",
  "upstate new york", "northern new jersey", "northern virginia", "northern california", "southern california", "western pennsylvania",
  "southwest pennsylvania", "southeast pennsylvania", "northeast pennsylvania", "south texas", "west texas", "east texas", "trans-pecos",
  "gulf coast", "u.s. gulf coast", "gulf of america", "gulf of mexico", "atlantic seaboard", "east coast", "west coast", "u.s. west coast",
  "pacific northwest", "new england", "northern new england", "mid-atlantic", "mid-atlantic region", "midwest", "upper midwest", "sun belt", "southeast",
  "southwest", "northeast", "appalachia", "appalachian region of the united states", "dakotas", "northern plains states", "mid-continent", "midcontinent",
  "mid-continent region", "midcontinent region", "stateline area", "texas-mexico border", "carolina long bay", "upper peninsula of michigan",
  "greater new york metropolitan area", "washington, dc/baltimore metropolitan area", "yucca mountain", "indian lands",
  "western interconnection", "pjm", "pjm region", "midcontinent independent system operator region", "ercot", "miso", "caiso",
  "permian basin", "delaware basin", "northern delaware basin", "midland basin", "williston basin", "powder river basin", "denver-julesburg basin",
  "dj basin", "eagle ford", "eagle ford basin", "eagle ford shale", "marcellus", "marcellus shale", "marcellus formation", "utica", "utica shale",
  "utica play", "appalachian basin", "appalachian shale", "haynesville", "haynesville shale", "haynesville formation", "western haynesville",
  "barnett", "barnett shale", "bakken", "anadarko basin", "san juan basin", "uinta basin", "green river basin", "piceance basin",
  "confederated tribes of warm springs reservation", "united states territories", "u.s. territories",
]);
/** U.S. words that make a name local to the United States: "southern U.S.", "Western United States", "Cobb County", "Northeastern U.S.". */
const US_WORDS = /\b(u\.s\.|us|united states)$|\b(u\.s\.|united states)\b|\bcounty\b/i;

/** Names of more than one country. Matched whole, after an optional "the" and a trailing "region". */
const REGIONS = new Set([
  "europe", "western europe", "eastern europe", "central europe", "northern europe", "southern europe", "central and eastern europe",
  "european union", "eu", "e.u.", "eurozone", "euro area", "eea", "european economic area", "nordics", "nordic", "nordic countries", "scandinavia",
  "benelux", "balkans", "cis", "commonwealth of independent states", "european patent organization territory",
  "european patent organization member and extension states", "certain european countries",
  "asia", "east asia", "southeast asia", "south asia", "central asia", "asia pacific", "asia-pacific", "apac", "pacific rim", "asia and pacific",
  "asean", "pacific", "atlantic", "transatlantic",
  "middle east", "mena", "middle east and africa", "middle east and north africa", "gulf", "persian gulf", "gcc", "gulf cooperation council",
  "gulf council countries", "africa", "north africa", "northern africa", "sub-saharan africa", "west africa", "east africa", "southern africa",
  "americas", "north america", "south america", "northern south america", "latin america", "pan-latin america", "central america", "caribbean",
  "caribbean islands", "latam", "western north america", "oceania", "australasia", "emea", "europe, middle east and africa", "channel islands",
]);

/** A name that leaves places out or names none: "Outside the U.S.", "Worldwide excluding China", "Rest of world", "Other countries". */
const RESIDUAL = /\b(exclud\w*|outside|except|other than|ex-|non-)|^(rest of|other\b|others\b|certain\b|various\b|international\b|domestic\b|emerging\b|key\b|select\b|low- and|worldwide\b|global\b|overseas\b|foreign\b|countries\b)|\b(markets|locations|territory|territories)$/i;

/** A sentence that places Georgia in the Caucasus rather than in the United States. */
const GEORGIA_COUNTRY = /\b(tbilisi|batumi|kutaisi|republic of georgia|country of georgia|georgia \(country\)|georgian lari|caucasus|sakartvelo)\b|\bgeorgia\b[^.;]{0,80}\b(armenia|azerbaijan|kazakhstan|uzbekistan|russia|ukraine|turkey|türkiye|moldova|belarus)\b|\b(armenia|azerbaijan|kazakhstan|uzbekistan|ukraine|moldova|belarus)\b[^.;]{0,80}\bgeorgia\b/i;

const norm = (raw: string) => raw.trim().replace(/\s+/g, " ").replace(/^the\s+/i, "");

function countryName(low: string): string | null {
  return COUNTRY.get(low) ?? null;
}

/**
 * Kind of a region a row names, from the name and, for "Georgia", from the row's own sentence. Only names in the country
 * table are countries; everything the tables do not know is unknown, never a country.
 */
export function placeKind(raw: string | null | undefined, evidence = ""): PlaceKind | null {
  if (!raw) return null;
  const t = norm(raw);
  if (!t) return null;
  const low0 = t.toLowerCase();
  const low = low0.replace(/\s+region$/, "");
  if (low === "georgia" || low === "state of georgia") {
    if (low === "georgia" && GEORGIA_COUNTRY.test(evidence)) return { kind: "country", country: "Georgia" };
    return { kind: "state", state: "Georgia", country: "United States" };
  }
  if (REGIONS.has(low0) || REGIONS.has(low)) return { kind: "region", region: t };
  // whole names the tables know come first, so "Northern Territory" or "Continental United States (excluding Alaska)" keep their place
  const state = STATE.get(low0) ?? STATE.get(low.replace(/^state of /, ""));
  if (state) return { kind: "state", state, country: "United States" };
  const country = countryName(low0) ?? countryName(low);
  if (country) return { kind: "country", country };
  const known = ABROAD[low0] ?? ABROAD[low] ?? (US_LOCAL.has(low0) || US_LOCAL.has(low) ? "United States" : null);
  if (known) return { kind: "local", name: t, country: known };
  if (RESIDUAL.test(low0)) return { kind: "residual", name: t };
  // "City, State", "City, ST", "City, Country", "Province, Country"
  const comma = low0.match(/^(.+?),\s*([^,]+)$/);
  if (comma) {
    const tail = comma[2].trim();
    const bare = tail.replace(/\.$/, "");
    const st = STATE.get(tail) ?? STATE.get(bare) ?? STATE_CODES[bare.replace(/\./g, "")];
    if (st) return { kind: "local", name: t, country: "United States", state: st };
    const c = countryName(tail) ?? countryName(bare) ?? ABROAD[bare] ?? null;
    if (c) return { kind: "local", name: t, country: c };
  }
  if (US_WORDS.test(low0)) return { kind: "local", name: t, country: "United States" };
  return { kind: "unknown", name: t };
}

/** The country a region entry counts toward: a country, or the country of a state or a local place; a region, residual or unknown name, none. */
export function countryOf(raw: string | null | undefined, evidence = ""): string | null {
  const k = placeKind(raw, evidence);
  return k?.kind === "country" || k?.kind === "state" || k?.kind === "local" ? k.country : null;
}
