import type { Publisher } from "./types";

/**
 * One entry per real publisher, in navigation order. The store's `agency` column holds 55 spellings
 * for these; `publisherFor` maps every one of them. The last three are not publishers and say so.
 */
export const PUBLISHERS: readonly Publisher[] = [
  { id: "frb", name: "Board of Governors of the Federal Reserve System", short: "Federal Reserve" },
  { id: "fdic", name: "Federal Deposit Insurance Corporation", short: "FDIC" },
  { id: "ffiec", name: "National Information Center (Federal Reserve and FFIEC)", short: "FFIEC NIC" },
  { id: "ncua", name: "National Credit Union Administration", short: "NCUA" },
  { id: "ofr", name: "Office of Financial Research", short: "OFR" },
  { id: "sec", name: "U.S. Securities and Exchange Commission", short: "SEC" },
  { id: "eia", name: "U.S. Energy Information Administration", short: "EIA" },
  { id: "epa", name: "U.S. Environmental Protection Agency", short: "EPA" },
  { id: "bsee", name: "Bureau of Safety and Environmental Enforcement", short: "BSEE" },
  { id: "usgs", name: "U.S. Geological Survey, National Minerals Information Center", short: "USGS" },
  { id: "msha", name: "Mine Safety and Health Administration", short: "MSHA" },
  { id: "fhfa", name: "Federal Housing Finance Agency", short: "FHFA" },
  { id: "fda", name: "U.S. Food and Drug Administration", short: "FDA" },
  { id: "cms", name: "Centers for Medicare & Medicaid Services", short: "CMS" },
  { id: "nlm", name: "U.S. National Library of Medicine (ClinicalTrials.gov)", short: "NIH NLM" },
  { id: "faa", name: "Federal Aviation Administration", short: "FAA" },
  { id: "nhtsa", name: "National Highway Traffic Safety Administration", short: "NHTSA" },
  { id: "ers", name: "USDA Economic Research Service", short: "USDA ERS" },
  { id: "usac", name: "Universal Service Administrative Company", short: "USAC" },
  { id: "fcc", name: "Federal Communications Commission", short: "FCC" },
  { id: "cisa", name: "Cybersecurity and Infrastructure Security Agency", short: "CISA" },
  { id: "bls", name: "U.S. Bureau of Labor Statistics", short: "BLS" },
  { id: "bea", name: "U.S. Bureau of Economic Analysis", short: "BEA" },
  { id: "census", name: "U.S. Census Bureau", short: "Census Bureau" },
  { id: "bts", name: "U.S. Bureau of Transportation Statistics", short: "BTS" },
  { id: "eta", name: "U.S. Employment and Training Administration", short: "ETA" },
  { id: "stlouisfed", name: "Federal Reserve Bank of St. Louis", short: "St. Louis Fed" },
  { id: "chicagofed", name: "Federal Reserve Bank of Chicago", short: "Chicago Fed" },
  { id: "freddiemac", name: "Freddie Mac", short: "Freddie Mac" },
  { id: "spdji", name: "S&P Dow Jones Indices", short: "S&P DJI" },
  { id: "worldbank", name: "World Bank", short: "World Bank" },
  { id: "twse", name: "Taiwan Stock Exchange", short: "TWSE" },
  { id: "tpex", name: "Taipei Exchange", short: "TPEx" },
  { id: "company-ir", name: "Company investor relations (JPMorgan Chase, Robinhood)", short: "Company IR" },
  { id: "several", name: "Several agencies", short: "Several agencies" },
  { id: "internal", name: "FiledUnder source registry (not a publisher)", short: "Internal" },
  { id: "unresolved", name: "Publisher not established", short: "Not established" },
];

const BY_ID = new Map(PUBLISHERS.map((p) => [p.id, p]));

/** Stored spellings, lower case, without the "via ..." suffix. */
const ALIASES: Record<string, string> = {
  "federal reserve board": "frb",
  "board of governors of the federal reserve system (us)": "frb",
  fdic: "fdic",
  "federal reserve / ffiec": "ffiec",
  ncua: "ncua",
  "office of financial research": "ofr",
  "us sec": "sec",
  "u.s. securities and exchange commission": "sec",
  "us eia": "eia",
  "us epa": "epa",
  "us doi bsee": "bsee",
  "usgs nmic": "usgs",
  "us dol msha": "msha",
  "federal housing finance agency": "fhfa",
  "u.s. federal housing finance agency": "fhfa",
  "us fda": "fda",
  "centers for medicare & medicaid services": "cms",
  "us nih / national library of medicine": "nlm",
  "federal aviation administration": "faa",
  "national highway traffic safety administration": "nhtsa",
  "usda economic research service": "ers",
  usac: "usac",
  "federal communications commission": "fcc",
  cisa: "cisa",
  "u.s. bureau of labor statistics": "bls",
  "u.s. bureau of economic analysis": "bea",
  "u.s. census bureau": "census",
  "u.s. bureau of transportation statistics": "bts",
  "u.s. employment and training administration": "eta",
  "federal reserve bank of st. louis": "stlouisfed",
  "federal reserve bank of chicago": "chicagofed",
  "freddie mac": "freddiemac",
  "s&p dow jones indices llc": "spdji",
  "world bank": "worldbank",
  "world bank / indicator-specific original provider": "worldbank",
  twse: "twse",
  "taiwan stock exchange": "twse",
  "twse; taiwan stock exchange": "twse",
  tpex: "tpex",
  "taipei exchange": "tpex",
  "jpmorgan chase and robinhood investor relations": "company-ir",
  "filedunder collection specifications": "internal",
  "source attribution unresolved": "unresolved",
};

/** For the one stored placeholder that names no publisher: the host of the retained address decides. */
const PLACEHOLDER = "official publisher identified by retained source url";
const HOSTS: Record<string, string> = {
  "static.nhtsa.gov": "nhtsa",
  "www.nhtsa.gov": "nhtsa",
  "api.nhtsa.gov": "nhtsa",
};

const VIA_FRED = / via Federal Reserve Bank of St\. Louis$/i;

function hostOf(url: string | null | undefined): string | null {
  const m = /^https?:\/\/([^/?#]+)/i.exec(url ?? "");
  return m ? m[1].toLowerCase() : null;
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "unknown"
  );
}

/**
 * The publisher behind a stored `agency` string. Copies republished by FRED keep their original
 * publisher and carry `via: "FRED"`. A string that joins several agencies becomes "Several agencies".
 * An unknown string is returned as its own publisher, so a new source never breaks a screen.
 */
export function publisherFor(
  agency: string,
  sourceUrl?: string | null,
): Publisher & { via?: string } {
  const stored = (agency ?? "").trim();
  const whole = stored.toLowerCase();
  if (whole === PLACEHOLDER) {
    const byHost = HOSTS[hostOf(sourceUrl) ?? ""];
    return { ...BY_ID.get(byHost ?? "unresolved")! };
  }
  const direct = ALIASES[whole];
  if (direct) return { ...BY_ID.get(direct)! };

  const parts = stored
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return { ...BY_ID.get("unresolved")! };
  const via = parts.every((p) => VIA_FRED.test(p));
  const ids = new Set<string>();
  let unknown: string | null = null;
  for (const part of parts) {
    const original = part.replace(VIA_FRED, "").trim();
    const id = ALIASES[original.toLowerCase()];
    if (id) ids.add(id);
    else {
      unknown = original;
      ids.add(`?${original.toLowerCase()}`);
    }
  }
  const tail = via ? { via: "FRED" } : {};
  if (ids.size > 1) return { ...BY_ID.get("several")!, ...tail };
  if (unknown !== null) return { id: slug(unknown), name: unknown, short: unknown, ...tail };
  const only = [...ids][0];
  // FRED is the St. Louis Fed's own service: its own series are not a copy.
  if (only === "stlouisfed") return { ...BY_ID.get(only)! };
  return { ...BY_ID.get(only)!, ...tail };
}
