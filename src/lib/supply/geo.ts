// Pure placement logic for the supply-chain globe: where a company or counterparty goes on the map
// and on what basis. No browser/Node APIs. Coordinates come from the generated head-office file
// (scripts/company-hq.ts); nothing here invents a location.
import { canonCountry } from "./analytics";
import { knownHomeCountry } from "./home-country";
export { knownHomeCountry } from "./home-country";
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
  /** home country of a large, unmistakably named foreign company outside coverage */
  | "known-country"
  /** the one country the quoted filing sentence itself names */
  | "filing-region";
export const BASIS_LABEL: Record<PlaceBasis, string> = {
  hq: "Head office",
  "hq-country": "Head-office country",
  "known-country": "Home country of a well-known company (country level)",
  "filing-region": "Country named in the quoted filing sentence",
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

/**
 * Countries a node's links are tied to, in canonical spelling, most often named first.
 * `regions` is filled in by the model that reads the filing and is not checked on its own, so a region only counts
 * when the quoted sentence (which is verified word for word against the filing) names it too.
 */
export function statedCountries(links: RiskLink[]): string[] {
  const tally = new Map<string, number>();
  for (const l of links) {
    const quote = ` ${normText(l.quote ?? "")} `;
    const named = (l.regions ?? []).filter((raw) => {
      const c = canonCountry(raw);
      return !!c && [raw, c].some((w) => new RegExp(`[^a-z]${normText(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^a-z]`).test(quote));
    });
    for (const c of new Set(named.map(canonCountry) as string[])) tally.set(c, (tally.get(c) ?? 0) + 1);
  }
  return [...tally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c]) => c);
}

/**
 * Position of one company or counterparty.
 * Order: head office on file, then the home country of a well-known foreign company (by full name, no ticker), then the single country the quoted filing sentence names.
 * A name tied to several countries, or to none we can draw, stays unplaced rather than being guessed.
 */
export function placeOne(node: Pick<GraphNode, "name" | "ticker" | "links">, hq: Record<string, Hq>, centroid: Centroid): { lon: number; lat: number; place: string; country: string; basis: PlaceBasis; source?: HqSource } | { why: string } {
  const own = node.ticker ? hq[node.ticker] : undefined;
  if (own) return { lon: own.lon, lat: own.lat, place: own.place, country: own.country, basis: own.precision === "city" ? "hq" : "hq-country", source: own.source };
  const known = knownHomeCountry(node.name);
  if (known) {
    const at = centroid(known);
    if (at) return { lon: at[0], lat: at[1], place: known, country: known, basis: "known-country" };
  }
  const stated = statedCountries(node.links as RiskLink[]);
  const drawable = stated.filter((c) => centroid(c));
  if (drawable.length === 1) {
    const at = centroid(drawable[0]) as [number, number];
    return { lon: at[0], lat: at[1], place: drawable[0], country: drawable[0], basis: "filing-region" };
  }
  if (drawable.length > 1) return { why: `filing names ${drawable.length} countries (${drawable.slice(0, 3).join(", ")}${drawable.length > 3 ? ", …" : ""})` };
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
