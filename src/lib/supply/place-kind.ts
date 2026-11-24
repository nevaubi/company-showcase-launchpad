// What kind of place a region a filing names is: a country, a U.S. state or territory, or a supranational region. Filings
// and the extraction model put all three in the same `regions` list ("Texas", "Europe", "Taiwan"), and the region register,
// the region shock and the dossier rate countries. A state counts toward the United States; a supranational region is never
// rated as a country. "Georgia" is decided from the row's own sentence; when the sentence cannot tell, it is not a country.
import { canonCountry } from "./analytics";

export type PlaceKind =
  | { kind: "country"; country: string }
  | { kind: "state"; state: string; country: "United States" }
  | { kind: "region"; region: string }
  | { kind: "unknown"; name: string };

const US_STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "Florida", "Hawaii", "Idaho",
  "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota",
  "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey", "New Mexico", "New York",
  "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota",
  "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming", "District of Columbia",
  "Washington, D.C.", "Washington D.C.", "Puerto Rico", "Guam", "U.S. Virgin Islands", "American Samoa", "Northern Mariana Islands",
];
const STATE = new Map(US_STATES.map((s) => [s.toLowerCase(), s]));

/** Names of more than one country. Matched whole, after an optional "the" and a trailing "region". */
const REGIONS = new Set([
  "europe", "western europe", "eastern europe", "central europe", "northern europe", "southern europe", "central and eastern europe",
  "european union", "eu", "eurozone", "euro area", "nordics", "nordic", "scandinavia", "benelux", "balkans",
  "asia", "east asia", "southeast asia", "south asia", "central asia", "asia pacific", "asia-pacific", "apac", "pacific rim", "asia and pacific",
  "middle east", "the middle east", "mena", "middle east and africa", "middle east and north africa", "gulf", "persian gulf", "gcc",
  "africa", "north africa", "sub-saharan africa", "west africa", "east africa", "southern africa",
  "americas", "the americas", "north america", "south america", "latin america", "central america", "caribbean", "latam",
  "oceania", "australasia", "emea", "europe, middle east and africa", "rest of world", "rest of the world", "international",
  "worldwide", "global", "overseas", "foreign", "other", "other countries", "other regions",
]);

/** A sentence that places "Georgia" in the United States: a Georgia city, the state's abbreviation, or the word "state". */
const GEORGIA_US = /\b(atlanta|savannah|augusta|columbus|macon|athens|alpharetta|norcross|duluth|marietta|kennesaw|peachtree|dalton|albany|valdosta|gainesville|rome|lagrange|brunswick|covington|conyers|lawrenceville|suwanee|roswell|cartersville|jefferson)\s*,?\s*(georgia|ga)\b|\bstate of georgia\b|\bgeorgia\s*,?\s*(u\.?s\.?a?\.?|united states)\b|\b(atlanta|savannah),?\s*ga\b/i;
/** A sentence that places Georgia in the Caucasus. */
const GEORGIA_COUNTRY = /\b(tbilisi|batumi|kutaisi|republic of georgia|country of georgia|caucasus|sakartvelo)\b/i;

/**
 * Kind of a region a row names, decided from the name and, for a name that is both a state and a country, from the row's
 * own sentence. A name that is neither a state nor a supranational region is a country (canonical spelling).
 */
export function placeKind(raw: string | null | undefined, evidence = ""): PlaceKind | null {
  if (!raw) return null;
  const t = raw.trim().replace(/\s+/g, " ").replace(/^the\s+/i, "");
  if (!t) return null;
  const low = t.toLowerCase().replace(/\s+region$/, "");
  if (low === "georgia") {
    if (GEORGIA_COUNTRY.test(evidence)) return { kind: "country", country: "Georgia" };
    if (GEORGIA_US.test(evidence)) return { kind: "state", state: "Georgia", country: "United States" };
    return { kind: "unknown", name: "Georgia" };
  }
  const state = STATE.get(low);
  if (state) return { kind: "state", state, country: "United States" };
  if (REGIONS.has(low)) return { kind: "region", region: t };
  const country = canonCountry(t);
  return country ? { kind: "country", country } : null;
}

/** The country a region entry counts toward: a state counts for the United States; a supranational or undecided name for none. */
export function countryOf(raw: string | null | undefined, evidence = ""): string | null {
  const k = placeKind(raw, evidence);
  return k?.kind === "country" ? k.country : k?.kind === "state" ? k.country : null;
}
