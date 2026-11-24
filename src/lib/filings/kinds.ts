// What a filing is, in plain words: the family a form belongs to, its 8-K item codes, and a short
// description built from the form and items (EDGAR's own "description" is usually just the form
// name, "PRIMARY DOCUMENT" or "FORM 4"; it is kept only when it says something more).

/** Families the company Filings tab and the cross-company feed group filings by. */
export type FilingFamily = "periodic" | "current" | "ownership" | "proxy" | "offerings" | "correspondence" | "other";

export const FAMILIES: { id: FilingFamily; label: string; short: string; note: string }[] = [
  { id: "periodic", label: "Periodic reports", short: "Periodic", note: "Annual and quarterly reports (10-K, 10-Q) and their amendments" },
  { id: "current", label: "Earnings and current reports", short: "Current", note: "8-K current reports, including earnings releases (Item 2.02)" },
  { id: "ownership", label: "Ownership", short: "Ownership", note: "Insider reports (Forms 3, 4, 5), proposed sales (Form 144), stakes over 5% (13D, 13G) including the company's own filings about other issuers, 13F holdings" },
  { id: "proxy", label: "Proxy and governance", short: "Proxy", note: "Proxy statements, additional proxy materials, annual reports to shareholders" },
  { id: "offerings", label: "Registration and offerings", short: "Offerings", note: "Registration statements, prospectuses, merger communications, listings" },
  { id: "correspondence", label: "Correspondence", short: "Letters", note: "SEC staff comment letters and company responses" },
  { id: "other", label: "Other filings", short: "Other", note: "Specialized disclosure, employee plan reports and other forms" },
];

const base = (form: string) => form.trim().toUpperCase().replace(/\/A$/, "");

/** The family of a form type ("10-K/A" → periodic, "SCHEDULE 13G" → ownership). */
export function familyOf(form: string): FilingFamily {
  const f = base(form);
  if (/^10-(K|Q|KT|QT)$/.test(f) || f === "20-F" || f === "40-F" || /^NT (10-K|10-Q|20-F|11-K)$/.test(f)) return "periodic";
  if (/^8-K(12B|12G3|15D5)?$/.test(f) || f === "6-K") return "current";
  if (/^[345]$/.test(f) || f === "144" || /^(SC|SCHEDULE) 13[DG]$/.test(f) || /^13F-(HR|NT)$/.test(f)) return "ownership";
  if (/^(DEF|DEFA|DEFM|DEFR|DEFC|DEFN|DEFS|PRE|PREM|PREC|PRER|DFAN|PRRN)14[AC]$/.test(f.replace(/\s+/g, "")) || /^PX14A6[GN]$/.test(f) || f === "ARS") return "proxy";
  if (f === "CORRESP" || f === "UPLOAD") return "correspondence";
  if (/^(S-1|S-1MEF|S-3|S-3ASR|S-3MEF|S-3D|S-4|S-8|S-8 POS|S-11|S-11MEF|DRS|F-1|F-3|F-3ASR|F-4|POSASR|POS AM|EFFECT|RW|8-A12B|8-A12G|25|25-NSE|CERT|D|SC TO-T|SC TO-I|SC TO-C|SC 14D9|15-12B|15-12G|15-15D|FWP|425)$/.test(f) || /^424B\d$/.test(f)) return "offerings";
  return "other";
}

/** Plain names of 8-K items (Form 8-K General Instructions B and the item list). */
export const ITEM_LABEL: Record<string, string> = {
  "1.01": "Material agreement",
  "1.02": "Agreement ended",
  "1.03": "Bankruptcy or receivership",
  "1.04": "Mine safety",
  "1.05": "Cybersecurity incident",
  "2.01": "Acquisition or disposal completed",
  "2.02": "Results of operations",
  "2.03": "New debt or obligation",
  "2.04": "Debt acceleration",
  "2.05": "Exit or restructuring costs",
  "2.06": "Material impairment",
  "3.01": "Listing notice or transfer",
  "3.02": "Unregistered share sale",
  "3.03": "Change to shareholder rights",
  "4.01": "Auditor change",
  "4.02": "Non-reliance on previously issued financial statements",
  "5.01": "Change in control",
  "5.02": "Director or officer change",
  "5.03": "Bylaws or charter amended",
  "5.04": "Benefit plan trading halt",
  "5.05": "Ethics code change",
  "5.06": "Shell company status change",
  "5.07": "Shareholder vote results",
  "5.08": "Director nominations",
  "6.01": "ABS information",
  "6.02": "Servicer or trustee change",
  "6.03": "Credit enhancement change",
  "6.04": "Missed distribution",
  "6.05": "Securities Act updating",
  "7.01": "Regulation FD disclosure",
  "8.01": "Other events",
  "9.01": "Financial statements and exhibits",
};

/** Item codes of a filing ("2.02,9.01" → ["2.02", "9.01"]), in filing order, unknown text dropped. */
export const itemCodes = (items: string | null | undefined): string[] =>
  (items ?? "").split(/[,\s]+/).map((s) => s.trim()).filter((s) => /^\d\.\d{2}$/.test(s));

/**
 * The items of an 8-K in plain words, most telling first. Item 9.01 (exhibits) only says that
 * documents are attached, so it is named only when it is the sole item.
 */
export function itemsInWords(items: string | null | undefined): string[] {
  const codes = itemCodes(items);
  const shown = codes.length > 1 ? codes.filter((c) => c !== "9.01") : codes;
  return shown.map((c) => ITEM_LABEL[c] ?? `Item ${c}`);
}

const FORM_NAME: Record<string, string> = {
  "10-K": "Annual report",
  "10-KT": "Transition annual report",
  "10-Q": "Quarterly report",
  "20-F": "Annual report (foreign issuer)",
  "40-F": "Annual report (Canadian issuer)",
  "NT 10-K": "Late annual report notice",
  "NT 10-Q": "Late quarterly report notice",
  "NT 20-F": "Late foreign annual report notice",
  "NT 11-K": "Late employee plan report notice",
  "10-QT": "Transition quarterly report",
  "8-K": "Current report",
  "8-K12B": "Current report (successor registration)",
  "8-K12G3": "Current report (successor registration)",
  "6-K": "Foreign issuer report",
  "3": "Initial insider ownership",
  "4": "Insider transaction",
  "5": "Annual insider report",
  "144": "Notice of proposed sale (Rule 144)",
  "SC 13D": "Active stake over 5%",
  "SCHEDULE 13D": "Active stake over 5%",
  "SC 13G": "Passive stake over 5%",
  "SCHEDULE 13G": "Passive stake over 5%",
  "13F-HR": "Institutional holdings report",
  "13F-NT": "Institutional holdings notice",
  "DEF 14A": "Proxy statement",
  DEFA14A: "Additional proxy materials",
  DEFM14A: "Merger proxy statement",
  DEFR14A: "Revised proxy statement",
  DFAN14A: "Proxy materials from others",
  "PRE 14A": "Preliminary proxy statement",
  PREM14A: "Preliminary merger proxy",
  PRER14A: "Revised preliminary proxy statement",
  PREC14A: "Preliminary contested proxy statement",
  DEFC14A: "Contested proxy statement",
  DEFN14A: "Proxy statement from a shareholder group",
  PRRN14A: "Revised preliminary proxy from a shareholder group",
  "PRE 14C": "Preliminary information statement",
  "DEF 14C": "Information statement",
  DEFA14C: "Additional information statement materials",
  PX14A6G: "Exempt shareholder solicitation",
  PX14A6N: "Exempt solicitation notice",
  "N-PX": "Proxy voting record",
  ARS: "Annual report to shareholders",
  CORRESP: "Company response to SEC",
  UPLOAD: "SEC staff letter",
  "S-1": "Registration statement",
  "S-3": "Shelf registration",
  "S-3ASR": "Automatic shelf registration",
  "S-4": "Merger registration",
  "S-8": "Employee plan registration",
  "S-8 POS": "Employee plan registration update",
  POSASR: "Shelf registration update",
  "S-11": "Real estate registration",
  "S-11MEF": "Real estate registration (added securities)",
  "S-1MEF": "Registration (added securities)",
  "S-3MEF": "Shelf registration (added securities)",
  DRS: "Draft registration statement",
  RW: "Registration withdrawal request",
  // Form 15 ends the registration of one class of securities (often a note issue), not of the company.
  "15-12B": "Deregistration of a class of securities",
  "15-12G": "Deregistration of a class of securities",
  "15-15D": "Reporting suspension notice",
  "305B2": "Trustee eligibility statement",
  "ABS-15G": "Asset-backed securities report",
  "CT ORDER": "Confidential treatment order",
  "SC TO-C": "Tender offer communication",
  "POS AM": "Registration amendment",
  EFFECT: "Registration effective",
  FWP: "Free writing prospectus",
  "425": "Merger communication",
  "8-A12B": "Exchange listing registration",
  "8-A12G": "Securities registration",
  // SEC Form 25: "Notification of the removal from listing and registration of matured, redeemed or retired
  // securities". It names one class of securities (often a note issue that matured), not the company.
  "25": "Removal of a class of securities from listing",
  "25-NSE": "Exchange removal of a listed security",
  CERT: "Exchange listing certification",
  D: "Exempt offering notice",
  "SC TO-T": "Third-party tender offer",
  "SC TO-I": "Issuer tender offer",
  "SC 14D9": "Tender offer response",
  // SD carries conflict minerals (EX-1.01) or resource extraction payments (EX-2.01); the exhibit is not on the row.
  SD: "Specialized disclosure (Form SD)",
  "11-K": "Employee plan annual report",
  IRANNOTICE: "Iran activity notice",
};

/** EDGAR spells some forms with and without a space ("PRE 14A", "PRE14A"): look both up. */
const NAME_NOSPACE = new Map(Object.entries(FORM_NAME).map(([k, v]) => [k.replace(/\s+/g, ""), v]));

/** Plain name of a form ("10-K/A" → "Annual report (amended)"). */
export function formName(form: string): string {
  const f = form.trim().toUpperCase();
  const amended = /\/A$/.test(f);
  const b = base(f);
  const name = FORM_NAME[b] ?? NAME_NOSPACE.get(b.replace(/\s+/g, "")) ?? (/^424B\d$/.test(b) ? "Prospectus" : b);
  return amended ? `${name} (amended)` : name;
}

/** Shorter form label for chips: "SCHEDULE 13G/A" → "13G/A". */
export const formChip = (form: string) => form.trim().replace(/^(SCHEDULE|SC) (?=13[DG])/i, "");

const GENERIC_DESC = /^(form\s*)?(primary document|ownership document|current report|statement of changes in beneficial ownership( of securities)?|annual report|quarterly report|proxy statement|document|main document|cover|8-?k|10-?k|10-?q|4|3|5|144|def ?14a|defa14a|s-8|s-3|425|sd|ars|11-k)( report)?\.?$/i;

/**
 * EDGAR's document description when it adds something to the form name: "8-K 11.20.26 SEYMOUR
 * RETIREMENT" → "Seymour retirement"; "PRIMARY DOCUMENT", "FORM 4" or the form's own name → null.
 */
export function informativeDesc(desc: string | null | undefined, form: string, company?: string | null): string | null {
  let d = (desc ?? "").replace(/\s+/g, " ").trim();
  if (!d) return null;
  const f = form.trim().toUpperCase().replace(/[-/ ]/g, "[-/ ]?");
  // the form's own name, at either end, with or without "Form", "Form-" or "Form:" before it
  d = d.replace(new RegExp(`(^|\\s|,)(form[\\s:-]*)?${f}(?=$|[\\s,.;:)-])`, "gi"), " ");
  // dates carry nothing the row does not show: 11.20.26, 2026.11.19, 11/20/2026, "dated November 6, 2026"
  d = d.replace(/\b(dated\s+)?\d{1,4}[./-]\d{1,2}[./-]\d{2,4}\b/gi, "");
  d = d.replace(/\b(dated\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? \d{1,2},? \d{4}\b/gi, "");
  d = d.trim().replace(/^\(([^()]*)\)$/, "$1");
  const trim = (x: string) => x.replace(/^[\s\-–:·,;(]+|[\s\-–:·,;(]+$/g, "").replace(/\s{2,}/g, " ").replace(/\s+(on|of|for|dated|as of|re|the|and)$/i, "").trim();
  d = trim(d);
  d = d.replace(/^[A-Z]{1,5}\s+-\s+/, "").replace(/^-\s*/, "");
  d = trim(d);
  // a lone ticker ("TMUS FORM 10-Q") says nothing on the company's own row
  if (/^[A-Z.]{1,5}$/.test(d)) return null;
  if (!d || d.length < 4 || /^form$/i.test(d) || GENERIC_DESC.test(d) || GENERIC_DESC.test(`${form} ${d}`)) return null;
  // the company's own name says nothing on the company's own row
  const norm = (x: string) => x.toLowerCase().replace(/[.,]/g, "").replace(/\b(inc|corp|corporation|co|company|ltd|plc|llc|the|holdings?)\b/g, "").replace(/\s+/g, " ").trim();
  if (company && norm(company)) {
    if (norm(d) === norm(company)) return null;
    // a leading company name ("VSE CORPORATION Q4 2026 DIVIDEND") is dropped, the rest kept
    const own = new Set(norm(company).split(" "));
    const words = d.split(" ");
    const key = (w: string) => w.toLowerCase().replace(/[.,]/g, "");
    if (own.has(key(words[0])) || (key(words[0]) === "the" && words[1] && own.has(key(words[1])))) {
      let i = 0;
      while (i < words.length && (own.has(key(words[i])) || /^(the|inc|corp|corporation|co|company|ltd|plc|llc|holdings?)$/.test(key(words[i])))) i++;
      d = trim(words.slice(i).join(" "));
      if (!d || d.length < 4) return null;
    }
  }
  // "Definitive proxy statement" for a DEF 14A says nothing the form name does not.
  const nameWords = formName(form).toLowerCase().replace(/[()]/g, "").split(/\s+/).filter((w) => w.length > 2);
  if (nameWords.length && nameWords.every((w) => d.toLowerCase().includes(w))) return null;
  if (d === d.toUpperCase() && /[A-Z]/.test(d)) d = recase(d);
  return d;
}

/** Ordinary short words that are not tickers or acronyms, so they are not kept in capitals. */
const WORDS = new Set(["inc", "corp", "co", "ltd", "llc", "plc", "no", "call", "size", "plan", "news", "date", "year", "cert", "bank", "fund", "note", "deal", "sale", "loan", "debt", "cash", "rate", "vote", "from", "into", "upon", "this", "that", "over", "new", "end", "ended", "sep", "sept", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "oct", "nov", "dec", "div", "re", "item", "part", "page", "copy", "file", "data", "set", "one", "two", "all", "and", "the", "for", "per", "tax", "pay", "fee", "fees", "cap", "ex", "dividend", "q", "fy"].concat([]));
const SMALL = new Set(["a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to", "vs", "with"]);

/**
 * EDGAR descriptions are often all capitals. Lower-casing them all mangles names and tickers
 * ("Tmus", "James morton"), so: short all-capital tokens (tickers, Q3, FY27, AT&T, BOD) stay as
 * written, other words get a capital initial, small joining words go lower case.
 */
function recase(d: string): string {
  return d
    .split(" ")
    .map((w, i) => {
      const core = w.replace(/[^A-Za-z0-9&]/g, "");
      if (/^\d+(ST|ND|RD|TH)$/.test(core)) return w.toLowerCase();
      // codes with digits (Q3, FY2026, 3Q, 240.14A-12) and short tokens (tickers, AT&T, BOD) as written
      if (/[A-Z]/.test(core) && (/\d/.test(core) || core.includes("&") || (core.length <= 4 && !WORDS.has(core.toLowerCase()) && !SMALL.has(core.toLowerCase())))) return w;
      const lower = w.toLowerCase();
      if (i > 0 && SMALL.has(lower)) return lower;
      return lower.replace(/[a-z]/, (c) => c.toUpperCase());
    })
    .join(" ");
}

export interface FilingLike {
  form: string;
  /** The filer's short name, so a description that only repeats it is dropped. */
  company?: string | null;
  items?: string | null;
  desc?: string | null;
  /** The accession was filed by the company itself (see `filedByIssuer`). */
  selfFiled?: boolean;
}

/** Schedule 13D or 13G and their amendments. */
export const isStakeForm = (form: string) => /^(SC|SCHEDULE) 13[DG]$/.test(base(form));
/** Schedule 13D (an active stake) and its amendments. */
export const isActiveStake = (form: string) => /^(SC|SCHEDULE) 13D$/.test(base(form));

/**
 * True when the company itself filed the accession: its prefix is the filer agent's CIK, and for a
 * company's own filings that is the company's CIK. A Schedule 13D/G the company filed is about its
 * stake in another issuer, never a stake in the company.
 */
export function filedByIssuer(accn: string, cik: string | number | null | undefined): boolean {
  if (cik == null || cik === "") return false;
  const prefix = Number(accn.slice(0, 10));
  return Number.isFinite(prefix) && prefix > 0 && prefix === Number(cik);
}

/** Title of a Schedule 13D/G the company filed about another issuer. */
export const OWN_STAKE_TITLE = "Company's own holdings filing (stake in another issuer)";

/** 8-K items that matter more than anything else in the filing: they lead the title even over an earnings release. */
const LEADING_ITEMS = ["4.02", "1.03", "4.01", "3.01", "1.05"];

/**
 * What a reader needs to know about a filing in one line: a title (the 8-K's leading items, or the
 * form's plain name) and a quieter detail (the other items, or EDGAR's description when it adds
 * something).
 */
export function describeFiling(f: FilingLike): { title: string; detail: string | null; alert: boolean } {
  const codes = familyOf(f.form) === "current" ? itemCodes(f.items) : [];
  const extra = informativeDesc(f.desc, f.form, f.company);
  if (f.selfFiled && isStakeForm(f.form)) return { title: `${OWN_STAKE_TITLE}${/\/A$/i.test(f.form) ? " (amended)" : ""}`, detail: extra, alert: false };
  if (codes.length) {
    const shown = codes.length > 1 ? codes.filter((c) => c !== "9.01") : codes;
    const lead = LEADING_ITEMS.find((c) => shown.includes(c));
    // "Earnings release" only when results of operations (2.02) is the filing's subject.
    const head = lead ?? (shown.includes("2.02") ? "2.02" : shown[0]);
    const name = (c: string) => (c === "2.02" ? (c === head ? "Earnings release" : "Earnings release (Item 2.02)") : (ITEM_LABEL[c] ?? `Item ${c}`));
    const amended = /\/A$/i.test(f.form) ? " (amended)" : "";
    const rest = shown.filter((c) => c !== head).map(name);
    return { title: `${name(head)}${amended}`, detail: [...rest, extra].filter(Boolean).join(" · ") || null, alert: !!lead && ["4.02", "1.03"].includes(lead) };
  }
  return { title: formName(f.form), detail: extra, alert: false };
}
