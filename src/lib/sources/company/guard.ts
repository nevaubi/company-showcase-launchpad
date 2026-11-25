// The page's and the collector's guard against name-matched banks: for a ticker the mapping covers, bank rows are
// shown, and a bank is collected, only for certificates the mapping proves. Reads `guard.json`, a small file
// derived from `links.json` by `scripts/company-source-links.ts guard` (the validation test checks they agree).
// Pure and browser-safe: the full mapping and its evidence stay on the server.
import data from "./guard.json";
import type { BankGuardFile } from "./validate";

export const BANK_GUARD = data as BankGuardFile;

export type GuardEntry = BankGuardFile["banks"][string];

/** The proven certificates of a mapped ticker, or null when the mapping does not cover it. */
export function guardEntry(ticker: string, guard: BankGuardFile = BANK_GUARD): GuardEntry | null {
  return guard.banks[ticker.trim().toUpperCase()] ?? null;
}

export const NAME_CAVEAT = {
  name_match: "Matched by name, not by a shared identifier.",
  name_and_subsidiary_list: "Matched by name and by the bank named in the company's subsidiary list, not by a shared identifier.",
} as const;

/** The caveat line for a ticker whose bank panel rests on a name match, or null. */
export function reviewCaveat(ticker: string, guard: BankGuardFile = BANK_GUARD): string | null {
  const kind = guard.review[ticker.trim().toUpperCase()];
  return kind ? NAME_CAVEAT[kind] : null;
}

/** For a company that holds several institutions, the line saying which one bank a call-report panel reads, or null. */
export function bankScopeLine(ticker: string, cert: number | null, guard: BankGuardFile = BANK_GUARD): string | null {
  const e = guardEntry(ticker, guard);
  if (!e || e.certs.length < 2 || cert == null || !e.certs.includes(cert)) return null;
  return `Call reports of one bank, certificate ${cert}, of the ${e.certs.length} institutions the company holds; each one's own figures are under Insured banks.`;
}

/**
 * The certificate a collector may read for a ticker: the candidate when the mapping does not cover the ticker or
 * proves the candidate, otherwise the largest proven insured bank. Never a certificate of another company.
 */
export function collectorCert(ticker: string, candidate: number | null | undefined, guard: BankGuardFile = BANK_GUARD): number | null {
  const e = guardEntry(ticker, guard);
  if (!e) return candidate ?? null;
  return candidate != null && e.certs.includes(candidate) ? candidate : e.main;
}

type AltLike = { uid?: string | null; dataset: string; date?: string | null; value?: number | null; meta?: unknown };
const metaOf = (r: AltLike): Record<string, unknown> => (r.meta && typeof r.meta === "object" ? (r.meta as Record<string, unknown>) : {});
const certOf = (m: Record<string, unknown>): number | null => {
  const n = Number(m.cert);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
const isTotal = (r: AltLike) => typeof r.uid === "string" && r.uid.endsWith(":total");

/** Whether a deposits roll-up (its total row's meta) covers only proven banks of the company. */
export function depositsScopeProven(meta: Record<string, unknown>, e: GuardEntry): boolean {
  const cert = certOf(meta);
  if (cert == null || !e.certs.includes(cert)) return false;
  const scope = typeof meta.scope === "string" ? meta.scope : null;
  if (scope) {
    if (scope.startsWith("rssd:")) return e.rollup.includes(scope.slice(5));
    if (scope.startsWith("certs:")) return scope.slice(6).split(",").every(c => e.certs.includes(Number(c)));
    if (scope.startsWith("cert:")) return e.certs.includes(Number(scope.slice(5)));
    return false;
  }
  // rows written before the scope was recorded: keyed by the holder's RSSD, or by the certificate alone
  const rssd = meta.rssd == null ? "" : String(meta.rssd);
  return rssd === "" || rssd === "0" ? true : e.rollup.includes(rssd);
}

/** Whether a call-report row is of a certificate the mapping proves. */
const bankRowProven = (r: AltLike, e: GuardEntry) => {
  const cert = certOf(metaOf(r));
  return cert != null && e.certs.includes(cert);
};

/** One survey year of one mapped ticker: its total and the state rows of the same roll-up, or nothing (rule below). */
function provenYear<T extends AltLike>(list: T[], e: GuardEntry): T[] {
  const totals = list.filter(isTotal);
  if (totals.length !== 1) return [];
  const total = totals[0];
  const meta = metaOf(total);
  if (!depositsScopeProven(meta, e)) return [];
  const scope = typeof meta.scope === "string" ? meta.scope : null;
  const states = list.filter(r => !isTotal(r) && (!scope || metaOf(r).scope === scope));
  const sum = states.reduce((n, r) => n + (r.value ?? 0), 0);
  if (total.value == null || sum !== total.value) return [];
  return [total, ...states];
}

/**
 * Bank and deposits rows of a mapped ticker, without any row of a bank the mapping does not prove:
 * - call-report rows (`bank`) only for proven certificates;
 * - deposits rows only for years whose total is rolled up over proven banks, with only the state rows of that same
 *   roll-up, and only when those state rows add up exactly to the total (a state left over from an earlier, wrong
 *   roll-up would not).
 * Other datasets and unmapped tickers pass unchanged.
 */
export function guardAltRows<T extends AltLike>(ticker: string, rows: T[], guard: BankGuardFile = BANK_GUARD): T[] {
  const e = guardEntry(ticker, guard);
  if (!e) return rows;
  const deposits = new Map<string, T[]>();
  const out: T[] = [];
  for (const r of rows) {
    if (r.dataset === "bank") {
      if (bankRowProven(r, e)) out.push(r);
    } else if (r.dataset === "deposits") {
      const year = (r.date ?? "").slice(0, 4);
      const list = deposits.get(year);
      if (list) list.push(r);
      else deposits.set(year, [r]);
    } else out.push(r);
  }
  for (const list of deposits.values()) out.push(...provenYear(list, e));
  return out;
}

/**
 * `guardAltRows` over rows of any number of tickers, in their input order: the shared alt screen
 * (`screenAltRows`, src/lib/alt/screen.ts) applies it, so every reader gets it (company pages, the hub's
 * leaderboards, deposits by state, the assistant). For readers that read only part of a company's rows:
 * - a survey year read as its total alone (a leaderboard of totals) keeps the total when its roll-up is proven;
 * - a deposits row read without its key (the leaderboard function returns none) is judged alone: kept only when
 *   its own meta proves the roll-up, which a state row never does (it carries no certificate);
 * - a year read only in part fails the sum and is left out whole.
 */
export function guardBankRows<T extends AltLike & { ticker: string }>(rows: T[], guard: BankGuardFile = BANK_GUARD): T[] {
  const keep = new Set<T>();
  const years = new Map<string, { e: GuardEntry; list: T[] }>();
  for (const r of rows) {
    const e = r.dataset === "bank" || r.dataset === "deposits" ? guardEntry(r.ticker, guard) : null;
    if (!e) keep.add(r);
    else if (r.dataset === "bank") {
      if (bankRowProven(r, e)) keep.add(r);
    } else if (typeof r.uid !== "string") {
      if (depositsScopeProven(metaOf(r), e)) keep.add(r);
    } else {
      const key = `${r.ticker.trim().toUpperCase()}|${(r.date ?? "").slice(0, 4)}`;
      const year = years.get(key);
      if (year) year.list.push(r);
      else years.set(key, { e, list: [r] });
    }
  }
  for (const { e, list } of years.values()) {
    const totalAlone = list.length === 1 && isTotal(list[0]);
    for (const r of totalAlone ? (depositsScopeProven(metaOf(list[0]), e) ? list : []) : provenYear(list, e)) keep.add(r);
  }
  return keep.size === rows.length ? rows : rows.filter(r => keep.has(r));
}
