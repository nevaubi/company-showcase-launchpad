// Pure: what kind of statement a section is, by its printed title and the company's sector, for the tab's jump
// list, its filter chips and the note on expected statements a company's documents do not print. A title is
// never renamed here, only classified.
import type { IrPayload, PayloadSeries } from "@/lib/ir/payload";
import type { Statement } from "@/lib/ir/statements";

export type Sector = "bank" | "insurer" | "reit" | "energy" | "health" | "technology" | "consumer" | "industrial" | "other";

export type SectionKind =
  | "income"
  | "balance"
  | "average"
  | "margin"
  | "segment"
  | "credit"
  | "capital"
  | "per-share"
  | "underwriting"
  | "production"
  | "product"
  | "geography"
  | "revenue"
  | "cost"
  | "cash-flow"
  | "reconciliation"
  | "highlights"
  | "other";

/** The tab's filter values (`DIMENSIONS` in display.ts) a kind of section belongs to. */
export const FILTER_OF: Record<SectionKind, "revenue" | "profit" | "cost" | "kpi" | "balance"> = {
  income: "profit",
  balance: "balance",
  average: "balance",
  margin: "kpi",
  segment: "profit",
  credit: "balance",
  capital: "balance",
  "per-share": "kpi",
  underwriting: "profit",
  production: "kpi",
  product: "revenue",
  geography: "revenue",
  revenue: "revenue",
  cost: "cost",
  "cash-flow": "balance",
  reconciliation: "profit",
  highlights: "kpi",
  other: "kpi",
};

/** Words for a kind, for the jump list's groups and the note on expected statements. */
export const KIND_LABEL: Record<SectionKind, string> = {
  income: "Income statement",
  balance: "Balance sheet",
  average: "Average balances and yields",
  margin: "Net interest margin",
  segment: "Segment results",
  credit: "Credit quality",
  capital: "Capital",
  "per-share": "Per-share data and ratios",
  underwriting: "Underwriting results",
  production: "Production and realized prices",
  product: "Revenue by product",
  geography: "Revenue by geography",
  revenue: "Revenue",
  cost: "Costs",
  "cash-flow": "Cash flows",
  reconciliation: "Non-GAAP reconciliations",
  highlights: "Highlights",
  other: "Other tables",
};

/** The company's sector, from the sector and industry fields the app already has (SEC or coverage text). */
export function sectorOf(sector?: string | null, industry?: string | null): Sector {
  const t = `${sector ?? ""} ${industry ?? ""}`.toLowerCase();
  if (/\b(insurance|insurers?|reinsurance|life & health|property & casualty)\b/.test(t)) return "insurer";
  if (/\breit\b|real estate investment trust/.test(t)) return "reit";
  if (/\b(banks?|banking|savings institution|thrift|bancorp|national commercial|state commercial|credit card)\b/.test(t))
    return "bank";
  if (/\b(oil|gas|petroleum|crude|energy|coal|drilling|refining)\b/.test(t)) return "energy";
  if (/\b(pharma\w*|biotech\w*|biological|health|medical|drug|hospital|diagnostic|surgical|life sciences)\b/.test(t))
    return "health";
  if (/\b(software|semiconductors?|technology|computers?|internet|electronics?|data processing|prepackaged|telecom\w*)\b/.test(t))
    return "technology";
  if (/\b(retail|consumer|beverages?|foods?|restaurants?|apparel|household|tobacco|cosmetics?|stores?|eating)\b/.test(t))
    return "consumer";
  if (/\b(industrial|aerospace|aircraft|machinery|defense|transport\w*|railroads?|engines|construction|electrical equipment)\b/.test(t))
    return "industrial";
  return "other";
}

const RULES: [SectionKind, RegExp, Sector[] | null][] = [
  ["reconciliation", /\b(non-?gaap|reconciliations?|as adjusted)\b/, null],
  ["average", /\baverage balances?\b|\byields? and rates\b|\bannualized yields?\b|\baverage balance sheets?\b/, null],
  ["margin", /\bnet interest (margin|income)\b/, ["bank"]],
  ["cash-flow", /\bcash flows?\b/, null],
  ["income", /\bstatements? of (consolidated )?(income|operations|earnings|comprehensive income)\b|\bincome statements?\b|\bresults of operations\b/, null],
  ["capital", /\bcapital\b|\btier 1\b|\bcet1\b|\bleverage ratios?\b|\btlac\b|\bregulatory\b/, ["bank", "insurer"]],
  ["balance", /\bbalance sheets?\b|\bstatements? of financial (condition|position)\b|\bselected balance sheet\b/, null],
  ["credit", /\bcredit[- ]related\b|\bcredit quality\b|\basset quality\b|\ballowance\b|\bcharge-?offs?\b|\bnonperforming\b|\bnonaccrual\b|\bdelinquen/, null],
  ["per-share", /\bper (common )?share\b|\bearnings per\b|\bratios\b/, null],
  ["underwriting", /\bunderwriting\b|\bpremiums\b|\bcombined ratio\b|\bloss ratio\b|\bclaims\b/, ["insurer"]],
  ["production", /\bproduction\b|\bvolumes?\b|\brealized prices?\b|\brealizations\b|\bupstream\b|\bdownstream\b|\bthroughput\b/, ["energy"]],
  ["segment", /\bsegments?\b|\bbusiness units?\b|\blines? of business\b|\breportable\b|\bdivision(s|al)?\b/, null],
  ["segment", /\b(banking|bank|wealth|asset management|corporate|markets|investment bank|card services|commercial)\b/, ["bank"]],
  ["geography", /\bgeograph\w*|\bregions?\b|\bregional\b|\bby country\b|\binternational\b|\bamericas\b/, null],
  ["product", /\bproducts?\b|\bcategor(y|ies)\b|\bservice lines?\b|\bend markets?\b|\bplatforms?\b|\bofferings?\b|\bfranchise\b|\bbrands?\b/, null],
  ["cost", /\bexpenses?\b|\bcosts?\b/, null],
  ["revenue", /\brevenues?\b|\bnet sales\b|\bsales\b/, null],
  ["highlights", /\bhighlights\b|\bkey (metrics|statistics|figures)\b|\boperating (metrics|data|statistics)\b|\bsummary\b|\bselected (financial )?data\b|\bfinancial results\b|\bkpis?\b|\bmetrics\b/, null],
];

/** The kind of a section, by its title (and, for a fragment titled by its line category, by its lines). */
export function sectionKind(sec: Pick<Statement, "title" | "cat"> & { titleFrom?: string }, sector: Sector): SectionKind {
  if (sec.titleFrom === "merged") return "other";
  const t = sec.title.toLowerCase().replace(/,\s*continued$/, "");
  for (const [kind, re, only] of RULES) if ((!only || only.includes(sector)) && re.test(t)) return kind;
  if (sec.cat === "segment") return "segment";
  if (sec.cat === "geography") return "geography";
  if (sec.cat === "product") return "product";
  if (sec.cat === "cost") return "cost";
  if (sec.cat === "balance") return "balance";
  return "other";
}

/** Statements a company of the sector is expected to print (COMMON8: a bank's six, a company with segments). */
export const EXPECTED: Record<Sector, SectionKind[]> = {
  bank: ["income", "balance", "average", "segment", "credit", "capital"],
  insurer: ["income", "balance", "segment", "underwriting"],
  reit: ["income", "balance"],
  energy: ["income", "segment", "production"],
  health: ["income", "segment", "product"],
  technology: ["income", "segment", "product"],
  consumer: ["income", "segment", "geography"],
  industrial: ["income", "segment"],
  other: ["income"],
};

/** Expected statements none of the sections prints, by kind (for a note under the jump list). */
export function missingStatements(
  sections: (Pick<Statement, "title" | "cat" | "group"> & { rows?: Statement["rows"] })[],
  sector: Sector,
): SectionKind[] {
  const have = new Set<SectionKind>();
  for (const s of sections) {
    if (s.group === "more") continue;
    have.add(sectionKind(s, sector));
    // A table can print several statements under its own headings (Apple's release prints net sales by
    // segment and by category inside its statement of operations).
    for (const r of s.rows ?? [])
      if (r.kind === "head") {
        const k = sectionKind({ title: r.text, cat: "" }, sector);
        if (k !== "other") have.add(k);
      }
  }
  // A product or geography split printed by a company's segment tables counts as either revenue split.
  return EXPECTED[sector].filter(
    (k) => !have.has(k) && !((k === "product" || k === "geography") && (have.has("product") || have.has("geography"))),
  );
}

/** Order of kinds in the jump list for a sector: the statements first, then the sector's own tables. */
const JUMP: Record<Sector, SectionKind[]> = {
  bank: ["highlights", "income", "balance", "average", "margin", "segment", "credit", "capital", "per-share", "reconciliation"],
  insurer: ["highlights", "income", "balance", "segment", "underwriting", "capital", "per-share", "reconciliation"],
  reit: ["highlights", "income", "balance", "segment", "per-share", "reconciliation"],
  energy: ["highlights", "income", "balance", "cash-flow", "segment", "production", "reconciliation"],
  health: ["highlights", "income", "balance", "cash-flow", "segment", "product", "geography", "reconciliation"],
  technology: ["highlights", "income", "balance", "cash-flow", "segment", "product", "geography", "reconciliation"],
  consumer: ["highlights", "income", "balance", "cash-flow", "segment", "geography", "product", "reconciliation"],
  industrial: ["highlights", "income", "balance", "cash-flow", "segment", "product", "geography", "reconciliation"],
  other: ["highlights", "income", "balance", "cash-flow", "segment", "product", "geography", "reconciliation"],
};

/**
 * The jump list: sections grouped by kind in the sector's order (kinds it does not list after them, in page
 * order), each group in page order. The page itself keeps the company's own order (`arrange`).
 */
export function jumpGroups<S extends Pick<Statement, "title" | "cat" | "group">>(
  sections: S[],
  sector: Sector,
): { kind: SectionKind; label: string; sections: S[] }[] {
  const order = JUMP[sector];
  const by = new Map<SectionKind, S[]>();
  for (const s of sections) {
    const k = sectionKind(s, sector);
    by.set(k, [...(by.get(k) ?? []), s]);
  }
  const kinds = [...by.keys()].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return kinds.map((kind) => ({ kind, label: KIND_LABEL[kind], sections: by.get(kind)! }));
}

/** Measures a bank headlines in its supplement; each with the line names that print it. */
const BANK_HEADLINES: [string, RegExp][] = [
  // Apostrophes as printed: straight or curly ("shareholders’ equity", Bank of America).
  ["Return on equity", /\breturn on (average )?(common )?((stockholders|shareholders)['’]?)? ?equity\b|\broe\b/i],
  ["Return on tangible common equity", /\breturn on (average )?tangible common ((stockholders|shareholders)['’]? )?equity\b|\brotce\b/i],
  ["CET1 ratio", /\b(cet1|common equity tier 1)\b.*\bratio\b|\bcet1\b/i],
  // Bank of America prints its margin as "Net interest yield", JPMorgan as "Net yield on (average) interest-earning assets".
  ["Net interest margin", /\bnet interest (margin|yield)\b|\bnet yield on (average )?interest-earning assets\b|\bnim\b/i],
  ["Efficiency or overhead ratio", /\b(efficiency|overhead) ratio\b/i],
  ["Book value per share", /(?<!tangible )\bbook value per (common )?share\b/i],
  ["Tangible book value per share", /\btangible book value per (common )?share\b/i],
];

/** The headline measures of the sector that no section line prints (banks only for now). */
export function missingHeadlines(p: IrPayload, sections: Pick<Statement, "keys" | "group">[], sector: Sector): string[] {
  if (sector !== "bank") return [];
  const byKey = new Map(p.series.map((s) => [s.k, s] as [string, PayloadSeries]));
  const names = sections
    .filter((s) => s.group !== "more")
    .flatMap((s) => s.keys.map((k) => byKey.get(k)?.label ?? ""))
    .filter(Boolean);
  return BANK_HEADLINES.filter(([, re]) => !names.some((n) => re.test(n))).map(([n]) => n);
}
