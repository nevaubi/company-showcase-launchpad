// What a filing is, in plain words: the family a form belongs to, its 8-K item codes, and a short
// description built from the form and items (EDGAR's own "description" is usually just the form
// name, "PRIMARY DOCUMENT" or "FORM 4"; it is kept only when it says something more).

/** Families the company Filings tab and the cross-company feed group filings by. */
export type FilingFamily = "periodic" | "current" | "ownership" | "proxy" | "offerings" | "correspondence" | "other";

export const FAMILIES: { id: FilingFamily; label: string; short: string; note: string }[] = [
  { id: "periodic", label: "Periodic reports", short: "Periodic", note: "Annual and quarterly reports (10-K, 10-Q) and their amendments" },
  { id: "current", label: "Earnings and current reports", short: "Current", note: "8-K current reports, including earnings releases (Item 2.02)" },
  { id: "ownership", label: "Ownership", short: "Ownership", note: "Insider reports (Forms 3, 4, 5), proposed sales (Form 144), holders over 5% (13D, 13G), 13F holdings" },
  { id: "proxy", label: "Proxy and governance", short: "Proxy", note: "Proxy statements, additional proxy materials, annual reports to shareholders" },
  { id: "offerings", label: "Registration and offerings", short: "Offerings", note: "Registration statements, prospectuses, merger communications, listings" },
  { id: "correspondence", label: "Correspondence", short: "Letters", note: "SEC staff comment letters and company responses" },
  { id: "other", label: "Other filings", short: "Other", note: "Specialized disclosure, employee plan reports and other forms" },
];

const base = (form: string) => form.trim().toUpperCase().replace(/\/A$/, "");

/** The family of a form type ("10-K/A" → periodic, "SCHEDULE 13G" → ownership). */
export function familyOf(form: string): FilingFamily {
  const f = base(form);
  if (/^10-(K|Q|KT|QT)$/.test(f) || f === "20-F" || f === "40-F" || f === "NT 10-K" || f === "NT 10-Q") return "periodic";
  if (f === "8-K" || f === "6-K") return "current";
  if (/^[345]$/.test(f) || f === "144" || /^(SC|SCHEDULE) 13[DG]$/.test(f) || /^13F-(HR|NT)$/.test(f)) return "ownership";
  if (/^(DEF|DEFA|DEFM|DEFR|DEFC|PRE|PREM|PREC|DFAN|PRRN|PX)14[AC]$/.test(f.replace(/\s+/g, "")) || f === "ARS") return "proxy";
  if (f === "CORRESP" || f === "UPLOAD") return "correspondence";
  if (/^(S-1|S-3|S-3ASR|S-4|S-8|S-8 POS|F-1|F-3|F-4|POSASR|POS AM|EFFECT|RW|8-A12B|8-A12G|25|25-NSE|CERT|D|SC TO-T|SC TO-I|SC 14D9|15-12B|15-12G|FWP|425)$/.test(f) || /^424B\d$/.test(f)) return "offerings";
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
  "4.02": "Prior financials no longer reliable",
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
  "8-K": "Current report",
  "6-K": "Foreign issuer report",
  "3": "Initial insider ownership",
  "4": "Insider transaction",
  "5": "Annual insider report",
  "144": "Proposed sale of restricted shares",
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
  PRE14A: "Preliminary proxy statement",
  PREM14A: "Preliminary merger proxy",
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
  "POS AM": "Registration amendment",
  EFFECT: "Registration effective",
  FWP: "Free writing prospectus",
  "425": "Merger communication",
  "8-A12B": "Exchange listing registration",
  "8-A12G": "Securities registration",
  "25": "Delisting notice",
  "25-NSE": "Exchange delisting notice",
  CERT: "Exchange listing certification",
  D: "Exempt offering notice",
  "SC TO-T": "Third-party tender offer",
  "SC TO-I": "Issuer tender offer",
  "SC 14D9": "Tender offer response",
  SD: "Specialized disclosure (conflict minerals)",
  "11-K": "Employee plan annual report",
  IRANNOTICE: "Iran activity notice",
};

/** Plain name of a form ("10-K/A" → "Annual report (amended)"). */
export function formName(form: string): string {
  const f = form.trim().toUpperCase();
  const amended = /\/A$/.test(f);
  const b = base(f);
  const name = FORM_NAME[b] ?? (/^424B\d$/.test(b) ? "Prospectus" : b);
  return amended ? `${name} (amended)` : name;
}

/** Shorter form label for chips: "SCHEDULE 13G/A" → "13G/A". */
export const formChip = (form: string) => form.trim().replace(/^(SCHEDULE|SC) (?=13[DG])/i, "");

const GENERIC_DESC = /^(form\s*)?(primary document|ownership document|current report|statement of changes in beneficial ownership( of securities)?|annual report|quarterly report|proxy statement|document|main document|cover|8-?k|10-?k|10-?q|4|3|5|144|def ?14a|defa14a|s-8|s-3|425|sd|ars|11-k)( report)?\.?$/i;

/**
 * EDGAR's document description when it adds something to the form name: "8-K 11.20.26 SEYMOUR
 * RETIREMENT" → "Seymour retirement"; "PRIMARY DOCUMENT", "FORM 4" or the form's own name → null.
 */
export function informativeDesc(desc: string | null | undefined, form: string): string | null {
  let d = (desc ?? "").replace(/\s+/g, " ").trim();
  if (!d) return null;
  const f = form.trim().toUpperCase().replace(/[-/ ]/g, "[-/ ]?");
  d = d.replace(new RegExp(`^(form\\s*)?${f}\\b`, "i"), "").replace(new RegExp(`\\b(form\\s*)?${f}$`, "i"), "").replace(/^[\s\-–:·]+/, "");
  // dates like 11.20.26, 2026.11.19, 11/20/2026 and a leading ticker carry nothing new
  d = d.replace(/\b\d{1,4}[./-]\d{1,2}[./-]\d{2,4}\b/g, "").replace(/^[\s\-–:·]+|[\s\-–:·]+$/g, "").replace(/\s{2,}/g, " ");
  d = d.replace(/^[A-Z]{1,5}\s+-\s+/, "").replace(/^-\s*/, "").trim();
  if (!d || d.length < 4 || GENERIC_DESC.test(d) || GENERIC_DESC.test(`${form} ${d}`)) return null;
  // "Definitive proxy statement" for a DEF 14A says nothing the form name does not.
  const nameWords = formName(form).toLowerCase().replace(/[()]/g, "").split(/\s+/).filter((w) => w.length > 2);
  if (nameWords.length && nameWords.every((w) => d.toLowerCase().includes(w))) return null;
  // EDGAR descriptions are often all capitals: write them in sentence case.
  if (d === d.toUpperCase()) d = d.charAt(0) + d.slice(1).toLowerCase();
  return d;
}

export interface FilingLike {
  form: string;
  items?: string | null;
  desc?: string | null;
}

/**
 * What a reader needs to know about a filing in one line: a title (the 8-K's leading items, or the
 * form's plain name) and a quieter detail (the other items, or EDGAR's description when it adds
 * something).
 */
export function describeFiling(f: FilingLike): { title: string; detail: string | null } {
  const words = familyOf(f.form) === "current" ? itemsInWords(f.items) : [];
  const extra = informativeDesc(f.desc, f.form);
  if (words.length) {
    const title = words.includes("Results of operations") ? "Earnings release" : words[0];
    const rest = words.filter((w) => w !== (title === "Earnings release" ? "Results of operations" : title));
    const amended = /\/A$/i.test(f.form) ? " (amended)" : "";
    return { title: `${title}${amended}`, detail: [...rest, extra].filter(Boolean).join(" · ") || null };
  }
  return { title: formName(f.form), detail: extra };
}
