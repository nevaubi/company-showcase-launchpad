// Validation of the company to official-record mapping (`links.json`) and the derived bank guard. Pure: shared by
// the unit test and `scripts/company-source-links.ts check`, so the file is checked the same way in both places.
import { isLive, PROVEN_BASES, type BankGuardEntry, type CompanyLink, type LinkBasis, type LinkKind } from "./types";

export const LINK_KINDS: readonly LinkKind[] = ["registrant_rssd", "insured_bank", "noninsured_trust_company", "abs_sponsor_bank"];
const BASES: readonly LinkBasis[] = ["ein_equal", "top_holder", "self", "nic_equity", "nic_other_basis", "sponsor_bank_chain", "name_match", "name_and_subsidiary_list"];
const KEY_FIELD: Record<LinkKind, string> = { registrant_rssd: "RSSD", insured_bank: "CERT", noninsured_trust_company: "CERT", abs_sponsor_bank: "CIK" };
const KEY_PATTERN: Record<string, RegExp> = { RSSD: /^[1-9]\d{0,9}$/, CERT: /^[1-9]\d{0,6}$/, CIK: /^[1-9]\d{0,9}$/ };
const KIND_BASES: Record<LinkKind, readonly LinkBasis[]> = {
  registrant_rssd: ["ein_equal"],
  insured_bank: ["top_holder", "self", "nic_equity", "nic_other_basis", "name_match", "name_and_subsidiary_list"],
  noninsured_trust_company: ["top_holder", "self", "nic_equity", "nic_other_basis"],
  abs_sponsor_bank: ["sponsor_bank_chain"],
};
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TICKER = /^[A-Z][A-Z0-9.-]{0,9}$/;
const SNAPSHOT = /^[0-9a-f]{64}$/;
const DATASET = /^[a-z0-9_]{3,160}$/;
const ACCESSION = /^\d{10}-\d{2}-\d{6}$/;
const EIN = /^\d{9}$/;
/** Patterns of personal contact details that must never appear in the file. */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE = /\(?\b\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b/;

export interface LinkSummary {
  rows: number;
  tickers: number;
  provenTickers: number;
  byKind: Record<string, number>;
  byStatus: Record<string, number>;
  registrants: number;
  y9cRegistrants: number;
  y9cPointers: number;
  insuredBanks: number;
  trustCompanies: number;
  cohortBanks: number;
  absSponsors: number;
  reviewTickers: string[];
}

const pointerOk = (p: { dataset?: unknown; snapshot?: unknown; row?: unknown } | undefined): boolean =>
  !!p && typeof p.dataset === "string" && DATASET.test(p.dataset) && typeof p.snapshot === "string" && SNAPSHOT.test(p.snapshot) && Number.isSafeInteger(p.row) && (p.row as number) >= 1;

/** Every problem in the file, as sentences that name the row. An empty list means the file is valid. */
export function validateLinks(input: unknown): string[] {
  const problems: string[] = [];
  if (!Array.isArray(input)) return ["links.json is not a list"];
  const links = input as CompanyLink[];
  const text = JSON.stringify(links);
  if (EMAIL.test(text)) problems.push("the file contains an e-mail address");
  if (PHONE.test(text)) problems.push("the file contains a telephone number");
  const seen = new Set<string>();
  const registrant = new Map<string, CompanyLink>();
  for (const [i, l] of links.entries()) {
    const at = `row ${i + 1} (${l?.ticker} ${l?.link_kind} ${l?.key_value})`;
    const bad = (s: string) => problems.push(`${at}: ${s}`);
    if (!l || typeof l !== "object") {
      bad("not an object");
      continue;
    }
    if (typeof l.ticker !== "string" || !TICKER.test(l.ticker)) bad("ticker is not a ticker");
    if (typeof l.cik !== "string" || !/^[1-9]\d{0,9}$/.test(l.cik)) bad("cik is not a CIK");
    if (!LINK_KINDS.includes(l.link_kind)) bad(`unknown link_kind ${l.link_kind}`);
    if (!BASES.includes(l.basis)) bad(`unknown basis ${l.basis}`);
    if (!["proven", "review", "retired"].includes(l.status)) bad(`unknown status ${l.status}`);
    if (l.key_field !== KEY_FIELD[l.link_kind]) bad(`key_field ${l.key_field} does not fit ${l.link_kind}`);
    if (typeof l.key_value !== "string" || !KEY_PATTERN[l.key_field]?.test(l.key_value)) bad(`key ${l.key_value} does not match the ${l.key_field} pattern`);
    if (KIND_BASES[l.link_kind] && !KIND_BASES[l.link_kind].includes(l.basis)) bad(`basis ${l.basis} does not fit ${l.link_kind}`);
    for (const d of [l.valid_from, l.valid_to]) if (d != null && !ISO_DATE.test(d)) bad(`date ${d} is not ISO`);
    if (l.valid_from && l.valid_to && l.valid_to < l.valid_from) bad("valid_to is before valid_from");
    if (!ISO_DATE.test(l.checked_at ?? "")) bad("checked_at is not an ISO date");
    if (typeof l.rule_version !== "string" || !l.rule_version) bad("rule_version is missing");
    const key = `${l.ticker}|${l.link_kind}|${l.key_value}`;
    if (seen.has(key)) bad("duplicate row");
    seen.add(key);
    if (!l.evidence || typeof l.evidence !== "object" || !l.evidence.sec || l.evidence.sec.cik !== l.cik) bad("evidence.sec.cik is not the row's CIK");
    if (!l.evidence?.checks || typeof l.evidence.checks !== "object") bad("evidence.checks is missing");
    if (l.status === "proven") {
      if (!PROVEN_BASES.has(l.basis)) bad(`a proven row cannot rest on ${l.basis}`);
      const sec = l.evidence?.sec;
      if (!sec?.ein || !EIN.test(sec.ein)) bad("proven row without the cover-page EIN");
      if (sec?.ein_source !== "cover") bad("the EIN does not come from the cover page");
      if (!sec?.accession || !ACCESSION.test(sec.accession)) bad("proven row without the filing's accession");
      if (!sec?.cover_url?.startsWith(`https://www.sec.gov/Archives/edgar/data/${l.cik}/`)) bad("cover page address is not the registrant's SEC filing");
      const nic = l.evidence?.nic;
      if (!nic || !pointerOk(nic)) bad("proven row without the stored NIC row");
      else if (nic.tax_id !== String(Number(sec?.ein))) bad(`NIC tax ID ${nic.tax_id} is not the cover EIN ${sec?.ein}`);
      if (l.link_kind === "registrant_rssd") {
        if (nic && nic.rssd !== l.key_value) bad("registrant RSSD differs from its NIC row");
        if (isLive(l)) {
          if (registrant.has(l.ticker)) bad("second live registrant row");
          registrant.set(l.ticker, l);
        }
        const dates = new Set<string>();
        for (const p of l.y9c ?? []) {
          if (!pointerOk(p) || !ISO_DATE.test(p.report_date)) bad(`bad FR Y-9C pointer ${JSON.stringify(p)}`);
          if (dates.has(p.report_date)) bad(`two FR Y-9C rows for ${p.report_date}`);
          dates.add(p.report_date);
        }
      } else if (l.y9c) bad("FR Y-9C pointers on a row that is not the registrant");
      if (l.link_kind === "insured_bank" || l.link_kind === "noninsured_trust_company") {
        const f = l.evidence?.fdic;
        if (!f?.api_url?.startsWith(`https://api.fdic.gov/banks/institutions?filters=CERT%3A${l.key_value}&`)) bad("FDIC record address is not this certificate");
        if (!pointerOk(f as never)) bad("proven bank without its stored FDIC row");
        if (!f?.bank_rssd || !KEY_PATTERN.RSSD.test(f.bank_rssd)) bad("proven bank without its RSSD");
        if ((f?.class === "noninsured_trust") !== (l.link_kind === "noninsured_trust_company")) bad("FDIC class does not match the kind");
        const reg = nic?.rssd;
        if (l.basis === "top_holder" && f?.holder_rssd !== reg) bad("FDIC top holder is not the registrant");
        if (l.basis === "self" && f?.bank_rssd !== reg) bad("the bank's RSSD is not the registrant's");
        if (l.basis === "nic_equity" || l.basis === "nic_other_basis") {
          const rel = l.evidence?.relationship;
          if (!rel || rel.path[0] !== reg || rel.path[rel.path.length - 1] !== f?.bank_rssd || rel.steps.length !== rel.path.length - 1) bad("NIC relationship path does not lead from the registrant to the bank");
          else {
            if (!SNAPSHOT.test(rel.snapshot) || !DATASET.test(rel.dataset)) bad("NIC relationship rows without their snapshot");
            if (rel.steps.some(s => !Number.isSafeInteger(s.row) || s.ctrl_ind !== "1")) bad("a NIC relationship step without control (CTRL_IND 1) or its row");
            if ((l.basis === "nic_other_basis") !== rel.steps.some(s => s.other_basis)) bad("basis does not match the relationship's control type");
            if (l.basis === "nic_equity" && rel.steps.some(s => !s.equity_pct)) bad("an equity step without its percentage");
          }
        }
      }
      if (l.link_kind === "abs_sponsor_bank") {
        const s = l.evidence?.sponsor;
        if (!s || s.cik !== l.key_value || !EIN.test(s.ein) || !KEY_PATTERN.CERT.test(s.cert) || !(s.deals > 0)) bad("sponsor evidence incomplete");
      }
    } else {
      if (PROVEN_BASES.has(l.basis)) bad(`a ${l.status} row must say it rests on a name, not ${l.basis}`);
      if (l.y9c) bad("FR Y-9C pointers on a row that is not proven");
      if (!l.evidence?.why_no_key) bad(`a ${l.status} row must say why no identifier links it`);
    }
  }
  // Every live bank and sponsor belongs to a live registrant row of the same ticker, by the same RSSD.
  const owner = new Map<string, string>();
  for (const l of links) {
    if (!l || l.status === "retired") continue;
    if (l.link_kind === "insured_bank" || l.link_kind === "noninsured_trust_company") {
      const prev = owner.get(l.key_value);
      if (prev && prev !== l.ticker) problems.push(`certificate ${l.key_value} has two owners: ${prev} and ${l.ticker}`);
      owner.set(l.key_value, l.ticker);
    }
    if (!isLive(l) || l.link_kind === "registrant_rssd") continue;
    const reg = registrant.get(l.ticker);
    if (!reg) problems.push(`${l.ticker} ${l.key_value}: no live registrant row`);
    else if (l.evidence?.nic?.rssd !== reg.key_value) problems.push(`${l.ticker} ${l.key_value}: registrant RSSD differs from the registrant row`);
  }
  for (const l of links) {
    if (!isLive(l) || l.link_kind !== "abs_sponsor_bank") continue;
    const cert = l.evidence.sponsor?.cert;
    if (!links.some(b => isLive(b) && b.ticker === l.ticker && b.link_kind === "insured_bank" && b.key_value === cert)) problems.push(`${l.ticker} sponsor ${l.key_value}: certificate ${cert} is not a proven bank of the company`);
  }
  for (const t of registrant.keys()) {
    if (!links.some(l => isLive(l) && l.ticker === t && l.link_kind === "insured_bank") && !registrant.get(t)!.y9c?.length) problems.push(`${t}: a registrant row with neither a bank nor an FR Y-9C`);
  }
  return problems;
}

export function summarizeLinks(links: CompanyLink[]): LinkSummary {
  const count = (f: (l: CompanyLink) => string) => links.reduce<Record<string, number>>((m, l) => ((m[f(l)] = (m[f(l)] ?? 0) + 1), m), {});
  const live = links.filter(isLive);
  const banks = live.filter(l => l.link_kind === "insured_bank");
  return {
    rows: links.length,
    tickers: new Set(links.map(l => l.ticker)).size,
    provenTickers: new Set(live.map(l => l.ticker)).size,
    byKind: count(l => l.link_kind),
    byStatus: count(l => l.status),
    registrants: live.filter(l => l.link_kind === "registrant_rssd").length,
    y9cRegistrants: live.filter(l => l.y9c?.length).length,
    y9cPointers: live.reduce((n, l) => n + (l.y9c?.length ?? 0), 0),
    insuredBanks: banks.length,
    trustCompanies: live.filter(l => l.link_kind === "noninsured_trust_company").length,
    cohortBanks: banks.filter(l => l.evidence.fdic?.cohort500).length,
    absSponsors: live.filter(l => l.link_kind === "abs_sponsor_bank").length,
    reviewTickers: [...new Set(links.filter(l => l.status === "review").map(l => l.ticker))].sort(),
  };
}

export interface BankGuardFile {
  /** Mapped tickers: the certificates the page may show bank rows for, and how a deposits roll-up may be keyed. */
  banks: Record<string, BankGuardEntry & { main: number; name: string }>;
  /** Tickers whose bank panel rests on a name: which caveat applies. */
  review: Record<string, "name_match" | "name_and_subsidiary_list">;
}

/** The small, browser-safe guard derived from the links: proven certificates per ticker and the review caveats. */
export function deriveGuard(links: CompanyLink[]): BankGuardFile {
  const banks: BankGuardFile["banks"] = {};
  const tickers = [...new Set(links.filter(isLive).map(l => l.ticker))].sort();
  for (const t of tickers) {
    const reg = links.find(l => isLive(l) && l.ticker === t && l.link_kind === "registrant_rssd");
    const inst = links.filter(l => isLive(l) && l.ticker === t && (l.link_kind === "insured_bank" || l.link_kind === "noninsured_trust_company"));
    const insured = inst.filter(l => l.link_kind === "insured_bank");
    if (!reg || !insured.length) continue;
    const main = [...insured].sort((a, b) => Number(b.evidence.fdic?.total_assets_k ?? 0) - Number(a.evidence.fdic?.total_assets_k ?? 0))[0];
    const byHolder = inst.every(l => l.basis === "top_holder" || l.basis === "self");
    banks[t] = {
      certs: inst.map(l => Number(l.key_value)).sort((a, b) => a - b),
      rollup: byHolder && inst.some(l => l.basis === "top_holder") ? [reg.key_value] : [],
      main: Number(main.key_value),
      name: reg.evidence.nic?.legal_name ?? reg.entity_name ?? t,
    };
  }
  const review: BankGuardFile["review"] = {};
  for (const l of links) if (l.status === "review" && !banks[l.ticker] && (l.basis === "name_match" || l.basis === "name_and_subsidiary_list")) review[l.ticker] = l.basis;
  return { banks, review };
}
