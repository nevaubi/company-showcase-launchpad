// Which web-search hits the IR-site collector (irSiteCandidates in ir.server.ts) may take as the company's
// own files. Pure: no network, no database. The old rule took a hit on a content network (q4cdn, gcs-web)
// when the ticker or the first word of the short name was a substring of its title or address, so "on" in
// "presentation" and "fox" in "ridefox" let other companies' decks in. A hit now needs evidence:
//   - its host is the company's own IR or web host (or a subdomain of one, on a label boundary), or
//   - on a content network: the network folder the company's own stored files already use, or a
//     whole-word match of a distinctive name (the full short name, in order) or of the ticker written in
//     capitals, in the title or the address.
// A name is distinctive when it keeps a word that is neither generic (financial, bancorp, energy, holdings,
// group, international...) nor a common English word; a common one-word name ("Apple", "Fox") counts only
// when the hit writes it with its legal form ("Apple Inc.", "Fox Corporation").

/** Hosts whose folders belong to many companies: a hit there proves nothing by its host. */
export const CONTENT_NETWORK = /(^|\.)(q4cdn\.com|gcs-web\.com)$/i;

/** Words that say what a company does or is, not which one it is. */
export const GENERIC_WORDS = new Set([
  "financial", "finance", "bancorp", "bancorporation", "bancshares", "bankshares", "bank", "banks", "banking", "capital",
  "energy", "holdings", "holding", "group", "international", "global", "communications", "corporation", "corp", "inc",
  "company", "companies", "co", "ltd", "limited", "plc", "trust", "partners", "services", "service", "systems", "solutions",
  "technologies", "technology", "industries", "industrial", "resources", "properties", "realty", "reit", "national",
  "american", "america", "united", "first", "general", "pharmaceuticals", "therapeutics", "semiconductor", "health",
  "healthcare", "medical", "insurance", "brands", "products", "enterprises", "investment", "investors", "investor",
  "consolidated", "networks", "software", "entertainment", "media", "motors", "foods", "the", "and", "of", "us", "usa",
  "new", "north", "south", "east", "west", "western", "eastern", "southern", "northern", "community", "city", "state",
]);

/**
 * Common English words that are names or tickers of covered companies (taken from the coverage list's
 * one-word short names and tickers, 24 Nov 2026). Such a word alone never proves a hit is the company's.
 */
export const COMMON_WORDS = new Set([
  "on", "fox", "apple", "coke", "cola", "target", "gap", "pool", "box", "ball", "block", "crane", "dover", "dow", "flex",
  "five", "four", "fun", "golf", "happen", "harmonic", "interface", "lineage", "meta", "news", "noble", "oracle",
  "people", "popular", "progressive", "reliance", "snap", "spire", "strategy", "stride", "strive", "toast", "universal",
  "visa", "waters", "compass", "cactus", "carnival", "coherent", "deluxe", "diodes", "elastic", "everest", "exponent",
  "lemonade", "tapestry", "vertex", "chevron", "crocs", "intel", "amazon", "whirlpool", "hilltop", "plexus", "yelp",
  "banner", "brady", "ford", "life", "all", "are", "air", "app", "car", "cash", "cat", "cost", "deck", "docs", "dorm",
  "eat", "echo", "elf", "eye", "fast", "fix", "fizz", "fly", "form", "gen", "halo", "has", "hope", "hood", "hum", "hut",
  "ice", "key", "low", "main", "mark", "max", "net", "now", "one", "open", "pay", "play", "post", "rare", "real", "run",
  "safe", "save", "see", "ship", "shop", "sign", "site", "star", "sun", "team", "time", "top", "trip", "true", "wing",
  "work", "beam", "beta", "bill", "bio", "cold", "comp", "con", "cube", "curb", "dash", "dell", "elan", "frog", "geo",
  "grail", "info", "kind", "life", "love", "nice", "peak", "pet", "pro", "rent", "rock", "rush", "salt", "seed", "silk",
  "sky", "slab", "snow", "solid", "south", "spot", "steel", "stock", "sure", "tree", "vital", "wave", "well", "wide",
]);

export interface SiteHit {
  url: string;
  title: string;
}
export interface CompanyEvidence {
  ticker: string;
  shortName: string;
  /** hosts of the company's own IR site and website ("investor.apple.com", "apple.com") */
  ownHosts: string[];
  /** content-network folders the company's own stored files already use (see networkFolder) */
  knownFolders: string[];
}

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
};

/** True when host is base or one of its subdomains, on a label boundary ("ir.fox.com" is fox.com's; "ridefox.com" is not). */
export function onHost(host: string, base: string): boolean {
  const b = base.toLowerCase().replace(/^www\./, "");
  return !!b && (host === b || host.endsWith(`.${b}`));
}

/**
 * The company folder of a content-network address: the q4 site id ("q4cdn/470004039", the same on any
 * sNN host) or the gcs-web subdomain ("hubbell.gcs-web.com"). Null for any other address.
 */
export function networkFolder(url: string): string | null {
  const host = hostOf(url);
  if (!host) return null;
  if (/(^|\.)q4cdn\.com$/.test(host)) {
    const id = new URL(url).pathname.split("/")[1];
    return id ? `q4cdn/${id}` : null;
  }
  if (/\.gcs-web\.com$/.test(host)) return host;
  return null;
}

/** Lowercase words of a text: punctuation and hyphens split ("Coca-Cola" -> coca cola), "&" kept as "and". */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const LEGAL_FORMS = new Set(["inc", "incorporated", "corp", "corporation", "co", "company", "ltd", "limited", "plc"]);

/** Index where `needle` occurs as consecutive whole words in `hay`, or -1. */
function phraseAt(hay: string[], needle: string[]): number {
  if (!needle.length) return -1;
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/** A name word that identifies the company: not generic, not a common English word, three letters or more. */
const distinctiveWord = (w: string) => w.length >= 3 && !GENERIC_WORDS.has(w) && !COMMON_WORDS.has(w);

/** True when the title or address names the company by its distinctive full short name. */
export function namesCompany(text: string, shortName: string): boolean {
  const name = words(shortName);
  const hay = words(text);
  const at = phraseAt(hay, name);
  if (at < 0) return false;
  if (name.some(distinctiveWord)) return true;
  // A name made only of common or generic words counts with its legal form right after it.
  return LEGAL_FORMS.has(hay[at + name.length] ?? "");
}

/** True when the ticker stands as a whole word written in capitals ("NASDAQ: NVDA") and is not a common word. */
export function citesTicker(text: string, ticker: string): boolean {
  const t = ticker.toUpperCase();
  if (t.length < 3 || COMMON_WORDS.has(t.toLowerCase())) return false;
  return new RegExp(`(^|[^A-Za-z0-9])${t.replace(/[^A-Z0-9]/g, (c) => `\\${c}`)}($|[^A-Za-z0-9])`).test(text);
}

export type HitVerdict = { own: true; why: "own host" | "known folder" | "name" | "ticker" } | { own: false; why: string };

/** Whether a search hit may be stored as the company's own file, and on what evidence. */
export function judgeHit(hit: SiteHit, c: CompanyEvidence): HitVerdict {
  const host = hostOf(hit.url);
  if (!host) return { own: false, why: "bad address" };
  if (!CONTENT_NETWORK.test(host)) {
    return c.ownHosts.some((h) => onHost(host, h)) ? { own: true, why: "own host" } : { own: false, why: "another host" };
  }
  const folder = networkFolder(hit.url);
  if (folder && c.knownFolders.includes(folder)) return { own: true, why: "known folder" };
  let path = "";
  try {
    path = decodeURIComponent(new URL(hit.url).pathname);
  } catch {
    path = hit.url;
  }
  const text = `${hit.title} ${path}`;
  if (namesCompany(text, c.shortName)) return { own: true, why: "name" };
  if (citesTicker(hit.title, c.ticker) || citesTicker(path, c.ticker)) return { own: true, why: "ticker" };
  return { own: false, why: "content network without evidence" };
}
