// Who a firm named in a public registry is. Several sources are searched by phrase or prefix and
// return firms that merely contain the company's name: openFDA's `recalling_firm:"<name>"` returns
// independent Coca-Cola bottlers under KO and "Boston Scientific Target" under TGT; ClinicalTrials.gov's
// lead-sponsor search returns Merck KGaA under Merck & Co.; NHTSA's `manufacturer like '%ITT%'` returns
// "Pitts Enterprises" and "LITTELFUSE INC." under ITT. A record is stored and shown for a company only
// when the firm, as the source spells it, is the company:
//   1. its name core equals one of the company's cores ("Pfizer Inc." is Pfizer), or
//   2. it is the company's name followed only by words that name a unit, site or country of it
//      ("Stryker Endoscopy", "GE Healthcare Finland Oy", "Cardinal Health 200, LLC") or by a unit the
//      company is hand-checked to file under (FIRM_UNITS), never by a word that names an independent
//      business ("Coca Cola Bottling Company United"); a name made only of ordinary words ("Target",
//      "Waters", "National Healthcare") never takes extra words, or
//   3. the firm states its owner in its own name ("Hospira Inc., A Pfizer Company", "Datex Ohmeda,
//      Inc. dba GE Healthcare", "Rx Pak Division of McKesson Corporation") and that owner passes 1 or 2.
// When in doubt the record is not the company's. Pure.
import { nameCore, type CompanyKeys } from "@/lib/alt/contracts";

/** Words that only describe a unit, site, country or business line of the same firm. */
const UNIT_WORDS = new Set(
  (
    "medical med systems system sys vehicles vehicle specialized trucks healthcare health surgical surgery cardiovascular cardiac vascular neurovascular neurological " +
    "neuromodulation neurosurgery spine spinal endoscopy instruments instrument imaging communications orthopaedics orthopedics " +
    "orthobiologics biotech biosciences diagnostics diagnostic div division global supply international usa us america americas " +
    "products product pharmaceuticals pharmaceutical pharma laboratories laboratory labs technologies technology tech solutions services " +
    "manufacturing distribution center facility plant headquarters offices office hq foods food brands consumer nutrition sustainability " +
    "navigation perfusion specialty pharmacy packaging information provider stores store markets wholesale research development it " +
    "integrated clinical life sciences scientific bio therapeutics institute management investment implants consumables ultrasound industries ind general group worldwide innovation enterprise personal care motor motors " +
    "ireland deutschland germany austria finland denmark europe israel india mexico canada china japan korea taiwan singapore australia france italy italia spain benelux puerto rico uk " +
    "companies and of the gmbh kg oy ab sarl srl bv ltda aps sas spa pty kk llc ltd inc corp co"
  ).split(" "),
);

/** Words that name an independent business trading under the company's name (franchise bottlers and the like). */
const OTHER = /\b(bottlers?|bottling|consolidated|beverages|franchise|partners|foundation|employees|union|authority|trust|kgaa)\b/;

/**
 * Ordinary words. A company name made only of these ("Target", "Waters", "National Healthcare",
 * "Universal") matches only its whole name or a stated owner, never the name followed by more words:
 * "Waters Medical Systems LLC" is not Waters Corporation, "National Healthcare Group, Singapore" is
 * not National HealthCare Corporation.
 */
const ORDINARY = new Set(
  (
    "target waters universal capital seaboard merit general united national american first west east north south pacific atlantic " +
    "global premier progressive standard healthcare health care medical international federal state public central"
  ).split(" "),
);

/**
 * Hand-checked units a company's records are filed under that the generic unit words do not cover,
 * as name cores after the company's own core (checked against openFDA recalling firms and
 * ClinicalTrials.gov lead sponsors, 2026-11-20).
 */
export const FIRM_UNITS: Record<string, string[]> = {
  MDT: ["hellas", "minimed", "sofamor danek", "xomed", "corevalve", "physio control", "ave", "ats medical", "advanced energy", "emergency response systems", "image guided neurologics", "heart valve", "heart valves", "gastroenterology / urology", "minimally invasive therapies", "cardiac rhythm", "cardiovascular", "international trade", "powered surgical solutions", "vascular galway", "mitg", "spinal and biologics", "endovascular", "cardiac ablation solutions", "neurovascular clinical affairs", "brc", "surgical technologies", "cardiac surgery", "technologies and new ventures", "diabetes", "latin america", "italia", "france", "comercial"],
  SYK: ["howmedica osteonics", "leibinger", "craniomaxillofacial", "trauma and extremities", "south pacific", "australia", "gi"],
  MRK: ["sharp and dohme"],
  JNJ: ["surgical vision", "vision care", "pharmaceutical research", "consumer", "taiwan", "private", "medical", "enterprise innovation", "health and wellness solutions", "k k medical", "singapore"],
  BDX: ["infusion therapy", "and bd biosciences", "and bd bio sciences"],
  SYY: ["charlotte", "atlanta", "merchandising and supply"],
  MDLZ: ["puerto rico"],
  KR: ["corporate food technology laboratory"],
  KO: ["refreshments"],
  CNMD: ["electrosurgery", "endoscopic technologies", "linvatec"],
  PEP: ["gatorade"],
  AVTR: ["performance materials"],
  AMGN: ["research"],
  AORT: ["europa"],
  INCY: ["biosciences"],
  INSM: ["gene therapy"],
  SOLV: ["orthodontics"],
  VTRS: ["korea"],
  BSX: ["target", "scimed", "crm", "cork", "cupertino", "marlbourgh"],
  THO: ["motor coach", "california"],
  ABT: ["hpd", "hpd/add", "mpg", "medisense"],
  AMRX: ["of new york", "india private"],
  // checked 2026-11-20 against the stored firms the first version of this rule refused (round 2 X3c):
  // the company's own sites and units, and typos of its own name
  STE: ["hopkins", "corportion"],
  TFX: ["creek dr", "morrisville"],
  BIIB: ["ma"],
  MKC: ["and spice mill"],
  WST: ["az"],
  MCK: ["medical immaging"],
  ICUI: ["de mexico"],
  DGX: ["nichols insitute", "nichols institute"],
  BLCO: ["irb"],
  CAH: ["neurocare"],
  CHD: ["ogi"],
  GIS: ["james ford bell technical center"],
  PG: ["hair care"],
  TSN: ["discovery center"],
  WMK: ["ice cream"],
  BIO: ["hercules"],
  BRKR: ["daltonics"],
  PGEN: ["actobio"],
  ZYME: ["bc"],
  BLBD: ["body"],
  TEX: ["south dakota", "advance mixer", "aerial work platforms", "environmental equipment", "load king"],
  MMM: ["traffic safety", "transportation safety"],
  AME: ["icvs"],
};

/** Other whole names a company files under in these registries (hand-checked, 2026-11-20): matched like its own name. */
export const FIRM_ALIASES: Record<string, string[]> = {
  DE: ["John Deere"],
  // Covidien has been Medtronic's since 2015 (Covidien LP is in Medtronic's 10-K Exhibit 21)
  MDT: ["COVIDIEN MEDTRONIC", "Medtronic,Inc/Rice Creek Facil"],
  // PepsiCo's own beverage and Mexican units ("beverages" otherwise marks an independent bottler)
  PEP: ["PepsiCo Beverages & Foods", "Comercializadora Pepsico Mexico"],
  // the Atlanta museum The Coca-Cola Company owns and runs
  KO: ["World of Coca-Cola"],
};

/** The words after a company core, when `core` starts with it as whole words. */
function tailAfter(core: string, k: string): string | null {
  return core === k ? "" : core.startsWith(`${k} `) ? core.slice(k.length + 1) : null;
}

/** Cut "formerly …", a trailing " - site" and a trailing "(note)" off a firm name before matching. */
function base(name: string): string {
  return name
    // NHTSA keeps duplicate maker records named "redundant Winnebago Industries Inc."
    .replace(/^\s*redundant\s+/i, "")
    .replace(/\(?\s*\bformerly\b.*$/i, "")
    .replace(/\s+-\s+.*$/, "")
    .replace(/\b(inc|llc|corp)\.?\s*-\s*\S.*$/i, "$1")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();
}

const firmCore = (name: string) => nameCore(base(name)).replace(/\s+\d+\b/g, "").replace(/\s+/g, " ").trim();

/** Whether a firm name (without an owner statement) is the company by rule 1 or 2. */
function nameIsCompany(name: string, keys: CompanyKeys, units: string[]): boolean {
  const core = firmCore(name);
  if (core.length < 2) return false;
  for (const k of keys.cores) {
    const tail = tailAfter(core, k);
    if (tail === null) continue;
    if (tail === "") return true;
    if (OTHER.test(tail)) continue;
    if (units.some((u) => tail === u || tail.startsWith(`${u} `))) return true;
    if (k.split(" ").every((w) => ORDINARY.has(w))) continue;
    if (tail.split(" ").every((w) => UNIT_WORDS.has(w))) return true;
  }
  return false;
}

/** Owners a firm names in its own name: "X dba Y", "X, a Y Company", "X Division of Y", "a wholly owned subsidiary of Y". */
export function statedOwners(firm: string): string[] {
  const out: string[] = [];
  const s = firm.replace(/\s+/g, " ").trim();
  const dba = s.split(/\s*,?\s*\b(?:dba|d\/b\/a)\b\.?\s*/i);
  if (dba.length > 1) out.push(...dba.slice(1));
  const company = s.match(/(?:,|\s-|\s)\s*an?\s+(.+?)\s+(?:company|co\.?)\s*$/i);
  if (company) out.push(company[1]);
  const of = s.match(/\b(?:(?:wholly[- ]owned\s+)?subsidiary|div\.?|division)\s+of\s+(.+)$/i);
  if (of) out.push(of[1]);
  const division = s.match(/\bdivision,?\s+(?!of\b)(.+)$/i);
  if (division) out.push(division[1]);
  return out.map((x) => x.trim()).filter(Boolean);
}

/** Whether a firm named by a registry is the company (see the header). `units`: FIRM_UNITS of the ticker. */
export function firmIsCompany(firm: string | null | undefined, keys: CompanyKeys, units: string[] = []): boolean {
  if (!firm) return false;
  const s = firm.replace(/\s+/g, " ").trim();
  // the firm itself, and the part before "dba" ("Cardinal Health 303 Inc DBA Alaris Products")
  const head = s.split(/\s*,?\s*\b(?:dba|d\/b\/a)\b/i)[0];
  if (nameIsCompany(s, keys, units) || (head !== s && nameIsCompany(head, keys, units))) return true;
  // "Abbott Nutrition, Abbott Laboratories": a later comma segment that is the whole company name;
  const parts = s.split(/\s*,\s*/);
  if (parts.slice(1).some((p) => keys.cores.has(firmCore(p)))) return true;
  // "Boston Scientific Corporation, Neurovascular, 47900 Bayside Parkway, Fremont, CA": the company
  // followed by a street address (a number in a later segment); never for ordinary-word names
  const first = firmCore(parts[0]);
  if (parts.length > 2 && keys.cores.has(first) && !first.split(" ").every((w) => ORDINARY.has(w)) && parts.slice(1).some((p) => /\d/.test(p))) return true;
  return statedOwners(s).some((o) => nameIsCompany(o, keys, units));
}

/** The company's keys plus its hand-checked FIRM_ALIASES. */
export function withAliases(ticker: string, keys: CompanyKeys): CompanyKeys {
  const extra = FIRM_ALIASES[ticker];
  if (!extra) return keys;
  return { cores: new Set([...keys.cores, ...extra.map((a) => nameCore(a))]), forms: keys.forms };
}

/** A ticker's check: `firmIsCompany` with the ticker's hand-checked aliases and units. */
export function firmCheck(ticker: string, keys: CompanyKeys): (firm: string | null | undefined) => boolean {
  const k = withAliases(ticker, keys);
  const units = FIRM_UNITS[ticker] ?? [];
  return (firm) => firmIsCompany(firm, k, units);
}

/** The fields of a stored `alt_data` row these checks read. */
export interface FirmRowLike {
  dataset: string;
  kind: string;
  meta?: unknown;
}

/**
 * The firm a stored row names, for the datasets matched by firm name: fda (recalling firm; the sponsor
 * for drug approvals), trials (lead sponsor) and recalls (NHTSA manufacturer). `undefined` means the
 * dataset is not checked here; `null` means the row should name a firm and does not.
 */
export function rowFirm(row: FirmRowLike): string | null | undefined {
  const m = (row.meta && typeof row.meta === "object" ? row.meta : {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  if (row.dataset === "fda") return s(m.kind === "approval" ? m.sponsor : m.firm);
  if (row.dataset === "trials") return s(m.sponsor);
  // NHTSA rows written before the manufacturer was recorded cannot be judged from stored fields; the
  // repair script looks each one up by campaign number.
  if (row.dataset === "recalls") return "manufacturer" in m ? s(m.manufacturer) : undefined;
  return undefined;
}

/** Whether a stored row of a firm-matched dataset belongs to its ticker. Other rows pass. */
export function firmRowBelongs(row: FirmRowLike, ticker: string, keys: CompanyKeys): boolean {
  const firm = rowFirm(row);
  return firm === undefined ? true : firmCheck(ticker, keys)(firm);
}

/** A CPSC firm entry ("Wolverine World Wide Inc., of Rockford, Mich.") without its "of <place>" tail. */
export const cpscFirmName = (s: string) => s.replace(/,?\s+of\s+[A-Z][^,]*(,.*)?$/, "").replace(/,\s*an?\s+(subsidiary|division)\b.*$/i, "").trim();

/** The firms a CPSC recall title names as acting: "CPSC, Apple Announce Recall…", "Honeywell Recalls…", "…Recalled by Ross Stores Due to…". */
export function cpscTitleFirms(title: string): string[] {
  const t = title.replace(/^CPSC\s*(,|and)\s*/i, "");
  const out: string[] = [];
  const head = t.split(/\s+(?:Recalls|Recall|Recalled|Reannounces|Announces?|Expands|and CPSC)\b/)[0];
  if (head && head !== t) out.push(...head.split(/\s*(?:,|\band\b)\s*/));
  const by = t.match(/\bRecalled by\s+(.+?)\s+(?:Due|Because|for)\b/i);
  if (by) out.push(by[1]);
  return out.map((x) => x.trim()).filter(Boolean);
}

export interface CpscRecord {
  Title?: string | null;
  Manufacturers?: { Name?: string | null }[] | null;
  Importers?: { Name?: string | null }[] | null;
  Distributors?: { Name?: string | null }[] | null;
  Retailers?: { Name?: string | null }[] | null;
}

/**
 * The company's role in a CPSC recall, or null when the recall is not about it. Maker: a listed
 * manufacturer, importer or distributor, or a firm the title names as recalling, is the company by
 * `firmIsCompany`. Retailer: the recall says it was sold at the company ("Sold Exclusively at
 * Lowe's", a retailer line naming it), matched on the company's name as written (case-sensitive
 * word), so "Caterpillar Pull Toys" and "Red Apple Fireworks" do not count.
 */
export function cpscRole(r: CpscRecord, isCompany: (firm: string) => boolean, displayName: string): "maker" | "retailer" | null {
  const listed = [...(r.Manufacturers ?? []), ...(r.Importers ?? []), ...(r.Distributors ?? [])].map((x) => cpscFirmName(x.Name ?? "")).filter(Boolean);
  if (listed.some(isCompany) || cpscTitleFirms(r.Title ?? "").some(isCompany)) return "maker";
  const name = displayName.trim();
  if (name.length < 2) return null;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // the name as its own proper noun: not the tail of a longer one ("Red Apple Fireworks")
  const word = new RegExp(`(?<![A-Z][\\w&'’.-]*\\s)(?<![A-Za-z0-9])${esc}('s|’s)?(?![A-Za-z0-9])`);
  const soldAt = /\bsold\b[^;]*\b(at|by|on|through)\b/i;
  const plain = (x: string | null | undefined) => (x ?? "").replace(/\bThe\s+/g, "");
  if ((r.Retailers ?? []).some((x) => word.test(plain(x.Name)))) return "retailer";
  const title = plain(r.Title);
  if (soldAt.test(title) && word.test(title.slice(title.search(soldAt)))) return "retailer";
  return null;
}
