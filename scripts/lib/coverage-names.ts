// Pure checks for the generated coverage list (scripts/expand-coverage.ts): does a display name name the
// SEC registrant behind its CIK, is it one of the registrant's former names, is the sector plausible for
// the SIC code, and the sourced corrections step. No Node or network APIs, so tests import it directly.

/** Words that say what kind of entity a name is rather than which one. */
const FILLER = new Set([
  "inc", "incorporated", "corp", "corporation", "co", "company", "companies", "holdings", "holding", "group", "ltd",
  "limited", "plc", "the", "and", "of", "sa", "nv", "ag", "se", "lp", "llc", "lc", "llp", "de", "new", "ny", "md", "nj",
  "dela", "del", "a", "an", "for",
]);

/** Meaningful lowercase words of a company name: legal forms, "The", state suffixes and punctuation dropped. */
export function nameWords(name: string): string[] {
  const n = name
    .replace(/\s*\/[A-Z]{2,4}\/?\s*$/i, "") // SEC state suffix: "WELLS FARGO & COMPANY/MN", "/DE/"
    .replace(/\([^)]*\)/g, " ")
    .toLowerCase()
    .replace(/[.'’]/g, "") // "U.S." -> "us", "Macy's" -> "macys"
    .replace(/&/g, ""); // "AT&T" -> "att"
  // Initials written apart are one word: "W. W. Grainger" and "W.W. GRAINGER" both give "ww".
  const words = n.split(/[^a-z0-9]+/).filter(Boolean);
  const merged: string[] = [];
  let initialsRun = false;
  for (const w of words) {
    const letter = w.length === 1 && /[a-z]/.test(w);
    if (letter && initialsRun) merged[merged.length - 1] += w;
    else merged.push(w);
    initialsRun = letter;
  }
  return merged.filter((w) => !FILLER.has(w));
}

/** Initials of a name's words, for short names written as an acronym ("AMD", "IBM"). */
const initials = (words: string[]) => words.map((w) => w[0]).join("");

/** True when two names plainly refer to the same entity: a shared word, one joined into the other, or an acronym. */
export function namesAgree(a: string, b: string): boolean {
  const wa = nameWords(a);
  const wb = nameWords(b);
  if (!wa.length || !wb.length) return false;
  if (wa.some((w) => wb.includes(w))) return true;
  const ja = wa.join("");
  const jb = wb.join("");
  if (ja === jb) return true;
  // "JetBlue" vs "JET BLUE"; "FedEx" vs "FEDEX CORP" is already a shared word. Only words of 4+ letters count.
  if (wa.some((w) => w.length >= 4 && jb.includes(w)) || wb.some((w) => w.length >= 4 && ja.includes(w))) return true;
  // An acronym word against the other name's initials, whole or leading: "GE Aerospace" for GENERAL ELECTRIC.
  const acro = (ws: string[], other: string[]) =>
    ws.some((w) => w.length >= 2 && w.length <= 5 && other.length >= 2 && (initials(other) === w || initials(other.slice(0, w.length)) === w));
  if (acro(wa, wb) || acro(wb, wa)) return true;
  return false;
}

export interface FormerName {
  name: string;
  from?: string;
  to?: string;
}

export type NameVerdict =
  | { kind: "current" }
  | { kind: "former"; former: FormerName }
  | { kind: "unrelated" };

/**
 * How a display name relates to the registrant: it names the current registrant, only one of its former
 * names (stale), or neither (another company).
 */
export function nameVerdict(shortName: string, current: string, former: FormerName[] = []): NameVerdict {
  // A name every word of which a former name holds, while the current name lacks some, is that former
  // name even when one word survives the rename ("Herman Miller" for MILLERKNOLL, "World Fuel Services"
  // for WORLD KINECT).
  const full = former.find((f) => cover(shortName, f.name) === 1);
  if (full && cover(shortName, current) < 1) return { kind: "former", former: full };
  if (namesAgree(shortName, current)) return { kind: "current" };
  const hit = former.find((f) => namesAgree(shortName, f.name));
  return hit ? { kind: "former", former: hit } : { kind: "unrelated" };
}

/** Share of a short name's words that the other name contains as a word (or, for 4+ letters, inside a word). */
export function cover(shortName: string, name: string): number {
  const ws = nameWords(shortName);
  const other = nameWords(name);
  if (!ws.length) return 0;
  const joined = other.join("");
  return ws.filter((w) => other.includes(w) || (w.length >= 4 && joined.includes(w))).length / ws.length;
}

/**
 * A name candidate for the generator (partner display name, Wikidata label) is accepted only when it names
 * the SEC registrant's current name. One that matches only a former name is stale and one that matches
 * nothing belongs to another entity; both fall back to the SEC name.
 */
export const acceptName = (candidate: string | null | undefined, secName: string): boolean =>
  !!candidate && nameVerdict(candidate, secName).kind === "current";

/**
 * Sectors a company with this SIC code can plausibly sit in. Explicit and coarse on purpose: it flags an
 * entry for review, it never assigns a sector. Codes not listed return null (no opinion).
 */
const SIC_SECTORS: [lo: number, hi: number, sectors: string[]][] = [
  [100, 999, ["Consumer Staples", "Materials"]],
  [1000, 1099, ["Materials"]],
  [1220, 1241, ["Energy", "Materials"]],
  [1311, 1389, ["Energy"]],
  [1400, 1499, ["Materials"]],
  [1500, 1799, ["Industrials", "Consumer Discretionary"]],
  [2000, 2111, ["Consumer Staples"]],
  [2800, 2829, ["Materials", "Industrials"]],
  [2833, 2836, ["Health Care"]],
  [2840, 2844, ["Consumer Staples", "Materials"]],
  [2851, 2899, ["Materials"]],
  [2911, 2911, ["Energy"]],
  [3310, 3399, ["Materials", "Industrials", "Information Technology"]],
  [3570, 3579, ["Information Technology"]],
  [3661, 3679, ["Information Technology", "Communication Services", "Industrials"]],
  [3710, 3716, ["Consumer Discretionary", "Industrials"]],
  [3720, 3728, ["Industrials"]],
  [3841, 3851, ["Health Care", "Industrials"]],
  [4011, 4013, ["Industrials"]],
  [4512, 4522, ["Industrials"]],
  [4812, 4899, ["Communication Services", "Information Technology"]],
  [4900, 4949, ["Utilities", "Energy"]],
  [4950, 4959, ["Industrials", "Utilities"]],
  [4960, 4991, ["Utilities", "Energy"]],
  [6021, 6036, ["Financials"]],
  [6311, 6321, ["Financials"]],
  [6324, 6324, ["Health Care", "Financials"]],
  [6331, 6411, ["Financials"]],
  [6798, 6798, ["Real Estate", "Financials"]],
  [7370, 7374, ["Information Technology", "Communication Services", "Industrials", "Financials", "Health Care", "Consumer Discretionary"]],
  [8000, 8099, ["Health Care"]],
];

export function sicSectors(sic: string | number | null | undefined): string[] | null {
  const n = Number(sic);
  if (!Number.isFinite(n) || !n) return null;
  return SIC_SECTORS.find(([lo, hi]) => n >= lo && n <= hi)?.[2] ?? null;
}

/** True when the SIC table has an opinion and the sector is not among the plausible ones. */
export function sectorImplausible(sector: string, sic: string | number | null | undefined): boolean {
  const s = sicSectors(sic);
  return !!s && !s.includes(sector);
}

/**
 * Industries whose members SEC files under a narrow set of SIC codes. An entry in one of these industries
 * with a SIC outside its set is flagged for review ("Chemicals" for a coal miner). Industries not listed
 * get no opinion.
 */
const INDUSTRY_SIC: Record<string, [number, number][]> = {
  Chemicals: [[2800, 2899], [2810, 2819], [3080, 3089], [5160, 5169], [1400, 1499], [6794, 6794], [8731, 8734]],
  Banks: [[6021, 6036], [6099, 6099], [6111, 6199], [6712, 6712], [6211, 6211]],
  "Metals & Mining": [[1000, 1099], [1220, 1241], [1400, 1499], [3310, 3399], [5050, 5051], [6795, 6795]],
};

export function industryImplausible(industry: string, sic: string | number | null | undefined): boolean {
  const ranges = INDUSTRY_SIC[industry];
  const n = Number(sic);
  if (!ranges || !Number.isFinite(n) || !n) return false;
  return !ranges.some(([lo, hi]) => n >= lo && n <= hi);
}

// ---------- sourced corrections ----------
export type CorrectableField = "shortName" | "sector" | "industry" | "group" | "sectorEtf" | "peers";
export interface Correction {
  ticker: string;
  cik: string;
  field: CorrectableField;
  old: string | string[];
  new: string | string[];
  /** The SEC fact that justifies it: registrant name, former name with its end date, or SIC. */
  source: string;
}
export interface Correctable {
  ticker: string;
  cik: string;
  shortName: string;
  sector: string;
  industry: string;
  group?: string;
  sectorEtf: string;
  peers: string[];
}
export interface CorrectionResult<T> {
  entries: T[];
  applied: Correction[];
  /** Corrections not applied, with the reason (ticker missing, CIK differs, old value no longer there). */
  rejected: { correction: Correction; reason: string }[];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Applies each correction whose ticker and CIK match an entry and whose `old` value is still what the entry
 * holds; anything else is reported and left alone, so a rerun after the source changes never overwrites a
 * value nobody checked. Returns new entry objects; the input is not mutated.
 */
export function applyCorrections<T extends Correctable>(entries: T[], corrections: Correction[]): CorrectionResult<T> {
  const out = entries.map((e) => ({ ...e, peers: [...e.peers] }));
  const byTicker = new Map(out.map((e, i) => [e.ticker, i]));
  const applied: Correction[] = [];
  const rejected: CorrectionResult<T>["rejected"] = [];
  for (const c of corrections) {
    const i = byTicker.get(c.ticker);
    if (i === undefined) {
      rejected.push({ correction: c, reason: "ticker not in the list" });
      continue;
    }
    const e = out[i];
    if (e.cik !== c.cik) {
      rejected.push({ correction: c, reason: `CIK is ${e.cik}, correction is for ${c.cik}` });
      continue;
    }
    const now = e[c.field];
    if (same(now, c.new)) continue; // already corrected upstream
    if (!same(now, c.old)) {
      rejected.push({ correction: c, reason: `old value no longer matches (now ${JSON.stringify(now)})` });
      continue;
    }
    if (!c.source.trim()) {
      rejected.push({ correction: c, reason: "no source" });
      continue;
    }
    (e as unknown as Record<string, unknown>)[c.field] = Array.isArray(c.new) ? [...c.new] : c.new;
    applied.push(c);
  }
  return { entries: out, applied, rejected };
}
