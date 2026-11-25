// Pure steps of the quarterly mapping build and of the live check (`scripts/company-source-links.ts`). The script
// does the reading (SEC cover pages, the stored NIC and FR Y-9C files, the FDIC institutions API); every decision
// is made here, so it is tested. Rule version `ein-chain/1`:
// 1. EIN from the cover page of the latest 10-K or 10-Q;
// 2. the NIC entity whose ID_TAX equals it (compared as integers), accepted only when NIC's legal name is the
//    registrant after removing legal forms (otherwise `review`);
// 3. banks: FDIC institutions whose top holder (RSSDHCR) or own RSSD is that entity, else current NIC relationship
//    rows (end date 9999-12-31, CTRL_IND 1) from the entity to a bank;
// 4. each quarter the FDIC record is read again and FR Y-9C total assets are compared with the 10-Q;
// 5. rows are closed with `valid_to`, never deleted.
import { isLive, type CompanyLink, type LinkBasis, type RelationshipStep } from "./types";

export const RULE_VERSION = "ein-chain/1";

const LEGAL_FORMS = /\b(INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|LLC|L L C|LP|L P|PLC|THE)\b/g;
/** State and territory codes SEC appends to a conformed name ("US BANCORP \\DE\\", "FIRST BANCORP /PR/"). */
const STATE_CODES = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR".split(" "));

/** A company name without punctuation, state markers ("/DE/") and legal forms: "THE PNC FINANCIAL SERVICES GROUP, INC." becomes "PNC FINANCIAL SERVICES GROUP". */
export function legalCore(name: string): string {
  const words = name
    .toUpperCase()
    .replace(/\s*\/[A-Z]{2,}\/?\s*$/, " ")
    .replace(/\\[A-Z]{2}\\?/g, " ")
    .replace(/&/g, " AND ")
    .replace(/[.,'"()/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b([A-Z0-9]) (?=[A-Z0-9]\b)/g, "$1")
    .split(" ");
  if (words.length > 2 && STATE_CODES.has(words[words.length - 1])) words.pop();
  return words.join(" ").replace(LEGAL_FORMS, " ").replace(/\s+/g, " ").trim();
}
const sortedWords = (s: string) => s.split(" ").sort().join(" ");

/**
 * Step 2's name rule: NIC's legal name is the registrant when the two cores are equal, initials spelled apart
 * ("U S BANCORP") or words in another order ("SCHWAB CHARLES CORP") included. The EIN is the key; this rule only
 * catches an EIN that NIC carries on another entity (FirstSun's on "BAY POND PARTNERS, L.P.").
 */
export function sameRegistrant(secName: string, nicLegalName: string): boolean {
  const a = legalCore(secName), b = legalCore(nicLegalName);
  return a.length > 0 && (a === b || sortedWords(a) === sortedWords(b));
}

export interface NicEntity {
  row: number;
  rssd: string;
  taxId: string;
  legalName: string;
  entityType: string;
  secStatus: string;
}

/** Index NIC entities by tax ID as an integer string; a tax ID carried by two entities is ambiguous and dropped. */
export function indexByTax(entities: NicEntity[]): Map<string, NicEntity> {
  const out = new Map<string, NicEntity>();
  const twice = new Set<string>();
  for (const e of entities) {
    const n = Number(e.taxId);
    if (!Number.isSafeInteger(n) || n <= 0) continue;
    const k = String(n);
    if (out.has(k)) twice.add(k);
    else out.set(k, e);
  }
  for (const k of twice) out.delete(k);
  return out;
}

export type RegistrantMatch = { status: "proven"; entity: NicEntity } | { status: "review"; entity: NicEntity; reason: string } | { status: "none" };

/** Step 2: the NIC entity of a registrant from its cover-page EIN. */
export function matchRegistrant(ein: string, secName: string, byTax: Map<string, NicEntity>): RegistrantMatch {
  const n = Number(ein);
  if (!/^\d{9}$/.test(ein) || !n) return { status: "none" };
  const entity = byTax.get(String(n));
  if (!entity) return { status: "none" };
  if (sameRegistrant(secName, entity.legalName)) return { status: "proven", entity };
  return { status: "review", entity, reason: `NIC carries the EIN on "${entity.legalName}", which is not the registrant by name` };
}

export interface FdicInstitution {
  CERT: number;
  NAME: string;
  FED_RSSD: string | number | null;
  RSSDHCR: string | number | null;
  ACTIVE: number | string | null;
  REPDTE?: string | null;
  ASSET?: number | null;
}
const rssdText = (v: string | number | null | undefined): string => (v == null ? "" : String(v).replace(/^0+/, ""));

/** Step 3, first route: active FDIC institutions whose top holder or own RSSD is the registrant. */
export function banksByHolder(rssd: string, institutions: FdicInstitution[]): { inst: FdicInstitution; basis: Extract<LinkBasis, "top_holder" | "self"> }[] {
  const out: { inst: FdicInstitution; basis: "top_holder" | "self" }[] = [];
  for (const i of institutions) {
    if (String(i.ACTIVE) !== "1") continue;
    if (rssdText(i.RSSDHCR) === rssd) out.push({ inst: i, basis: "top_holder" });
    else if (rssdText(i.FED_RSSD) === rssd) out.push({ inst: i, basis: "self" });
  }
  return out;
}

export interface NicRelationship {
  row: number;
  parent: string;
  offspring: string;
  ctrlInd: string;
  equityInd: string;
  otherBasisInd: string;
  pctEquity: string | null;
  /** D_DT_END as stored, e.g. "12/31/9999" or "9999-12-31". */
  end: string;
}
const isOpen = (end: string) => /9999/.test(end);

/**
 * Step 3, second route: current controlling relationship rows from the registrant down to an entity that is an FDIC
 * bank, at most `depth` steps. Returns one path per bank reached, each step with its row and control type.
 */
export function walkRelationships(rssd: string, relationships: NicRelationship[], bankRssds: Set<string>, depth = 3): { bank: string; path: string[]; steps: RelationshipStep[] }[] {
  const byParent = new Map<string, NicRelationship[]>();
  for (const r of relationships) {
    if (!isOpen(r.end) || r.ctrlInd !== "1") continue;
    const list = byParent.get(r.parent);
    if (list) list.push(r);
    else byParent.set(r.parent, [r]);
  }
  const out: { bank: string; path: string[]; steps: RelationshipStep[] }[] = [];
  const visit = (at: string, path: string[], steps: RelationshipStep[]) => {
    if (steps.length >= depth) return;
    for (const r of byParent.get(at) ?? []) {
      if (path.includes(r.offspring)) continue;
      const step: RelationshipStep = { offspring: r.offspring, row: r.row, equity_pct: r.equityInd === "1" && r.pctEquity ? r.pctEquity : null, other_basis: r.otherBasisInd === "1", ctrl_ind: "1" };
      const nextPath = [...path, r.offspring];
      if (bankRssds.has(r.offspring)) out.push({ bank: r.offspring, path: nextPath, steps: [...steps, step] });
      else visit(r.offspring, nextPath, [...steps, step]);
    }
  };
  visit(rssd, [rssd], []);
  return out;
}

/** Step 4: whether today's FDIC record still says what the link rests on. */
export function fdicVerdict(link: CompanyLink, live: FdicInstitution | undefined): { ok: boolean; text: string } {
  if (!live) return { ok: false, text: "not returned by the FDIC" };
  const reg = link.evidence.nic?.rssd ?? "";
  const bank = link.evidence.fdic?.bank_rssd ?? "";
  const hcr = rssdText(live.RSSDHCR), fed = rssdText(live.FED_RSSD);
  const active = String(live.ACTIVE) === "1";
  let ok: boolean;
  if (link.basis === "top_holder") ok = hcr === reg && fed === bank;
  else if (link.basis === "self") ok = fed === reg;
  else ok = fed === bank;
  if (ok && active) return { ok: true, text: "agrees" };
  return { ok: false, text: `differs: active ${live.ACTIVE ?? "?"}, top holder RSSD ${hcr || "none"}, bank RSSD ${fed || "none"} (mapping: holder ${link.basis === "top_holder" ? reg : "not used"}, bank ${bank})` };
}

const keyOf = (l: Pick<CompanyLink, "ticker" | "link_kind" | "key_value">) => `${l.ticker}|${l.link_kind}|${l.key_value}`;

/**
 * Step 5: the new mapping from the old one and the rows this run proved. A live row proved again keeps its
 * `valid_from` and takes the new evidence; a live row not proved again is closed (`valid_to` = today); a new row
 * opens today. Closed, review and retired rows are carried over untouched. Nothing is ever removed.
 */
export function mergeLinks(old: CompanyLink[], fresh: CompanyLink[], today: string): { links: CompanyLink[]; opened: CompanyLink[]; closed: CompanyLink[]; kept: number } {
  const next = new Map(fresh.map(l => [keyOf(l), l]));
  const links: CompanyLink[] = [];
  const closed: CompanyLink[] = [];
  let kept = 0;
  const seen = new Set<string>();
  for (const o of old) {
    const k = keyOf(o);
    if (!isLive(o)) {
      links.push(o);
      continue;
    }
    seen.add(k);
    const f = next.get(k);
    if (f) {
      links.push({ ...f, valid_from: o.valid_from ?? f.valid_from, valid_to: null, checked_at: today });
      kept += 1;
    } else {
      const c = { ...o, valid_to: today };
      links.push(c);
      closed.push(c);
    }
  }
  const opened: CompanyLink[] = [];
  for (const f of fresh) {
    const k = keyOf(f);
    if (seen.has(k) || old.some(o => keyOf(o) === k && o.status !== "proven")) continue;
    const n = { ...f, valid_from: f.valid_from ?? today, valid_to: null, checked_at: today };
    links.push(n);
    opened.push(n);
  }
  const order = ["registrant_rssd", "insured_bank", "noninsured_trust_company", "abs_sponsor_bank"];
  links.sort((a, b) => a.ticker.localeCompare(b.ticker) || order.indexOf(a.link_kind) - order.indexOf(b.link_kind) || Number(a.status !== "proven") - Number(b.status !== "proven") || Number(a.key_value) - Number(b.key_value));
  return { links, opened, closed, kept };
}

/** The file as written: one row per line, so a quarterly change reads as a short diff. */
export function serializeLinks(links: CompanyLink[]): string {
  return "[\n" + links.map(l => JSON.stringify(l)).join(",\n") + "\n]\n";
}

/** Reads the EIN from a filing's cover page (R1.htm): the cell after "Entity Tax Identification Number". */
export function coverEin(html: string): string | null {
  const m = html.match(/Entity Tax Identification Number\s*<\/a>\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i);
  if (!m) return null;
  const digits = m[1].replace(/<[^>]+>/g, " ").replace(/&#?\w+;/g, " ").replace(/\D/g, "");
  return digits.length === 9 ? digits : null;
}
