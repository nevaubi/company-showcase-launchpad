// Who a federal contract award belongs to. USAspending lists awards by recipient (the legal entity
// paid) and groups recipients under a parent; an award is stored and shown for a company only when
// its recipient is that company by whole name, or a child the source itself lists under a parent
// that is that company by whole name. Never a substring or prefix: "ROGERS, WICKER, RYKMAN AND
// SPEDALE LLC" is not Rogers Corporation, and "KIRBY, BETTY" is not Kirby Corporation. Pure.
import { normCompany } from "@/lib/xbrl/counterparty";

/** Hand-checked registry names (USAspending, CFPB, openFDA searches) where the SEC name differs. */
export const ALT_NAMES: Record<string, string> = { AAPL: "Apple", MSFT: "Microsoft", NVDA: "NVIDIA", AMZN: "Amazon", GOOGL: "Google", META: "Meta Platforms", AVGO: "Broadcom", AMD: "Advanced Micro Devices", JPM: "JPMorgan Chase", BAC: "Bank of America", GS: "Goldman Sachs", V: "Visa", MA: "Mastercard", LLY: "Eli Lilly", UNH: "UnitedHealth", JNJ: "Johnson & Johnson", MRK: "Merck", WMT: "Walmart", COST: "Costco", XOM: "Exxon Mobil", CVX: "Chevron", CAT: "Caterpillar", HD: "Home Depot", CRM: "Salesforce", NOW: "ServiceNow", CSCO: "Cisco", IBM: "International Business Machines", INTC: "Intel", QCOM: "Qualcomm", TXN: "Texas Instruments", MU: "Micron Technology", NFLX: "Netflix", DIS: "Walt Disney", CMCSA: "Comcast", T: "AT&T", VZ: "Verizon", LOW: "Lowe's", MCD: "McDonald's", SBUX: "Starbucks", NKE: "Nike", BKNG: "Booking Holdings", PG: "Procter & Gamble", KO: "Coca-Cola", PEP: "PepsiCo", PM: "Philip Morris", WFC: "Wells Fargo", C: "Citigroup", MS: "Morgan Stanley", SCHW: "Charles Schwab", AXP: "American Express", SPGI: "S&P Global", ABBV: "AbbVie", PFE: "Pfizer", AMGN: "Amgen", TMO: "Thermo Fisher", ABT: "Abbott Laboratories", ISRG: "Intuitive Surgical", GE: "General Electric", RTX: "Raytheon", BA: "Boeing", LMT: "Lockheed Martin", HON: "Honeywell", DE: "Deere", UNP: "Union Pacific", UPS: "United Parcel Service", COP: "ConocoPhillips", SLB: "Schlumberger", LIN: "Linde", FCX: "Freeport-McMoRan", NEE: "NextEra Energy", DUK: "Duke Energy", SO: "Southern Company", PLD: "Prologis", AMT: "American Tower", EQIX: "Equinix", TSLA: "Tesla", ORCL: "Oracle", ADBE: "Adobe" };

const FORM: Record<string, string> = { inc: "inc", incorporated: "inc", corp: "corp", corporation: "corp", co: "co", company: "co", llc: "llc", ltd: "ltd", limited: "ltd", plc: "plc", lp: "lp", llp: "llp", sa: "sa", nv: "nv", ag: "ag", se: "se" };

/** SEC state tags ("DANAHER CORP /DE/", "US BANCORP \\DE\\") and spelled-out forms are not part of the name. */
const clean = (name: string) => name.replace(/\s*[/\\][A-Z]{2,}[/\\]?\s*$/i, "").replace(/\bpublic limited company\b/gi, "plc");

/** The name without legal-form words, punctuation or "the": "THE BOEING COMPANY" → "boeing". */
export function nameCore(name: string): string {
  return normCompany(clean(name)).replace(/(\s+and)+$/, "").replace(/^and\s+/, "").trim();
}

/** The trailing legal form, canonical: "BALL CORP" → "corp", "Ball Corporation" → "corp", "AECOM" → "". */
export function legalForm(name: string): string {
  const words = clean(name).toLowerCase().replace(/[.'’]/g, "").split(/[^a-z0-9&]+/).filter(Boolean);
  while (words.length && words[words.length - 1] === "the") words.pop();
  return FORM[words[words.length - 1] ?? ""] ?? "";
}

/** A company's identity: the name cores it is known by, and the legal forms its legal names carry. */
export interface CompanyKeys {
  cores: Set<string>;
  /** Legal forms seen on a legal name with that core ("" when the legal name has none). */
  forms: Map<string, Set<string>>;
}

/**
 * `names` are short or registry names (no legal form: "Honeywell"); `legal` are names with their
 * legal form ("HONEYWELL INTERNATIONAL INC", "Ball Corporation").
 */
export function companyKeys(names: (string | null | undefined)[], legal: (string | null | undefined)[]): CompanyKeys {
  const cores = new Set<string>();
  const forms = new Map<string, Set<string>>();
  for (const n of names) {
    const c = n ? nameCore(n) : "";
    if (c.length >= 2) cores.add(c);
  }
  for (const n of legal) {
    const c = n ? nameCore(n) : "";
    if (c.length < 2) continue;
    cores.add(c);
    const f = forms.get(c) ?? new Set<string>();
    f.add(legalForm(n!));
    forms.set(c, f);
  }
  return { cores, forms };
}

/**
 * Whether a recipient name is the company itself: whole-name equality of the cores. A one-word
 * core ("ball", "rogers", "kirby") is common enough to be another business, so it also needs the
 * same legal form as one of the company's legal names ("BALL CORPORATION" yes, "BALL INC" no).
 */
export function isCompanyName(recipient: string | null | undefined, keys: CompanyKeys): boolean {
  if (!recipient) return false;
  const core = nameCore(recipient);
  if (core.length < 2 || !keys.cores.has(core)) return false;
  if (core.includes(" ")) return true;
  return keys.forms.get(core)?.has(legalForm(recipient)) ?? false;
}

export interface UsaRecipient { id: string; name: string; uei?: string | null; duns?: string | null; recipient_level?: string; amount?: number }

/** Parent-level recipients that are the company by whole name, largest first. */
export function pickParents(results: UsaRecipient[], keys: CompanyKeys, max = 6): UsaRecipient[] {
  return results
    .filter((r) => r.recipient_level === "P" && (r.amount ?? 0) > 0 && isCompanyName(r.name, keys))
    .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))
    .slice(0, max);
}

/** USAspending says in `messages` when it ignored a filter; such a response is not about the company. */
export function ignoredFilter(messages: unknown, filter: string): boolean {
  return Array.isArray(messages) && messages.some((m) => typeof m === "string" && /filters from the request were not used/i.test(m) && m.includes(`'${filter}'`));
}

export interface ParentFamily {
  parent: UsaRecipient;
  /** Child recipients the source lists under the parent (`/recipient/children/{uei}/`). */
  children: { recipient_id?: string | null; uei?: string | null; name?: string | null }[];
}

export type Tie = "name" | "child";

/**
 * How an award or transaction is tied to the company: its recipient is the company by name, or the
 * source lists the recipient (by recipient id or UEI) as a child of one of the company's parents.
 * `null` means it is not the company's and must not be stored.
 */
export function awardTie(award: { recipient?: string | null; recipientId?: string | null; uei?: string | null }, families: ParentFamily[], keys: CompanyKeys): { tie: Tie; parent: UsaRecipient | null } | null {
  if (isCompanyName(award.recipient, keys)) return { tie: "name", parent: null };
  for (const f of families) {
    if (!isCompanyName(f.parent.name, keys)) continue;
    const hit = f.children.some((c) => (award.recipientId && c.recipient_id === award.recipientId) || (award.uei && c.uei === award.uei));
    if (hit) return { tie: "child", parent: f.parent };
  }
  return null;
}

/** The fields of a stored `alt_data` row this check reads. */
export interface ContractRowLike { dataset: string; kind: string; meta?: unknown }

/**
 * Whether a stored contracts row may be shown under the company. Events: the recipient is the
 * company, or the collector recorded a child tie to a parent that is the company. Yearly series:
 * every recipient summed into the total is the company (older rows summed prefix look-alikes).
 * Rows of other datasets pass untouched.
 */
export function contractRowBelongs(row: ContractRowLike, keys: CompanyKeys): boolean {
  if (row.dataset !== "contracts") return true;
  const m = (row.meta && typeof row.meta === "object" ? row.meta : {}) as Record<string, unknown>;
  if (row.kind === "series") {
    const rs = Array.isArray(m.recipients) ? (m.recipients as unknown[]) : [];
    return rs.length > 0 && rs.every((r) => typeof r === "string" && isCompanyName(r, keys));
  }
  if (isCompanyName(typeof m.recipient === "string" ? m.recipient : null, keys)) return true;
  return m.tie === "child" && typeof m.parent === "string" && isCompanyName(m.parent, keys);
}

/** Keys for a covered ticker from the names the app carries: hand-checked name, coverage short name, SEC/universe name. */
export function tickerKeys(ticker: string, shortName: string | null | undefined, legalName: string | null | undefined): CompanyKeys {
  return companyKeys([ALT_NAMES[ticker], shortName], [legalName]);
}

/** Drop contracts rows that do not belong to their ticker; `keysOf` returns null when the company is unknown (its rows are dropped). */
export function screenContractRows<T extends ContractRowLike & { ticker: string }>(rows: T[], keysOf: (ticker: string) => CompanyKeys | null): T[] {
  const cache = new Map<string, CompanyKeys | null>();
  return rows.filter((r) => {
    if (r.dataset !== "contracts") return true;
    if (!cache.has(r.ticker)) cache.set(r.ticker, keysOf(r.ticker));
    const k = cache.get(r.ticker);
    return !!k && contractRowBelongs(r, k);
  });
}
