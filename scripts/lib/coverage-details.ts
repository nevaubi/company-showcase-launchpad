// Pure checks and the sourced corrections step for the descriptive coverage fields (website, IR site,
// founding year, description) that scripts/expand-coverage.ts writes to src/lib/coverage-details.server.ts.
// Flags an entry for review; never decides by itself that a field is wrong. No Node or network APIs.
import { nameWords, namesAgree } from "./coverage-names";
import { sicDescription } from "../../src/lib/sec/sic";

export interface CoverageDetails {
  website?: string;
  ir?: string;
  founded?: number;
  description?: string;
}

/** Second-level labels under a country code that are not the registrant's own word ("co.uk", "com.au"). */
const SECOND_LEVEL = new Set(["co", "com", "net", "org", "gov", "ac"]);

/** Host of a URL or bare domain, lowercased, without a leading "www.". Null when there is no host. */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.trim().toLowerCase().match(/^(?:[a-z]+:\/\/)?([^/?#:\s]+)/);
  if (!m || !m[1].includes(".")) return null;
  return m[1].replace(/^www\d?\./, "");
}

/** Registrable domain: "investors.warriormetcoal.com" -> "warriormetcoal.com", "x.co.uk" -> "x.co.uk". */
export function registrableDomain(url: string | null | undefined): string | null {
  const h = hostOf(url);
  if (!h) return null;
  const parts = h.split(".");
  const n = parts.length >= 3 && parts[parts.length - 1].length === 2 && SECOND_LEVEL.has(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-n).join(".");
}

/** The registrant's own word in a domain: the registrable domain without its public suffix. */
export function domainLabel(url: string | null | undefined): string | null {
  const d = registrableDomain(url);
  return d ? d.split(".")[0] : null;
}

/**
 * True when a website's registrable domain carries one of the company's names: a name word of three or more
 * letters inside it ("warriormetcoal" holds "warrior"), the words joined ("hornbeckoffshore"), the initials
 * ("ufpi" for UFP Industries is a word; "bxp"; "cfsi" for Community Financial System Inc), or a leading
 * run of initials.
 */
export function domainAgrees(url: string | null | undefined, names: string[], ticker?: string): boolean {
  const host = hostOf(url);
  const reg = registrableDomain(url);
  if (!host || !reg) return false;
  // The registrant's word, and for a hosted IR site the company's own subdomain ("hubbell.gcs-web.com").
  const labels = [reg.split(".")[0], ...host.slice(0, host.length - reg.length).split(".").filter((l) => l && !HOST_PREFIX.has(l))].map((l) => l.replace(/-/g, ""));
  return labels.some((l) => labelAgrees(l, names, ticker));
}
/** Subdomains that say what a page is, not whose it is. */
const HOST_PREFIX = new Set(["www", "ir", "investor", "investors", "investorrelations", "corporate", "about", "newsroom", "news"]);
function labelAgrees(label: string, names: string[], ticker?: string): boolean {
  // The exchange ticker as the domain ("jnj.com", "vrtx.com", "rclinvestor.com").
  const tk = ticker?.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (tk && tk.length >= 2 && label.startsWith(tk)) return true;
  for (const name of names) {
    const ws = nameWords(name);
    if (!ws.length) continue;
    if (ws.some((w) => w.length >= 3 && label.includes(w))) return true;
    if (ws.some((w) => w.length >= 2 && label === w)) return true;
    const joined = ws.join("");
    if (joined.length >= 3 && (joined.includes(label) || label.includes(joined))) return true;
    // Initials, with or without the legal-form words nameWords drops ("cfsi": Community Financial System Inc).
    const all = name.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
    for (const ini of [ws.map((w) => w[0]).join(""), all.map((w) => w[0]).join("")])
      if (ini.length >= 2 && (label === ini || (label.startsWith(ini) && ini.length >= 3))) return true;
  }
  return false;
}

/** Lowercase words a company name may hold ("Bank of America", "Dime Savings Bank of Williamsburgh"). */
const NAME_SMALL = new Set(["of", "and", "the", "de", "for", "a", "an", "in", "on", "y", "du", "la", "as", "known"]);
const LEGAL_FORMS = new Set(["plc", "inc", "corp", "co", "ltd", "llc", "lp", "nv", "sa", "se", "ag"]);

/**
 * The name the description opens with: the words before the first comma, parenthesis or "is"/"was"/
 * "are"/"were" of the first sentence, when they read as a proper name (every word capitalised, a number,
 * or a small word like "of"). Null when the description opens with a verb or a noun phrase instead
 * ("Designs and sells iPhone ...", "Parent of Google.", "Accelerated computing company whose ..."), as the
 * hand-written curated entries do.
 */
export function descriptionSubject(description: string): string | null {
  const first = description.split(/(?<=[a-z0-9)][.!?])\s+(?=[A-Z])/)[0];
  const m = first.match(/^(.*?)(?:,|\s\(|\s(?:is|was|are|were)\s)/);
  if (!m) return null;
  const subject = m[1].trim();
  const words = subject.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 8) return null;
  // A plain lowercase word ("computing", "and sells") is prose; legal forms ("plc"), "eBay", "e.l.f.",
  // "/Pa/", "+" and dashes are not.
  const prose = (w: string) => /^[a-z]{2,}$/.test(w) && !NAME_SMALL.has(w) && !LEGAL_FORMS.has(w);
  return /^[A-Za-z0-9"“'(]/.test(words[0]) && !words.some(prose) ? subject : null;
}

/** True when the description's subject names one of the company's names (current, former or short). */
export function descriptionAgrees(description: string | null | undefined, names: string[]): boolean {
  const subject = description ? descriptionSubject(description) : null;
  if (!subject) return true;
  return names.some((n) => !!n && namesAgree(subject, n));
}

/**
 * True when the description speaks of its subject in the past tense ("J2 Global, Inc. was an American
 * technology holding company"): an encyclopedia entry for a predecessor or a defunct entity, not for the
 * registrant as it is. "was founded in 1978" and the like are history, not this.
 */
export function describesDefunct(description: string | null | undefined): boolean {
  if (!description) return false;
  const m = description.match(/^(.{0,160}?)\s(is|was|are|were)\s(\S+)/);
  return !!m && (m[2] === "was" || m[2] === "were") && !/^(founded|established|incorporated|formed|organized|created|started|born|renamed)$/i.test(m[3]);
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());

export interface FallbackFacts {
  /** Display name, already cleaned of legal suffixes. */
  name: string;
  industry: string;
  /** SEC business address. */
  city?: string | null;
  stateOrCountry?: string | null;
  sic?: string | null;
  sicDescription?: string | null;
}

/** The generator's honest description when no encyclopedia entry names the company: SEC facts only. */
export function fallbackDescription(f: FallbackFacts): string {
  const where = f.city ? ` headquartered in ${titleCase(f.city)}, ${f.stateOrCountry ?? ""}`.replace(/, $/, "") : "";
  return `${f.name} is a U.S.-listed ${f.industry.toLowerCase()} company${where} (SEC SIC ${f.sic ?? "—"}: ${titleCase(sicDescription(f.sic, f.sicDescription))}).`;
}

export type DetailField = keyof CoverageDetails;
export interface DetailCorrection {
  ticker: string;
  cik: string;
  field: DetailField;
  /** The value in the generated file this correction replaces; null when the field was empty. */
  old: string | number | null;
  /** The value to write; null removes the field (no website rather than a wrong one). */
  new: string | number | null;
  /** The evidence: SEC field, or filing accession with the words quoted from it, or "fallback sentence". */
  source: string;
}
export interface DetailCorrectionResult {
  details: Record<string, CoverageDetails>;
  applied: DetailCorrection[];
  rejected: { correction: DetailCorrection; reason: string }[];
}

const FIELDS: DetailField[] = ["website", "ir", "founded", "description"];
const valueOf = (d: CoverageDetails | undefined, f: DetailField) => d?.[f] ?? null;

/**
 * Applies detail corrections to the generated details, keyed by ticker. A correction applies only when the
 * ticker's CIK matches, the field still holds the old value and a source is given; one whose new value is
 * already there is skipped silently (fixed upstream). Never mutates its input; keeps field order stable.
 */
export function applyDetailCorrections(
  details: Record<string, CoverageDetails>,
  ciks: Record<string, string>,
  corrections: DetailCorrection[],
): DetailCorrectionResult {
  const out: Record<string, CoverageDetails> = {};
  for (const [t, d] of Object.entries(details)) out[t] = { ...d };
  const applied: DetailCorrection[] = [];
  const rejected: DetailCorrectionResult["rejected"] = [];
  for (const c of corrections) {
    if (!FIELDS.includes(c.field)) {
      rejected.push({ correction: c, reason: `unknown field ${c.field}` });
      continue;
    }
    if (!(c.ticker in ciks)) {
      rejected.push({ correction: c, reason: "ticker not in the list" });
      continue;
    }
    if (ciks[c.ticker] !== c.cik) {
      rejected.push({ correction: c, reason: `CIK is ${ciks[c.ticker]}, correction is for ${c.cik}` });
      continue;
    }
    const now = valueOf(out[c.ticker], c.field);
    if (now === c.new) continue;
    if (now !== c.old) {
      rejected.push({ correction: c, reason: `old value no longer matches (now ${JSON.stringify(now)})` });
      continue;
    }
    if (!c.source.trim()) {
      rejected.push({ correction: c, reason: "no source" });
      continue;
    }
    const next: CoverageDetails = {};
    const cur = out[c.ticker] ?? {};
    for (const f of FIELDS) {
      const v = f === c.field ? c.new : valueOf(cur, f);
      if (v !== null && v !== "" && v !== 0) (next as Record<string, unknown>)[f] = v;
    }
    out[c.ticker] = next;
    applied.push(c);
  }
  return { details: out, applied, rejected };
}
