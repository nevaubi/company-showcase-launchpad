// Who a federal contract award belongs to. USAspending lists awards by recipient (the legal entity
// paid) and groups recipients under a parent; an award is stored and shown for a company only when
// its recipient is that company by whole name, or a child the source itself lists under a parent
// that is that company by whole name. Never a substring or prefix: "ROGERS, WICKER, RYKMAN AND
// SPEDALE LLC" is not Rogers Corporation, and "KIRBY, BETTY" is not Kirby Corporation. Pure.
import { normCompany } from "@/lib/xbrl/counterparty";
import { COVERAGE } from "@/lib/coverage";
import { CONTRACT_ALIASES, type ContractAlias } from "@/lib/alt/contract-aliases";

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

/** Words `normCompany` drops that still tell two businesses apart: "BALL HOLDINGS CORPORATION" is not Ball Corporation. */
export function nameExtras(name: string): Set<string> {
  const out = new Set<string>();
  const s = name.toLowerCase();
  if (/\bholdings?\b/.test(s)) out.add("holdings");
  if (/\bgroup\b/.test(s)) out.add("group");
  if (/\([^)]*\)/.test(s.replace(/\(\s*the\s*\)/g, ""))) out.add("()");
  return out;
}

/** A company's identity: the name cores it is known by, and the legal forms its legal names carry. */
export interface CompanyKeys {
  cores: Set<string>;
  /** Legal forms seen on a legal name with that core ("" when the legal name has none). */
  forms: Map<string, Set<string>>;
  /** Extra words (`nameExtras`) seen on a legal name with that core. */
  extras?: Map<string, Set<string>>;
  /** Hand-checked recipient aliases (CONTRACT_ALIASES) as `core|form`. */
  aliases?: Set<string>;
  /** UEIs of alias recipients USAspending lists as their own parent. */
  parentUeis?: Set<string>;
  /** Cores two different covered companies are known by: never enough on their own. */
  shared?: Set<string>;
}

const aliasKey = (name: string) => `${nameCore(name)}|${legalForm(name)}`;

/**
 * `names` are short or registry names (no legal form: "Honeywell"); `legal` are names with their
 * legal form ("HONEYWELL INTERNATIONAL INC", "Ball Corporation"); `aliases` are hand-checked
 * recipient names matched by whole name (core and legal form).
 */
export function companyKeys(names: (string | null | undefined)[], legal: (string | null | undefined)[], aliases: ContractAlias[] = [], shared?: Set<string>): CompanyKeys {
  const cores = new Set<string>();
  const forms = new Map<string, Set<string>>();
  const extras = new Map<string, Set<string>>();
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
    const x = extras.get(c) ?? new Set<string>();
    for (const w of nameExtras(n!)) x.add(w);
    extras.set(c, x);
  }
  return {
    cores,
    forms,
    extras,
    aliases: new Set(aliases.map((a) => aliasKey(a.name))),
    parentUeis: new Set(aliases.flatMap((a) => a.ueis ?? [])),
    shared,
  };
}

/**
 * Whether a recipient name is the company itself:
 *   - it is one of the company's hand-checked aliases by whole name (core and legal form), or
 *   - its core equals one of the company's cores, that core is not shared with another covered
 *     company ("first bancorp" is both FBP and FBNC), and
 *       - a one-word core ("ball", "rogers", "kirby") carries the same legal form as one of the
 *         company's legal names and no extra word the legal name lacks ("BALL CORPORATION" yes,
 *         "BALL INC" and "BALL HOLDINGS CORPORATION" no);
 *       - a multi-word core without any legal form ("SCHWAB, CHARLES", "ROBERT HALF") is a person
 *         or a trade name unless a legal name of the company has no form either ("JOHNSON & JOHNSON").
 */
export function isCompanyName(recipient: string | null | undefined, keys: CompanyKeys): boolean {
  if (!recipient) return false;
  if (keys.aliases?.has(aliasKey(recipient))) return true;
  const core = nameCore(recipient);
  if (core.length < 2 || !keys.cores.has(core) || keys.shared?.has(core)) return false;
  const form = legalForm(recipient);
  const forms = keys.forms.get(core);
  if (!core.includes(" ")) {
    if (!forms?.has(form)) return false;
    const allowed = keys.extras?.get(core) ?? new Set<string>();
    return [...nameExtras(recipient)].every((w) => allowed.has(w));
  }
  return form !== "" || !!forms?.has("");
}

export interface UsaRecipient { id: string; name: string; uei?: string | null; duns?: string | null; recipient_level?: string; amount?: number }

/** Whether a recipient-list entry is the company: by name, or by a hand-checked alias UEI. */
export function isCompanyRecipient(r: { name?: string | null; uei?: string | null }, keys: CompanyKeys): boolean {
  return isCompanyName(r.name, keys) || (!!r.uei && !!keys.parentUeis?.has(r.uei));
}

/**
 * Parent-level recipients that are the company, largest first. A parent's `amount` is its recent
 * obligations and can be negative (deobligations): any non-zero amount counts.
 */
export function pickParents(results: UsaRecipient[], keys: CompanyKeys, max = 8): UsaRecipient[] {
  const seen = new Set<string>();
  return results
    .filter((r) => r.recipient_level === "P" && (r.amount ?? 0) !== 0 && isCompanyRecipient(r, keys))
    .sort((a, b) => Math.abs(b.amount ?? 0) - Math.abs(a.amount ?? 0))
    .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
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
    if (!isCompanyRecipient(f.parent, keys)) continue;
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
  if (m.tie !== "child") return false;
  return (typeof m.parent === "string" && isCompanyName(m.parent, keys)) || (typeof m.parent_uei === "string" && !!keys.parentUeis?.has(m.parent_uei));
}

/** Keys for a covered ticker from the names the app carries: hand-checked name, coverage short name, SEC/universe name. */
export function tickerKeys(ticker: string, shortName: string | null | undefined, legalName: string | null | undefined | (string | null | undefined)[], shared: Set<string> = coverageSharedCores()): CompanyKeys {
  return companyKeys([ALT_NAMES[ticker], shortName], Array.isArray(legalName) ? legalName : [legalName], CONTRACT_ALIASES[ticker] ?? [], shared);
}

/**
 * Name cores that two different covered companies (different SEC CIKs; share classes of one company
 * are one company) are known by. `names` lists every name a company goes by: hand-checked, short
 * and legal names.
 */
export function sharedCores(companies: { cik: string; names: (string | null | undefined)[] }[]): Set<string> {
  const owner = new Map<string, string>();
  const out = new Set<string>();
  for (const c of companies) {
    for (const n of c.names) {
      const core = n ? nameCore(n) : "";
      if (core.length < 2) continue;
      const o = owner.get(core);
      if (o === undefined) owner.set(core, c.cik);
      else if (o !== c.cik) out.add(core);
    }
  }
  return out;
}

let coverageShared: Set<string> | null = null;
/** `sharedCores` over the coverage list's hand-checked and short names (legal names are added where a caller has them). */
export function coverageSharedCores(): Set<string> {
  coverageShared ??= sharedCores(COVERAGE.map((c) => ({ cik: c.cik, names: [ALT_NAMES[c.ticker], c.shortName] })));
  return coverageShared;
}

/**
 * Collection record the contracts collector writes once per company when a collection completed
 * (every source call answered). The repair deletes a company's legacy rows only after such a record
 * newer than the fix exists, and keeps rows whose recipient the record lists as the company's.
 */
export const REFRESH_DATASET = "contracts_refresh";
/** Version of the contracts rule; a refresh record from an older rule does not count. */
export const CONTRACTS_RULE = 2;

export interface RefreshMeta {
  refresh: true;
  rule: number;
  as_of: string;
  parents: { name: string; id: string; uei: string | null }[];
  /** Recipient names of the parents and every child the source lists under them. */
  family: string[];
}

/** The refresh record of a stored row, when it is one of the current rule. */
export function refreshOf(row: { dataset: string; meta?: unknown }): RefreshMeta | null {
  if (row.dataset !== REFRESH_DATASET) return null;
  const m = row.meta as Partial<RefreshMeta> | null | undefined;
  return m && m.refresh === true && typeof m.as_of === "string" && Number(m.rule) >= CONTRACTS_RULE && Array.isArray(m.family) ? (m as RefreshMeta) : null;
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
