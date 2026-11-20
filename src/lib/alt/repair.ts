// The alt-data repair in two parts, so nothing a refresh cannot restore is deleted. Pure; the
// script `scripts/alt-contracts-repair.ts` reads the rows and applies the plan.
//
//   Part "copies"     rows wrong under every company, safe to delete at once:
//                     - contract award rows (`usa:` events without a tie) that the old collector
//                       copied from the government-wide list onto many companies, except a copy whose
//                       recipient is that company's own name or alias;
//                     - FDA firms, trial sponsors, NHTSA campaigns and CPSC recalls hand-checked as
//                       another business (KNOWN_OTHER), and FDIC zero placeholders.
//   Part "refreshed"  everything else the screen hides, per company and only after the fixed
//                     contracts collector has demonstrably refreshed it (a refresh record of the
//                     current rule, newer than `since`), and only rows that refresh did not
//                     reproduce: legacy rows (no `as_of`) whose recipient is neither the company by
//                     name or alias nor a recipient the source lists in the company's family.
//
// Firm-matched rows the rule refuses but that are not hand-checked as another business (joint
// ventures, a sold unit, an unclear namesake) are hidden by the screen and never deleted.
import { contractRowBelongs, isCompanyName, refreshOf, type CompanyKeys, type RefreshMeta } from "@/lib/alt/contracts";
import { isBankPlaceholder } from "@/lib/alt/bank";
import { rowFirm } from "@/lib/alt/firms";

/** An award id stored under at least this many companies is a copy of the government-wide list (the copies sit under 49 to 505). */
export const COPY_MIN_TICKERS = 25;

/**
 * Firms and campaigns hand-checked (2026-11-20) as another business that only shares the company's
 * name. Firm names as stored (fda: recalling firm, trials: lead sponsor); uids for NHTSA and CPSC rows
 * written before the maker was stored (manufacturer looked up at data.transportation.gov by campaign).
 */
export const KNOWN_OTHER: { fda: Record<string, string[]>; trials: Record<string, string[]>; uids: Record<string, string> } = {
  fda: {
    // independent bottlers and distributors (Coca-Cola Consolidated is COKE, not KO)
    KO: ["Chattanooga Coca Cola Bottling Company dba United Packers, Inc.", "COCA COLA BOTTLING COMPAN", "Coca Cola Bottling Company United-East, LLC", "Coca Cola Bottling Company United, LLC", "Coca Cola Bottling Group United", "COCA COLA Consolidated LLC", "COCA COLA SOUTHWEST BEVERAGES LLC", "Coca-Cola Consolidated", "Great Lakes Coca-Cola Distribution LLC", "Heartland Coca-Cola Bottling Company", "Reyes Coca-Cola Bottling, L.L.C.", "Swire Coca Cola USA"],
    WAT: ["DANONE WATERS OF AMERICA INC", "Danone Waters of America, Inc", "Natural Waters of Viti Limited", "Nestle Waters North America", "Rushing Waters Fisheries, LLC", "Waters Medical Systems LLC", "World Waters, LLC dba WTRMLN WTR"],
    MRK: ["Merck Millipore Ltd."], // Merck KGaA's life-science unit
    OGN: ["Organon Teknika Inc"], // Akzo's diagnostics business, not Organon & Co.
    SEB: ["Capital Seaboard"],
    TGT: ["Boston Scientific Target"], // a Boston Scientific unit; stays under BSX
    UVV: ["Universal Meditech Inc."],
  },
  trials: {
    MRK: ["Merck Healthcare KGaA, Darmstadt, Germany, an affiliate of Merck KGaA, Darmstadt, Germany", "Merck KGaA, Darmstadt, Germany"],
    NHC: ["National Healthcare Center", "National Healthcare Group Polyclinics", "National Healthcare Group, Singapore"],
  },
  uids: {
    "nhtsa:APTV:23V491000": "Adaptive Mobility Systems Inc",
    "nhtsa:CMI:17E078000": "Eaton Cummins Automated Transmission Tec (joint venture)",
    "nhtsa:DAN:22T014000": "PT. Elangperdana Tyre Industry",
    "nhtsa:DAN:25T011000": "PT. Elangperdana Tyre Industry",
    "nhtsa:DAN:26T007000": "PT. Elangperdana Tyre Industry",
    "nhtsa:F:12V443000": "C & C Ford",
    "nhtsa:F:26E037000": "Rockford Corporation",
    ...Object.fromEntries(["01C025000", "02C014000", "03C003000", "07C006000", "07C011000", "08C001000", "08C005000", "08C009000", "14C001000", "14C004000", "15C001000", "15C004000", "16C002000", "16C004000", "17C001000", "26C003000", "86C006000"].map((n) => [`nhtsa:GGG:${n}`, "Graco Children's Products, Inc. (Newell Brands)"])),
    "nhtsa:ITT:04V351000": "THE LITTLE TRAILER COMPANY",
    "nhtsa:ITT:05V434000": "Doolittle Trailer Mfg. Co., Inc.",
    "nhtsa:ITT:10T012000": "Nitto Tire U.S.A. Inc.",
    "nhtsa:ITT:10V473000": "AUTO OUTFITTERS",
    "nhtsa:ITT:11V014000": "Pitts Enterprises, Inc.",
    "nhtsa:ITT:11V501000": "CUSTOM VEHICLE OUTFITTERS",
    "nhtsa:ITT:13E009000": "Zhejiang Jixiang Motorcycle Fittings Co.",
    "nhtsa:ITT:14V307000": "Tactical Vehicle Outfitters",
    "nhtsa:ITT:16V239000": "Pitts Enterprises, Inc.",
    "nhtsa:ITT:19C003000": "Merritt Manufacturing, Inc.",
    "nhtsa:ITT:23E062000": "Outfitter Manufacturing",
    "nhtsa:ITT:75V015000": "Merritt Trailers, Inc.",
    "nhtsa:ITT:85E009000": "LITTELFUSE INC.",
    "nhtsa:LEA:06C006000": "Tomy International (Learning Curve Brand)",
    "nhtsa:LEA:77E024000": "LEAR SIEGLER, INC.",
    "cpsc:AAPL:02239": "title word only (CPSC record lists another maker)",
    "cpsc:AAPL:13268": "title word only (CPSC record lists another maker)",
    "cpsc:AAPL:23260": "title word only (CPSC record lists another maker)",
    "cpsc:CAT:00147": "Caterpillar-branded toys by another maker",
    "cpsc:CAT:03013": "Caterpillar-branded toys by another maker",
    "cpsc:CAT:07291": "Cat footwear (Wolverine World Wide)",
    "cpsc:CAT:90058": "Caterpillar-branded toys by another maker",
    "cpsc:CAT:96082": "Caterpillar-branded toys by another maker",
  },
};

/**
 * Recipients the screen hides because no allowed source ties them to the company yet, but that are
 * probably the company's: never deleted until someone checks them (and adds an alias with a source,
 * or removes the entry). Google Public Sector LLC is not in Alphabet's Exhibit 21 list of
 * significant subsidiaries.
 */
export const HELD: Record<string, string[]> = {
  GOOGL: ["GOOGLE PUBLIC SECTOR LLC"],
};

/** The fields of a stored row the plan reads. */
export interface RepairRow {
  uid: string;
  ticker: string;
  dataset: string;
  kind: string;
  title?: string | null;
  value?: number | null;
  meta?: Record<string, unknown> | null;
}

/** Award key of a `usa:` award row (`usa:TICKER:<generated id>`), or null for other rows. */
export const awardKey = (r: RepairRow) => (r.dataset === "contracts" && r.kind === "event" && r.uid.startsWith("usa:") ? r.uid.split(":").slice(2).join(":") : null);

const legacy = (r: RepairRow) => !r.meta || !("as_of" in r.meta);
const untied = (r: RepairRow) => !r.meta || !("tie" in r.meta);

/** How many companies each untied award is stored under. */
export function copyCounts(rows: RepairRow[]): Map<string, number> {
  const by = new Map<string, Set<string>>();
  for (const r of rows) {
    const k = awardKey(r);
    if (!k || !untied(r)) continue;
    (by.get(k) ?? by.set(k, new Set()).get(k)!).add(r.ticker);
  }
  return new Map([...by].map(([k, s]) => [k, s.size]));
}

/** Part "copies": whether a row is wrong under every company and may go now. */
export function isCopyPart(r: RepairRow, keys: CompanyKeys | null, copies: Map<string, number>): boolean {
  if (r.dataset === "contracts") {
    const k = awardKey(r);
    if (!k || !untied(r) || (copies.get(k) ?? 0) < COPY_MIN_TICKERS) return false;
    return !(keys && contractRowBelongs(r, keys));
  }
  if (r.dataset === "bank") return isBankPlaceholder(r);
  if (r.dataset === "fda" || r.dataset === "trials") {
    const firm = rowFirm(r);
    return !!firm && (KNOWN_OTHER[r.dataset][r.ticker] ?? []).includes(firm);
  }
  if (r.dataset === "recalls" || r.dataset === "consumer") return r.uid in KNOWN_OTHER.uids;
  return false;
}

/** The newest refresh record per ticker of the current rule written at or after `since` (ISO). */
export function refreshedTickers(records: RepairRow[], since: string): Map<string, RefreshMeta> {
  const out = new Map<string, RefreshMeta>();
  for (const r of records) {
    const m = refreshOf(r);
    if (!m || m.as_of < since) continue;
    const prev = out.get(r.ticker);
    if (!prev || prev.as_of < m.as_of) out.set(r.ticker, m);
  }
  return out;
}

/**
 * Part "refreshed": whether a contracts row may go once its company was refreshed by the fixed
 * collector (`refresh`), because that refresh did not reproduce it and nothing ties it to the company.
 */
export function isRefreshedPart(r: RepairRow, keys: CompanyKeys | null, refresh: RefreshMeta | undefined, copies: Map<string, number>): boolean {
  if (r.dataset !== "contracts" || !refresh || !legacy(r) || isCopyPart(r, keys, copies)) return false;
  if (keys && contractRowBelongs(r, keys)) return false;
  const family = new Set([...refresh.family, ...(HELD[r.ticker] ?? [])]);
  const ours = (name: unknown) => typeof name === "string" && (family.has(name) || (!!keys && isCompanyName(name, keys)));
  const m = r.meta ?? {};
  if (r.kind === "series") {
    const rs = Array.isArray(m.recipients) ? (m.recipients as unknown[]) : [];
    return !(rs.length > 0 && rs.every(ours));
  }
  return !ours(m.recipient);
}

export interface RepairPlan {
  copies: RepairRow[];
  refreshed: RepairRow[];
  /** Tickers with legacy contract rows the screen hides that have no qualifying refresh yet. */
  waiting: Map<string, number>;
}

/** Both parts over a set of stored rows (`contracts` rows must be complete for copy counts). */
export function planRepair(rows: RepairRow[], refreshRecords: RepairRow[], keysOf: (ticker: string) => CompanyKeys | null, since: string): RepairPlan {
  const copies = copyCounts(rows);
  const refreshed = refreshedTickers(refreshRecords, since);
  const plan: RepairPlan = { copies: [], refreshed: [], waiting: new Map() };
  for (const r of rows) {
    const k = keysOf(r.ticker);
    if (isCopyPart(r, k, copies)) plan.copies.push(r);
    else if (isRefreshedPart(r, k, refreshed.get(r.ticker), copies)) plan.refreshed.push(r);
    else if (r.dataset === "contracts" && legacy(r) && !refreshed.has(r.ticker) && !(k && contractRowBelongs(r, k))) plan.waiting.set(r.ticker, (plan.waiting.get(r.ticker) ?? 0) + 1);
  }
  return plan;
}
