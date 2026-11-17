// How each company is named in each public registry (Wikipedia article, FDIC bank certificate, CFPB
// company name, NHTSA manufacturer, legal name for full-text searches), built for the whole universe
// by `scripts/alt-registry.ts` and stored at REGISTRY_PATH in the datasets bucket. Pure.
import { normCompany } from "@/lib/xbrl/counterparty";

export interface AltRegistryEntry {
  /** English Wikipedia article title, URL-encoded as in its URL. */
  wiki?: string;
  /** FDIC certificate of the largest insured bank the company owns. */
  fdic?: number;
  /** Company name as filed in the CFPB complaint database. */
  cfpb?: string;
  /** Manufacturer name fragment in NHTSA recall records. */
  maker?: string;
  /** Legal name ("Target Corporation"), for full-text searches where a one-word short name is ambiguous. */
  legal?: string;
}
export type AltRegistry = Record<string, AltRegistryEntry>;
export const REGISTRY_PATH = "alt/registry.json";

export interface AltCo {
  ticker: string;
  sector: string;
  industry: string;
}

const HEALTH = /health|pharma|biotech|medical|life sci|drug/i;

/** Whether a source can say anything about this company, so collectors skip pointless calls. */
export function appliesTo(set: string, c: AltCo, r: AltRegistryEntry | undefined): boolean {
  const both = `${c.sector} ${c.industry}`;
  switch (set) {
    case "fda":
      return HEALTH.test(both) || c.sector === "Consumer Staples" || ["HON", "GE"].includes(c.ticker);
    case "trials":
      return HEALTH.test(both);
    case "medicare":
      return /pharma|biotech/i.test(c.industry);
    case "recalls":
      return !!r?.maker;
    case "complaints":
      return !!r?.cfpb;
    case "bank":
      return !!r?.fdic;
    case "attention":
      return !!r?.wiki;
    default:
      return true;
  }
}

const SUFFIX: Record<string, string> = { CORP: "Corporation", CORPORATION: "Corporation", INC: "Inc.", CO: "Company", COMPANY: "Company", LTD: "Ltd.", PLC: "plc", LLC: "LLC", LP: "L.P.", HOLDINGS: "Holdings", GROUP: "Group", NV: "N.V.", SA: "S.A.", AG: "AG" };
const KEEP_UPPER = /^(US|USA|AT&T|IBM|NV|SA|AG|LLC|LP|II|III|REIT|NRG|PNC|CSX|BNY|UPS|CVS|HP|AES|AMC|CBRE|EOG|PPL|DTE|WEC|AMD)$/;

/** "TARGET CORP" → "Target Corporation", "JPMORGAN CHASE & CO" → "Jpmorgan Chase & Company". */
export function legalName(secName: string): string {
  const words = secName.replace(/\s*\/[A-Z]{2,}\/?$/, "").replace(/[.,]/g, " ").split(/\s+/).filter(Boolean);
  return words
    .map((w, i) => {
      const u = w.toUpperCase();
      if (i === words.length - 1 && SUFFIX[u]) return SUFFIX[u];
      if (KEEP_UPPER.test(u) || /\d/.test(u) || u.length <= 2) return u;
      return u[0] + u.slice(1).toLowerCase();
    })
    .join(" ");
}

/** The CFPB company bucket that is this company: its normalised name starts with ours; the busiest one wins. */
export function pickCfpb(buckets: { key: string; doc_count: number }[], name: string): string | null {
  const n = normCompany(name);
  if (n.length < 3) return null;
  const hit = buckets.filter((b) => {
    const k = normCompany(b.key);
    // one-word names must match exactly ("Capital" is not Capital One)
    return k === n || (n.includes(" ") && k.startsWith(`${n} `));
  });
  return hit.sort((a, b) => b.doc_count - a.doc_count)[0]?.key ?? null;
}

/** The largest active insured bank whose holding company is this company. */
export function pickFdic(rows: { NAMEHCR?: string | null; ASSET?: number | null; CERT: number }[], secName: string): number | null {
  const n = normCompany(secName);
  const hit = rows.filter((r) => r.NAMEHCR && normCompany(r.NAMEHCR.replace(/&/g, " & ")) === n);
  return hit.sort((a, b) => (b.ASSET ?? 0) - (a.ASSET ?? 0))[0]?.CERT ?? null;
}

/** "https://en.wikipedia.org/wiki/Johnson_%26_Johnson" → "Johnson_%26_Johnson". */
export function wikiTitle(url: string): string | null {
  const m = url.match(/\/wiki\/(.+)$/);
  if (!m) return null;
  return encodeURIComponent(decodeURIComponent(m[1])).replace(/%2C/g, ",").replace(/%28/g, "(").replace(/%29/g, ")");
}
