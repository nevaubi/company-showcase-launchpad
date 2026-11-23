// Pure placement logic for the supply-chain globe: where a company or counterparty goes on the map
// and on what basis. No browser/Node APIs. Coordinates come from the generated head-office file
// (scripts/company-hq.ts); nothing here invents a location.
import { canonCountry } from "./analytics";
import { knownHomeCountry, US_STATES, usStateOfRegion } from "./home-country";
export { knownHomeCountry, US_STATES, usState, usStateOfRegion } from "./home-country";
import { normText, type GraphNode, type HopNode, type Relation, type RiskLink } from "./core";

/** How exact a head-office position is: the city itself, or only the country. */
export type HqPrecision = "city" | "country";
/** Where the address came from: the SEC business address, a hand-checked filing cover page, or the pipeline's company directory. */
export type HqSource = "sec" | "verified" | "directory";
export interface Hq { lat: number; lon: number; place: string; country: string; precision: HqPrecision; source: HqSource }

/** Compact row in public/data/hq.json: [lat, lon, place, country, "c" city | "n" country only, "s" SEC | "v" verified by hand | "d" directory]. */
export type HqRow = [number, number, string, string, "c" | "n", "s" | "v" | "d"];
export interface HqFile {
  generatedAt: string;
  sources: Record<string, string>;
  counts: { companies: number; city: number; country: number; missing: number; sec?: number; verified?: number; directory?: number };
  companies: Record<string, HqRow>;
  /** covered tickers with no usable address, kept so the gap is visible */
  missing: string[];
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
/** Decode the head-office file, dropping any row that is not a valid position. */
export function readHq(file: HqFile | null | undefined): Record<string, Hq> {
  const out: Record<string, Hq> = {};
  if (!file || typeof file.companies !== "object" || !file.companies) return out;
  for (const [ticker, row] of Object.entries(file.companies)) {
    if (!Array.isArray(row)) continue;
    const [lat, lon, place, country, precision, source] = row as unknown[];
    if (!finite(lat) || !finite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    if (typeof place !== "string" || !place || typeof country !== "string" || !country) continue;
    /* an unknown code is dropped, never read as the more confident claim */
    const p = precision === "c" ? "city" : precision === "n" ? "country" : null;
    const src = source === "s" ? "sec" : source === "v" ? "verified" : source === "d" ? "directory" : null;
    if (!p || !src) continue;
    out[ticker] = { lat, lon, place, country, precision: p, source: src };
  }
  return out;
}

/** Why a marker sits where it does. Shown to the user next to every placed name. */
export type PlaceBasis =
  /** head office of a covered company, to the city */
  | "hq"
  /** head office of a covered company, country only */
  | "hq-country"
  /** home country of a large, unmistakably named foreign company (or a U.S. federal body) outside coverage */
  | "known-country"
  /** the one country the quoted filing sentence itself names */
  | "filing-region"
  /** the one U.S. state the quoted filing sentence itself names */
  | "filing-state";
export const BASIS_LABEL: Record<PlaceBasis, string> = {
  hq: "Head office",
  "hq-country": "Head-office country",
  "known-country": "Home country of a well-known name (country level)",
  "filing-region": "Country named in the quoted filing sentence",
  "filing-state": "U.S. state named in the quoted filing sentence (state level)",
};

/**
 * Geographic centre of each U.S. state, the District of Columbia and Puerto Rico: [latitude, longitude, width in km]
 * (the width is the square root of the state's area). Used to name states on the map once it is close enough, and to
 * place a counterparty the filing ties to exactly one state. Reference geography, not company data.
 */
export const US_STATE_PLACES: Record<string, [number, number, number]> = {
  AL: [32.8, -86.8, 368], AK: [64.0, -152.0, 1313], AZ: [34.2, -111.7, 543], AR: [34.9, -92.4, 371], CA: [37.2, -119.4, 651], CO: [39.0, -105.5, 519],
  CT: [41.6, -72.7, 120], DE: [39.0, -75.5, 80], DC: [38.9, -77.0, 13], FL: [28.6, -82.4, 413], GA: [32.7, -83.4, 392], HI: [20.3, -156.4, 168],
  ID: [44.4, -114.6, 465], IL: [40.0, -89.2, 387], IN: [39.9, -86.3, 307], IA: [42.1, -93.5, 382], KS: [38.5, -98.4, 462], KY: [37.5, -85.3, 324],
  LA: [31.1, -92.0, 368], ME: [45.4, -69.2, 303], MD: [39.0, -76.8, 179], MA: [42.3, -71.8, 165], MI: [44.3, -85.4, 500], MN: [46.3, -94.3, 475],
  MS: [32.7, -89.7, 354], MO: [38.4, -92.5, 425], MT: [47.0, -109.6, 617], NE: [41.5, -99.8, 448], NV: [39.3, -116.6, 535], NH: [43.7, -71.6, 156],
  NJ: [40.2, -74.7, 150], NM: [34.4, -106.1, 561], NY: [42.9, -75.5, 376], NC: [35.6, -79.4, 373], ND: [47.5, -100.5, 428], OH: [40.3, -82.8, 341],
  OK: [35.6, -97.5, 425], OR: [43.9, -120.6, 505], PA: [40.9, -77.8, 345], PR: [18.2, -66.4, 117], RI: [41.7, -71.5, 63], SC: [33.9, -80.9, 288],
  SD: [44.4, -100.2, 447], TN: [35.9, -86.4, 330], TX: [31.5, -99.3, 834], UT: [39.3, -111.7, 469], VT: [44.1, -72.7, 158], VA: [37.5, -78.9, 333],
  WA: [47.4, -120.5, 430], WV: [38.6, -80.6, 251], WI: [44.6, -89.9, 412], WY: [43.0, -107.5, 503],
};
export const SOURCE_LABEL: Record<HqSource, string> = {
  sec: "SEC business address",
  verified: "checked against the filing cover page",
  directory: "company directory",
};

export interface Placed {
  key: string;
  name: string;
  ticker: string | null;
  relation: Relation | "focus";
  hop: 1 | 2;
  /** key of the first-order node a second-order node hangs off */
  parent: string | null;
  lon: number;
  lat: number;
  place: string;
  country: string;
  basis: PlaceBasis;
  /** where a head-office position came from; absent for country-level placements that are not head offices */
  source?: HqSource;
}
export interface Unplaced { key: string; name: string; ticker: string | null; relation: Relation | "focus"; hop: 1 | 2; why: string }
export type Centroid = (country: string) => [number, number] | null;

/** True when the quoted sentence (normalised, padded with spaces) contains the word or phrase as a whole. */
const namesIt = (quote: string, w: string) => new RegExp(`[^a-z]${normText(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^a-z]`).test(quote);

/**
 * Regions a node's links are tied to, in canonical spelling, most often named first.
 * `regions` is filled in by the model that reads the filing and is not checked on its own, so a region only counts
 * when the quoted sentence (which is verified word for word against the filing) names it too.
 * This is also the test `regionsInQuote` (claims.ts) uses to decide which stored regions to keep, so it accepts any
 * named region, a U.S. state included; `statedPlaces` is what tells a state from a country.
 */
export function statedCountries(links: RiskLink[]): string[] {
  const tally = new Map<string, number>();
  for (const l of links) {
    const quote = ` ${normText(l.quote ?? "")} `;
    const named = (l.regions ?? []).filter((raw) => {
      const c = canonCountry(raw);
      return !!c && [raw, c].some((w) => namesIt(quote, w));
    });
    for (const c of new Set(named.map(canonCountry) as string[])) tally.set(c, (tally.get(c) ?? 0) + 1);
  }
  return [...tally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c]) => c);
}

/**
 * The same named regions, split into countries (canonical spelling) and U.S. states (two-letter codes), most often
 * named first. A region that is a U.S. state is a state, never the country that shares its name: "Georgia" is the
 * state unless the sentence points at the Caucasus (see `usStateOfRegion`).
 */
export function statedPlaces(links: RiskLink[]): { countries: string[]; states: string[] } {
  const countries = new Map<string, number>(), states = new Map<string, number>();
  for (const l of links) {
    const quote = ` ${normText(l.quote ?? "")} `;
    const c = new Set<string>(), s = new Set<string>();
    for (const raw of l.regions ?? []) {
      const state = usStateOfRegion(raw, l.quote);
      if (state) { if (namesIt(quote, raw.replace(/^(the )?state of /i, ""))) s.add(state); continue; }
      const canon = canonCountry(raw);
      if (canon && [raw, canon].some((w) => namesIt(quote, w))) c.add(canon);
    }
    for (const x of c) countries.set(x, (countries.get(x) ?? 0) + 1);
    for (const x of s) states.set(x, (states.get(x) ?? 0) + 1);
  }
  const ranked = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
  return { countries: ranked(countries), states: ranked(states) };
}

/**
 * Position of one company or counterparty.
 * Order: head office on file, then the home country of a well-known foreign company (by full name, no ticker), then the
 * one place the quoted filing sentences name: a single U.S. state (state level), several U.S. states (the United States,
 * country level), or a single country. A name tied to places in more than one country, or to none we can draw, stays
 * unplaced rather than being guessed.
 */
export function placeOne(node: Pick<GraphNode, "name" | "ticker" | "links">, hq: Record<string, Hq>, centroid: Centroid): { lon: number; lat: number; place: string; country: string; basis: PlaceBasis; source?: HqSource } | { why: string } {
  const own = node.ticker ? hq[node.ticker] : undefined;
  if (own) return { lon: own.lon, lat: own.lat, place: own.place, country: own.country, basis: own.precision === "city" ? "hq" : "hq-country", source: own.source };
  const known = knownHomeCountry(node.name);
  if (known) {
    const at = centroid(known);
    if (at) return { lon: at[0], lat: at[1], place: known, country: known, basis: "known-country" };
  }
  const stated = statedPlaces(node.links as RiskLink[]);
  const drawable = stated.countries.filter((c) => centroid(c)), abroad = drawable.filter((c) => c !== "United States");
  const states = stated.states.filter((s) => US_STATE_PLACES[s]);
  if (!abroad.length && states.length === 1) {
    const [lat, lon] = US_STATE_PLACES[states[0]];
    return { lon, lat, place: `${US_STATES[states[0]]}, U.S.`, country: "United States", basis: "filing-state" };
  }
  /* every place named is in the United States (several states, or states and the country): country level */
  const places = states.length ? [...abroad, "United States"] : drawable;
  if (places.length === 1) {
    const at = centroid(places[0]);
    if (at) return { lon: at[0], lat: at[1], place: places[0], country: places[0], basis: "filing-region" };
  }
  if (places.length > 1) {
    const named = [...abroad, ...states.map((s) => US_STATES[s]), ...(drawable.includes("United States") && !states.length ? ["United States"] : [])];
    return { why: `filing names ${places.length} countries (${named.slice(0, 3).join(", ")}${named.length > 3 ? ", …" : ""})` };
  }
  return { why: node.ticker ? "no head office on file" : "no location stated in the filing" };
}

const isHop = (n: GraphNode | HopNode): n is HopNode => (n as HopNode).hop === 2;

/** Split the focus graph into names we can put on the map and names we cannot. The focus company is not included. */
export function placeGraph(nodes: (GraphNode | HopNode)[], hq: Record<string, Hq>, centroid: Centroid): { placed: Placed[]; unplaced: Unplaced[] } {
  const placed: Placed[] = [], unplaced: Unplaced[] = [];
  for (const n of nodes) {
    const hop: 1 | 2 = isHop(n) ? 2 : 1, parent = isHop(n) ? n.parent : null;
    const at = placeOne(n, hq, centroid);
    if ("why" in at) unplaced.push({ key: n.key, name: n.name, ticker: n.ticker, relation: n.relation, hop, why: at.why });
    else placed.push({ key: n.key, name: n.name, ticker: n.ticker, relation: n.relation, hop, parent, ...at });
  }
  return { placed, unplaced };
}

/**
 * Ends of the line between the company (or a first-order name) and a counterparty, in the direction supply moves:
 * a supplier ships to the anchor, the anchor ships to a customer. Partnerships run both ways; a competitor is not a flow.
 */
export function arcEnds(relation: Relation, anchor: [number, number], node: [number, number]): { a: [number, number]; b: [number, number]; twoWay: boolean; plain: boolean } {
  if (relation === "supplier") return { a: node, b: anchor, twoWay: false, plain: false };
  if (relation === "customer") return { a: anchor, b: node, twoWay: false, plain: false };
  return { a: anchor, b: node, twoWay: relation === "partner", plain: relation === "competitor" };
}

/**
 * Camera that takes in a set of places on a globe: centred on their mean direction and zoomed until the farthest one
 * still faces the viewer (zoom 1 shows a whole hemisphere). Places spread around the world cancel out, so the first
 * place (the company) is used as the centre then.
 */
export function frameAll(points: [number, number][]): { lon: number; lat: number; zoom: number } {
  const R = Math.PI / 180, ok = points.filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));
  if (!ok.length) return { lon: 0, lat: 0, zoom: 1 };
  let x = 0, y = 0, z = 0;
  for (const [lon, lat] of ok) { x += Math.cos(lat * R) * Math.cos(lon * R); y += Math.cos(lat * R) * Math.sin(lon * R); z += Math.sin(lat * R); }
  const n = Math.hypot(x, y, z);
  const [lon, lat] = n / ok.length < 0.05 ? ok[0] : [Math.atan2(y, x) / R, Math.asin(z / n) / R];
  let far = 0;
  for (const [pl, pa] of ok) {
    const c = Math.sin(lat * R) * Math.sin(pa * R) + Math.cos(lat * R) * Math.cos(pa * R) * Math.cos((pl - lon) * R);
    far = Math.max(far, Math.acos(Math.max(-1, Math.min(1, c))));
  }
  const zoom = far < 0.05 ? 6 : far >= 1.25 ? 1 : Math.min(6, Math.max(1, 0.86 / Math.sin(far)));
  return { lon, lat: Math.max(-60, Math.min(70, lat)), zoom };
}

/* ---------- address to gazetteer matching (used by scripts/company-hq.ts, tested here) ---------- */

/** Lower-case, accent-free city name with the usual abbreviations spelled out, so "ST. LOUIS" meets "Saint Louis". */
export function cityKey(raw: string): string {
  return raw
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.']/g, "")
    .replace(/[-_/]/g, " ")
    .replace(/\bst\b/g, "saint").replace(/\bste\b/g, "sainte").replace(/\bft\b/g, "fort").replace(/\bmt\b/g, "mount").replace(/\bhts\b/g, "heights").replace(/\bspgs\b/g, "springs").replace(/\bn\b(?= \w)/g, "north").replace(/\bs\b(?= \w)/g, "south")
    .replace(/\s+/g, " ")
    .trim();
}

/** Display form of an upper-case SEC city: "SANTA CLARA" becomes "Santa Clara". Mixed-case input is kept. */
export function cityLabel(raw: string): string {
  const t = raw.trim().replace(/\s+/g, " ");
  if (t !== t.toUpperCase() && t !== t.toLowerCase()) return t;
  return t.toLowerCase().replace(/(^|[\s\-/.(])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase()).replace(/\bMc([a-z])/g, (_, c: string) => `Mc${c.toUpperCase()}`);
}

/** English names of cities the gazetteer lists under their local name (keys and values are city keys). */
const EXONYM: Record<string, string> = {
  geneva: "geneve", munich: "munchen", cologne: "koln", vienna: "wien", prague: "praha", copenhagen: "kobenhavn", warsaw: "warszawa", lisbon: "lisboa",
  rome: "roma", milan: "milano", florence: "firenze", turin: "torino", naples: "napoli", venice: "venezia", seville: "sevilla", gothenburg: "goteborg",
  antwerp: "antwerpen", ghent: "gent", nuremberg: "nurnberg", hanover: "hannover", galway: "gaillimh", limerick: "luimneach", bucharest: "bucuresti",
};

/** True when the gazetteer lists this city under a local name (Geneva is "Genève"), so the English name should be shown. */
export const isExonym = (city: string): boolean => cityKey(city) in EXONYM;

export interface GazCity { name: string; alt?: string; country: string; admin?: string; pop: number; lat: number; lon: number }
/** Index a gazetteer by city key, keeping every same-named city so the caller can choose by country and state. */
export function indexCities(cities: GazCity[]): Map<string, GazCity[]> {
  const out = new Map<string, GazCity[]>();
  const add = (k: string, c: GazCity) => { if (!k) return; const l = out.get(k); if (l) { if (!l.includes(c)) l.push(c); } else out.set(k, [c]); };
  for (const c of cities) {
    add(cityKey(c.name), c);
    /* "Washington, D.C." is also findable as "Washington" */
    if (c.name.includes(",")) add(cityKey(c.name.split(",")[0]), c);
    for (const a of (c.alt ?? "").split(",")) if (a.trim() && /^[\x20-\x7eÀ-ɏ]+$/.test(a)) add(cityKey(a), c);
  }
  return out;
}

/**
 * The gazetteer city for an address. `country` is an ISO 3166 alpha-2 code; `admin` is the state or province code the gazetteer uses.
 * With a state the match must be in that state; without one the largest same-named city in the country wins.
 * Returns null instead of a guess when nothing in the right country (and state) carries the name.
 */
export function matchCity(index: Map<string, GazCity[]>, city: string, country: string, admin?: string | null): GazCity | null {
  const base = cityKey(city);
  const tries = [base];
  const push = (k: string) => { if (k && !tries.includes(k)) tries.push(k); };
  push(base.split(",")[0].trim());
  /* postal districts: "Dublin 2", "Singapore 018989" */
  push(base.replace(/ \d[\d ]*$/, ""));
  push(base.replace(/ (city|township|twp|village|borough)$/, ""));
  /* GeoNames spells the five boroughs' city "New York City" */
  push(`${base} city`);
  if (EXONYM[base]) push(EXONYM[base]);
  for (const k of tries) {
    const hits = (index.get(k) ?? []).filter((c) => c.country === country && (!admin || c.admin === admin));
    if (hits.length) return hits.reduce((a, b) => (b.pop > a.pop ? b : a));
  }
  /* "Tysons" for "Tysons Corner": accepted only inside a named state and only when exactly one city starts with the name */
  if (admin && base.length >= 5) {
    const starts: GazCity[] = [];
    for (const [k, list] of index) if (k.startsWith(`${base} `)) for (const c of list) if (c.country === country && c.admin === admin && !starts.includes(c)) starts.push(c);
    if (starts.length === 1) return starts[0];
  }
  return null;
}
