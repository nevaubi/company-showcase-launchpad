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

const BANK_WORDS = /\b(bancorp(oration)?|bcorp|bancshares|bankshares|banc|bank|banking|financial|finl|services?|svcs?|national|association|na|trust|of|and|corp)\b/g;

/** A bank or holding-company name without the words every bank shares: "U S BCORP" and "US BANCORP \DE\" → "us". */
export function bankCore(name: string): string {
  const words = normCompany(name.replace(/[\\/][a-z]{2}(?:[\\/]|$)/gi, " ")).replace(BANK_WORDS, " ").split(/\s+/).filter(Boolean);
  // "u s" → "us": FDIC spells initials apart
  const out: string[] = [];
  let initials = false;
  for (const w of words) {
    if (w.length === 1 && initials) out[out.length - 1] += w;
    else out.push(w);
    initials = w.length === 1;
  }
  return out.join(" ");
}

/**
 * The FDIC certificate of the company's largest bank, from a fuzzy name search: the holding
 * company's name (or, for a bank without one, its own) must reduce to the same core name, and a namesake under a
 * different holding company at least a tenth its size makes the name ambiguous (no match).
 */
export function pickFdicFuzzy(rows: { NAME?: string | null; NAMEHCR?: string | null; ASSET?: number | null; CERT: number }[], secName: string): number | null {
  const core = bankCore(secName);
  if (core.replace(/\s/g, "").length < 2) return null;
  // A bank with a holding company matches only through that holding company (Hilltop Holdings is not
  // the owner of "Hilltop National Bank"); a bank without one (Zions, Flagstar) through its own name.
  const hit = rows.filter((r) => (r.NAMEHCR ? bankCore(r.NAMEHCR) === core : !!r.NAME && bankCore(r.NAME) === core)).sort((a, b) => (b.ASSET ?? 0) - (a.ASSET ?? 0));
  const top = hit[0];
  if (!top || !(top.ASSET ?? 0)) return null;
  const owner = (r: (typeof hit)[number]) => (r.NAMEHCR || r.NAME || "").toUpperCase();
  if (hit.some((r) => owner(r) !== owner(top) && (r.ASSET ?? 0) >= (top.ASSET ?? 0) * 0.1)) return null;
  return top.CERT;
}

/** "https://en.wikipedia.org/wiki/Johnson_%26_Johnson" → "Johnson_%26_Johnson". */
export function wikiTitle(url: string): string | null {
  const m = url.match(/\/wiki\/(.+)$/);
  if (!m) return null;
  return encodeURIComponent(decodeURIComponent(m[1])).replace(/%2C/g, ",").replace(/%28/g, "(").replace(/%29/g, ")");
}

/** Names whose registry match belongs to a different business than the listed company (e.g. GE
 *  appliance recalls predate GE Aerospace and belong to Haier's GE Appliances). */
const NO_MAKER = new Set(["GE"]);

/**
 * A source name matched to more than one company is ambiguous (two "First Bancorp"s), so it is
 * dropped from all of them rather than guessed — unless the tickers are share classes of one
 * filer (same CIK). Known false makers are removed.
 */
export function dedupeRegistry(reg: Record<string, AltRegistryEntry>, cikOf: (ticker: string) => string | undefined): Record<string, AltRegistryEntry> {
  const out: Record<string, AltRegistryEntry> = {};
  const keys = ["wiki", "cfpb", "maker", "fdic"] as const;
  const owners = new Map<string, Set<string>>();
  const id = (k: string, v: unknown) => `${k}:${String(v).toLowerCase()}`;
  for (const [t, e] of Object.entries(reg)) for (const k of keys) if (e[k] != null) {
    const s = owners.get(id(k, e[k])) ?? owners.set(id(k, e[k]), new Set()).get(id(k, e[k]))!;
    s.add(cikOf(t) ?? t);
  }
  for (const [t, e] of Object.entries(reg)) {
    const c: AltRegistryEntry = { ...e };
    for (const k of keys) if (c[k] != null && (owners.get(id(k, c[k]))?.size ?? 0) > 1) delete c[k];
    if (NO_MAKER.has(t)) delete c.maker;
    out[t] = c;
  }
  return out;
}
