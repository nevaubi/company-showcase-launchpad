// Deterministic checks of the fields a language model reads from a supply-link sentence.
// Each stored link carries a quote that was verified word for word against the filing; the other
// fields (amount, sole source, regions, relation) were returned by the model and are trusted here
// only as far as the quote itself bears them out. Nothing in this file invents a value: a claim the
// sentence does not state is removed or labelled, never replaced. Pure, no browser/Node APIs.
import { normText, type Relation, type RiskLink } from "./core";
import { statedCountries } from "./geo";

/* ---------------------------------------------------------------- money in a sentence */

const UNIT: Record<string, number> = {
  thousand: 1e3, k: 1e3,
  million: 1e6, mm: 1e6, mn: 1e6, mil: 1e6, m: 1e6,
  billion: 1e9, bn: 1e9, b: 1e9,
  trillion: 1e12, tn: 1e12, t: 1e12,
};

/** One number in the sentence and what the sentence says about its scale and currency. */
export interface MoneyToken {
  /** value in dollars once the stated unit (or the stated table scale) is applied */
  value: number;
  /** the number as written, before any scale */
  raw: number;
  /** offset of the token in the sentence */
  at: number;
  /** characters the token spans */
  len: number;
  /** marked as U.S. dollars ($, US$, USD, "dollars") */
  usd: boolean;
  /** marked as another currency (C$, NT$, EUR, RMB, ...) */
  foreign: boolean;
  /** where the scale came from: a unit word next to the number, the sentence's "in millions" note, or nothing */
  scale: "unit" | "context" | "none";
  /** marked U.S. dollars in so many words (US$, U.S.$, USD, "U.S. dollars"), which a foreign-currency table note does not override */
  explicit?: boolean;
}

// number, then an optional unit word glued or spaced ("$1.2 billion", "$5M", "$1.2bn", "$1,018 million"); "$.5 billion" too
const NUM = /(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|(?<=\$\s?)\.\d+)(?:[ -]?(trillion|billion|million|thousand|bn|tn|mm|mn|mil\.?)\b|(k|m|b|t)\b)?/gi;
/** Names of currencies that write their amounts with a dollar sign or after the figure ("$50 million CAD", "(Canadian)"). */
const CUR_WORDS = String.raw`canadian|australian|new zealand|hong kong|singapore|mexican|taiwan(?:ese)?|cad|cdn|aud|nzd|hkd|sgd|mxn|twd|eur|euros?|gbp|chf|jpy|rmb|cny|yen|yuan|renminbi`;
const FOREIGN_BEFORE = /(?:[€£¥₹₩]\s?|\b(?:eur|euros?|gbp|jpy|yen|rmb|cny|renminbi|chf|cad|cdn|aud|nzd|inr|krw|sek|nok|dkk|brl|mxn|hkd|twd|sgd|pln|ils|zar|ars|cop|clp)\s?|(?:^|[^a-z])(?:nt|c|a|hk|r|s|mx|nz|ca|au|cdn|aud|cad|nzd|mex|ars|cop|clp)\$\s?)$/i;
/** "AU $50 million", "was C $50": a capital currency letter set apart from the sign. A capital "A" that starts a sentence is the article. */
const FOREIGN_SPACED = /(?:[a-z0-9,;:]\s|\()(?:A|AU|C|CA|CDN|NZ|HK|S|R|NT|MX)\s\$\s?$/;
const FOREIGN_AFTER = new RegExp(String.raw`^\s?(?:euros?|pounds? sterling|yen|rmb|renminbi|yuan|swiss francs|francs|won|rupees|reais|pesos|kroner|kronor|zloty|rand|\(?(?:${CUR_WORDS})\b)`, "i");
const USD_BEFORE = /(?:^|[^a-z])(?:u\.?s\.?\s?\$|us\$|usd\s?|\$)\s?$/i;
const USD_EXPLICIT_BEFORE = /(?:^|[^a-z])(?:u\.?s\.?\s?\$|us\$|usd\s?)\s?$/i;
const USD_AFTER = /^\s?(?:u\.s\. )?(?:dollars|usd)\b/i;
const USD_EXPLICIT_AFTER = /^\s?(?:u\.s\. dollars|usd)\b/i;
const CONNECT = /^\s*(?:to|and|or|through|-|–)\s*(?:approximately |about )?$/i;

/** A table note: "(in millions)", "(dollars in thousands)", "(C$ in millions)", "(in millions of Canadian dollars)". */
const NOTE_PAREN = new RegExp(
  String.raw`\(\s*(?:(${CUR_WORDS})\s+)?(?:(u\.s\.\s*\$|us\$|\$|u\.s\. dollars|dollars?|amounts?|usd|[a-z]{1,3}\$)\s*)?in (thousands|millions|billions)(?:\s+of\s+(?:(u\.s\.\s|us\s)?(dollars)|(${CUR_WORDS}|pounds|francs)(?:\s+dollars)?))?\s*(?:,[^)]*)?\)`,
  "i",
);
/** The same note without brackets: "$ in thousands", "dollars in millions", or "In millions," opening the quote. */
const NOTE_BARE = /(?:(?:^|[^a-z])(\$|dollars|amounts) in (thousands|millions|billions)\b)|(?:^\s*()in (thousands|millions|billions)\s*(?:,|:|$))/i;

/**
 * The scale a sentence gives its unmarked figures. Only a table note counts ("(in millions)", "$ in thousands",
 * "dollars in billions", "In millions," at the start), never prose such as "in millions of homes" or "(units in millions)".
 * `foreign` is set when the note names another currency ("(Canadian dollars in millions)", "(in millions of euros)").
 */
export function contextScale(quote: string): { scale: number; dollars: boolean; foreign: boolean } | null {
  const sc = (w: string) => (w.toLowerCase() === "thousands" ? 1e3 : w.toLowerCase() === "millions" ? 1e6 : 1e9);
  const p = NOTE_PAREN.exec(quote);
  if (p) {
    const mark = (p[2] ?? "").toLowerCase();
    const prefixForeign = /^[a-z]{1,3}\$$/.test(mark) && !/^us\$$/.test(mark);
    const foreign = !!p[1] || !!p[6] || prefixForeign;
    return { scale: sc(p[3]), dollars: !foreign && !!(mark || p[5]), foreign };
  }
  const b = NOTE_BARE.exec(quote);
  if (b) return { scale: sc(b[2] ?? b[4]), dollars: !!b[1], foreign: false };
  return null;
}

/** Every number in the sentence, with the currency and scale the sentence itself gives it. */
export function moneyTokens(quote: string): MoneyToken[] {
  const ctx = contextScale(quote);
  const out: MoneyToken[] = [];
  NUM.lastIndex = 0;
  for (let m = NUM.exec(quote); m; m = NUM.exec(quote)) {
    const before = quote.slice(Math.max(0, m.index - 12), m.index);
    const after = quote.slice(m.index + m[0].length, m.index + m[0].length + 24);
    // part of a word or a code ("Q3", "10-K", "2025A"): not a figure
    if (/[A-Za-z]$/.test(before) && !/\$\s?$/.test(before) && !/(?:usd|us)\s?$/i.test(before)) continue;
    const raw = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(raw)) continue;
    const unitWord = (m[2] ?? m[3] ?? "").toLowerCase().replace(/\.$/, "");
    // a single-letter unit counts only when glued to a dollar figure ("$5M"), never "5 m" or "100 k"
    const glued = !!m[3];
    const foreign = FOREIGN_BEFORE.test(before) || FOREIGN_SPACED.test(before) || FOREIGN_AFTER.test(after);
    const usd = !foreign && (USD_BEFORE.test(before) || USD_AFTER.test(after));
    const explicit = usd && (USD_EXPLICIT_BEFORE.test(before) || USD_EXPLICIT_AFTER.test(after));
    if (glued && !usd) {
      out.push({ value: raw, raw, at: m.index, len: m[1].length, usd, foreign, scale: "none", explicit });
      continue;
    }
    const unit = unitWord ? UNIT[unitWord] : undefined;
    out.push({ value: unit ? raw * unit : raw, raw, at: m.index, len: m[0].length, usd, foreign, scale: unit ? "unit" : "none", explicit });
  }
  // ranges: "$1.0 to $1.2 billion", "$1-2 billion", "between $5 and $10 million" share the later unit and currency
  for (let i = out.length - 2; i >= 0; i--) {
    const a = out[i], b = out[i + 1];
    const gap = quote.slice(a.at + a.len, b.at).replace(/\$\s?$/, "");
    if (!CONNECT.test(gap)) continue;
    // a year next to a figure ("in 2024 and $44.0 million") is not the start of a range
    const year = (t: MoneyToken) => t.scale === "none" && !t.usd && /^(?:19|20)\d{2}$/.test(quote.slice(t.at, t.at + t.len));
    if (year(a) || year(b)) continue;
    if (a.scale === "none" && b.scale === "unit" && (a.usd || b.usd)) {
      const unit = b.value / b.raw;
      a.value = a.raw * unit;
      a.scale = "unit";
    }
    if (a.usd && !b.usd && !b.foreign) b.usd = true;
    if (b.usd && !a.usd && !a.foreign) a.usd = true;
  }
  // a note in another currency makes every "$" in the sentence that currency's, unless the figure says U.S. dollars itself
  if (ctx?.foreign) for (const t of out) if (!t.explicit) {
    t.foreign = true;
    t.usd = false;
    if (t.scale === "none") {
      t.value = t.raw * ctx.scale;
      t.scale = "context";
    }
  }
  // "(in millions)": a dollar figure written without a unit takes the sentence's scale; a bare figure only when the note says dollars
  // a bare four-digit year ("In 2024, sales were 1,018") is never a figure, even under "(dollars in millions)"
  if (ctx && !ctx.foreign) for (const t of out) if (t.scale === "none" && !t.foreign && (t.usd || (ctx.dollars && !/^(?:19|20)\d{2}$/.test(quote.slice(t.at, t.at + t.len))))) {
    t.value = t.raw * ctx.scale;
    t.scale = "context";
    t.usd = true;
  }
  return out;
}

/** A unit-less dollar figure below this is read as a table value whose scale the sentence does not give ($1,018 meaning $1,018 million). */
const UNSCALED_BELOW = 1e6;
/** Stored amounts below this cannot be a filing's figure for a business relationship; they are unscaled table values. */
const SMALLEST = 1e4;
/** Rounding allowed between the stated figure and the stored one. */
const TOL = 0.005;

export type AmountCheck =
  | { ok: true; token: MoneyToken }
  | { ok: false; why: "none" | "not-positive" | "too-small" | "not-in-quote" | "unit-missing" | "foreign" | "bare-number" };

/**
 * Is `amount` (full U.S. dollars) stated in the sentence? Only a figure the sentence marks as dollars counts,
 * with its own unit word or the sentence's "in millions" note; a figure equal to a bare number, to a dollar
 * figure without its unit, or to a figure in another currency is not verified.
 */
export function checkAmount(quote: string, amount: number | null | undefined): AmountCheck {
  if (amount == null || !Number.isFinite(amount)) return { ok: false, why: "none" };
  if (amount <= 0) return { ok: false, why: "not-positive" };
  const near = (v: number) => v > 0 && Math.abs(v - amount) <= TOL * v;
  const toks = moneyTokens(quote);
  const hit = toks.find((t) => t.usd && !t.foreign && near(t.value) && (t.scale !== "none" || t.raw >= UNSCALED_BELOW));
  if (hit && amount >= SMALLEST) return { ok: true, token: hit };
  if (amount < SMALLEST) return { ok: false, why: "too-small" };
  if (toks.some((t) => t.foreign && near(t.value))) return { ok: false, why: "foreign" };
  // the stored value is a written figure scaled by a unit the sentence never gives
  if (toks.some((t) => !t.foreign && t.scale === "none" && [1e3, 1e6, 1e9].some((s) => near(t.raw * s)))) return { ok: false, why: "unit-missing" };
  if (toks.some((t) => !t.usd && near(t.value))) return { ok: false, why: "bare-number" };
  return { ok: false, why: "not-in-quote" };
}

/** True when the sentence states this dollar amount (see `checkAmount`). It does not ask whose amount it is: see `checkPartyAmount`. */
export function amountInQuote(quote: string, amount: number | null | undefined): boolean {
  return checkAmount(quote, amount).ok;
}

/* ---------------------------------------------------------------- whose figure it is */

/** Abbreviations whose period does not end a clause ("U.S. Government", "Walmart Inc. were", "Co. Ltd."). */
const ABBREV = /(?:\b(?:u\.s|u\.k|u\.s\.a|inc|co|cos|corp|ltd|no|nos|n\.a|s\.a|n\.v|b\.v|l\.p|l\.l\.c|llc|plc|ag|jr|sr|st|mr|ms|dr|vs|approx|e\.g|i\.e|cf|dept|govt|intl|bros|mfg|assn|int'l)|(?:^|[^a-z])[a-z])$/i;

/** Offsets of the clause around [at, at + len): from the previous "; " or sentence break to the next one. */
function clauseBounds(quote: string, at: number, len: number, back = 150, ahead = 90): [number, number] {
  const lo = Math.max(0, at - back), hi = Math.min(quote.length, at + len + ahead);
  const isBreak = (i: number) => quote[i] === ";" || (quote[i] === "." && !ABBREV.test(quote.slice(Math.max(0, i - 8), i)));
  let left = lo;
  for (let i = at - 1; i >= lo; i--) if (quote[i + 1] === " " && isBreak(i)) { left = i + 2; break; }
  let right = hi;
  for (let i = at + len; i < hi - 1; i++) if (quote[i + 1] === " " && isBreak(i)) { right = i; break; }
  return [left, right];
}

/** The stretch of the sentence that speaks about the figure: from the previous clause break to the next. */
function around(quote: string, at: number, len: number): string {
  const [l, r] = clauseBounds(quote, at, len);
  return quote.slice(l, r).toLowerCase();
}

/** Words of a name that say nothing on their own ("Inc.", "Group", "Energy Partners"). */
const NAME_STOP = new Set(
  "inc incorporated corp corporation co cos company companies ltd limited llc lp llp plc sa ag nv bv gmbh se spa srl kk the and of for de del la le les group holdings holding".split(" "),
);
const NAME_GENERIC = new Set(
  "international global national association trust partners partner bank capital financial services solutions technologies technology systems energy resources pharmaceuticals pharma industries enterprises american united states first new general federal north south east west america americas world".split(" "),
);
const MONTH = /^(?:january|february|march|april|may|june|july|august|september|october|november|december|fiscal|q[1-4])$/i;

/** Lower-case words that identify a counterparty in a sentence, most distinctive first; generic words only when nothing else is left. */
export function nameWords(name: string): string[] {
  const words = normText(name ?? "").replace(/&/g, "and").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !NAME_STOP.has(w));
  const own = words.filter((w) => !NAME_GENERIC.has(w));
  return own.length ? own : words;
}

/** Does `text` name the counterparty: a distinctive word of its name, its initials ("CEPI", "DOE", "MVG"), or a name like "AT&T" as written? */
export function namesParty(text: string, name: string | null | undefined): boolean {
  if (!name?.trim()) return false;
  const t = ` ${normText(text).replace(/&/g, "and")} `;
  const whole = normText(name).replace(/&/g, "and").replace(/[.,]/g, "").replace(/\b(?:inc|corp|corporation|co|company|ltd|llc|lp|plc|the)\b/g, " ").replace(/\s+/g, " ").trim();
  if (whole.length >= 2 && new RegExp(`[^a-z0-9]${whole.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^a-z0-9]`).test(t)) return true;
  if (nameWords(name).some((w) => new RegExp(`[^a-z0-9]${w}`).test(t))) return true;
  // the end of a long name as a filing shortens it ("Centre 1 Capital Trust I" as "Trust I")
  const words = normText(name).replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length >= 3 && new RegExp(`[^a-z0-9]${words.slice(-2).join(" ")}[^a-z0-9]`).test(t)) return true;
  const all = normText(name).replace(/[^a-z ]/g, " ").split(/\s+/).filter(Boolean);
  const initials = [all, all.filter((w) => !NAME_STOP.has(w))].map((ws) => ws.map((w) => w[0]).join(""));
  for (const m of text.match(/\b[A-Z][A-Z&]{2,7}\b/g) ?? []) if (initials.some((i) => i.includes(m.toLowerCase().replace(/&/g, "")))) return true;
  return false;
}

/** Words that point back at the counterparty without naming it ("the customer", "the Fund", "this agreement"). */
const ANAPHOR = /\b(?:the|this|such|that|these|those|each)\s+(?:customers?|clients?|suppliers?|vendors?|partners?|licensees?|licensors?|lessees?|tenants?|lenders?|funds?|trusts?|ventures?|joint ventures?|jvs?|collaborations?|agreements?|contracts?|arrangements?|licen[cs]es?|programs?|programmes?|counterpart(?:y|ies)|manufacturers?|distributors?|purchasers?|buyers?|sellers?|operators?|investees?|affiliates?|borrowers?|issuers?|panel|award|order|grant)\b/i;
/** A phrase that gives the figure to a named party ("sales to Home Depot", "purchases from Intel", "an agreement with Shell"). */
const TIE_PARTY = /\b(?:sales|sold|revenues?|net sales|purchases|purchased|bought|payments?|paid|received|receivables?|agreements?|contracts?|awarded|owed|due)\s+(?:\w+\s+){0,2}?(?:to|from|with|by)\s+(?:the\s+)?([A-Z][A-Za-z0-9&.'-]*(?:\s+(?:[A-Z][A-Za-z0-9&.'-]*|of|and|&))*)/g;
const FILER_WORDS = /^(?:we|us|our|the company|company|the registrant|registrant)$/i;

/** Wording that makes the figure the filer's own total, or the base of a percentage ("12% of our $2.5 billion revenue"). */
const BASE_BEFORE = [
  /\b(?:of|out of)\s+(?:our|its|the company's|total|consolidated|the total|the consolidated)\b[^$%;]{0,40}?$/i,
  /\b(?:(?:our|its|the company's)\s+(?:total|consolidated|aggregate)|consolidated)\s+(?:net\s+)?(?:operating\s+)?(?:revenues?|sales|net sales|purchases)\s*(?:of|was|were|totaled|totalled|totaling|totalling|amounted to|:)?\s*$/i,
];

export type PartyCheck =
  | { ok: true; token: MoneyToken }
  | { ok: false; why: Exclude<AmountCheck, { ok: true }>["why"] | "base" | "other-party" | "list-position" | "not-tied" };

/** Position the sentence gives this figure in a list ("$5, $3 and $2 million ... in 2025, 2024 and 2023"): true when it is the counterparty's (or the latest year's) place. */
function listPlaceOk(quote: string, toks: MoneyToken[], tok: MoneyToken, lo: number, hi: number, counterparty: string): boolean {
  const inClause = toks.filter((t) => t.usd && t.at >= lo && t.at < hi);
  // ranges ("$1.0 to $1.2 billion") are one figure, not a list
  const isRange = (a: MoneyToken, b: MoneyToken) => {
    const gap = quote.slice(a.at + a.len, b.at).replace(/\$\s?$/, "");
    return /^\s*(?:to|through|-|–)\s*(?:approximately |about )?$/i.test(gap) || (/^\s*and\s*$/i.test(gap) && /\bbetween\s*(?:u\.?s\.?\s?)?\$?\s?$/i.test(quote.slice(Math.max(0, a.at - 12), a.at)));
  };
  const list = inClause.filter((t, i) => i === 0 || !isRange(inClause[i - 1], t));
  const idx = list.indexOf(tok);
  if (list.length < 2 || idx < 0) return true;
  // one year after each figure: "$47.5 million in 2025, $46.5 million in 2024"
  const own = list.map((t) => /^\s*(?:in|for|during)\s+(?:fiscal\s+(?:year\s+)?)?((?:19|20)\d{2})\b/i.exec(quote.slice(t.at + t.len, t.at + t.len + 24))?.[1]);
  if (own.every(Boolean)) return Number(own[idx]) === Math.max(...own.map(Number));
  const last = list[list.length - 1];
  const tail = quote.slice(last.at + last.len, hi);
  const head = quote.slice(lo, list[0].at);
  const resp = /\brespectively\b/i.test(tail);
  const yearsIn = (t: string) => (t.match(/\b(?:19|20)\d{2}\b/g) ?? []).map(Number);
  const tailYears = yearsIn(tail.slice(0, resp ? tail.search(/\brespectively\b/i) : 60));
  if (tailYears.length === list.length) return tailYears[idx] === Math.max(...tailYears);
  if (!resp) return true;
  // "for the nine month periods ended July 31, 2026 and August 1, 2025 were $2,107.6 million and $2,019.9 million, respectively"
  const headYears = yearsIn(head);
  if (headYears.length === list.length) return headYears[idx] === Math.max(...headYears);
  // "the three and nine months ended ...": periods of one party's figure, any of them is the party's own
  if (/\b(?:three|six|nine|twelve)\b[^.;]{0,20}\bmonths?\b|\bquarters?\b|\bperiods?\b/i.test(head + tail)) return true;
  // names listed in the same order as the figures, before them or after them: each list item's last capitalised run
  // ("... agreements with Caesars", "MGM", "they are obligated ..." gives Caesars, MGM)
  const split = (t: string) => t.split(/,\s*(?:and\s+)?|\s+and\s+/).map((x) => x.trim()).filter(Boolean);
  const nameIn = (item: string) => /(?:^|\s)(?:we|us|the company)$/i.test(item) ? "we" : [...item.matchAll(/\b[A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*)*/g)].map((m) => m[0]).pop() ?? null;
  for (const part of [split(tail.slice(0, tail.search(/\brespectively\b/i))), split(quote.slice(lo, list[0].at))]) {
    const names = part.map(nameIn);
    for (let start = 0; start + list.length <= names.length; start++) {
      const win = names.slice(start, start + list.length);
      if (win.some((n) => !n)) continue;
      const at = win.findIndex((n) => namesParty(n as string, counterparty));
      if (at >= 0) return at === idx;
    }
  }
  return false;
}

/**
 * Is `amount` stated in the sentence as this counterparty's figure? It must first be stated (`checkAmount`); then the
 * sentence must tie it to the party: the party is named (or pointed back to: "the customer", "the agreement") and the
 * figure is not the filer's own total or a percentage's base, not another named party's ("sales to Home Depot were
 * $2.1 billion" on a Lowe's link), and in a list ("respectively", one figure per year) it sits in the party's own place.
 */
export function checkPartyAmount(quote: string, amount: number | null | undefined, counterparty: string | null | undefined): PartyCheck {
  const base = checkAmount(quote, amount);
  if (!base.ok) return base;
  const toks = moneyTokens(quote);
  const hits = toks.filter((t) => t.usd && !t.foreign && Math.abs(t.value - (amount as number)) <= TOL * t.value && (t.scale !== "none" || t.raw >= UNSCALED_BELOW));
  let why: PartyCheck = { ok: false, why: "not-tied" };
  for (const tok of hits) {
    const [lo, hi] = clauseBounds(quote, tok.at, tok.len);
    const pre = quote.slice(lo, tok.at).replace(/(?:u\.?s\.?\s?\$|us\$|usd|\$)\s?$/i, "").replace(/(?:approximately|about|nearly|over|roughly)\s*$/i, "");
    if (BASE_BEFORE.some((re) => re.test(pre))) { why = { ok: false, why: "base" }; continue; }
    if (!listPlaceOk(quote, toks, tok, lo, hi, counterparty ?? "")) { why = { ok: false, why: "list-position" }; continue; }
    const clause = quote.slice(lo, hi);
    const inClause = namesParty(clause, counterparty);
    if (!inClause) {
      // the verb may open the clause ("Sales to Home Depot were"), names keep their capitals
      const others = [...clause.replace(/^\s*[A-Z]/, (c) => c.toLowerCase()).matchAll(TIE_PARTY)].map((m) => m[1].replace(/\s+(?:of|and|&)$/i, "").trim()).filter((n) => !FILER_WORDS.test(n) && !MONTH.test(n.split(/\s+/)[0]));
      if (others.some((n) => !namesParty(n, counterparty))) { why = { ok: false, why: "other-party" }; continue; }
      if (!namesParty(quote, counterparty) && !ANAPHOR.test(clause)) { why = { ok: false, why: "not-tied" }; continue; }
    }
    return { ok: true, token: tok };
  }
  return why;
}

/* ---------------------------------------------------------------- what a stated amount is */

export type AmountKind =
  | "revenue"
  | "purchases"
  | "contract"
  | "commitment"
  | "investment"
  | "financing"
  | "guarantee"
  | "settlement"
  | "balance"
  | "other";
/** Money that passes between the two parties for goods or services. Only these widen a flow. */
export const FLOW_KINDS: ReadonlySet<AmountKind> = new Set<AmountKind>(["revenue", "purchases", "contract"]);
export const isFlowKind = (k: AmountKind | null | undefined): boolean => !!k && FLOW_KINDS.has(k);

/** An asset or business changing hands: "purchased a group of ... assets from", "bought the Mobile refinery", "acquired a 20% interest". */
const ASSET_DEAL = /\b(?:purchased?|purchasing|bought|buy|acquired?|acquiring|acquisition of)\b[^.;$]{0,60}?\b(?:assets|plants?|facilit(?:y|ies)|refiner(?:y|ies)|(?<!course of )business(?:es)?|operations|portfolios?|propert(?:y|ies)|interests?|stakes?|pipelines?|terminals?|mines?|fleet|spectrum|stations?|hospitals?|stores|brands?|divisions?|segments?|subsidiar(?:y|ies)|shares|joint ventures?|(?:\d+(?:\.\d+)?\s?%|percent)\s+(?:of|interest|stake|ownership))\b/;

/** Ordered: the first family whose wording sits near the figure decides. Non-flow families come first, so a doubt never becomes a flow. */
const KIND_RULES: [Exclude<AmountKind, "revenue" | "purchases" | "contract">, RegExp][] = [
  ["settlement", /\b(settle(?:d|ment|ments)?|judgm?ents?|damages|arbitra\w*|verdict|litigation|lawsuits?|penalt(?:y|ies)|fines?|class action)\b/],
  // buying or selling assets or a business is a corporate deal, not a purchase of goods ("purchased ... processing assets from Rimrock")
  ["investment", ASSET_DEAL],
  ["guarantee", /\b(guarant\w*|letters? of credit|surety|indemnif\w*|collateral|pledged?)\b/],
  ["financing", /\b(lent|lend(?:s|ing)?|loaned|notes? receivable|loans?|credit (?:facilit\w*|agreements?|lines?)|line of credit|revolv\w*|borrow\w*|lenders?|financing|indebtedness|commercial paper|debentures?|notes due|senior notes|(?:term|bridge) loan|bonds?|securitiz\w*|discount window|advances?|debt)\b/],
  ["investment", /\b(invest\w*|equity|stake|ownership|interests? in|acqui\w*|divest\w*|purchase price|enterprise value|merger|(?:cash |purchase |merger |total |aggregate )consideration|consideration (?:of|paid|received|totaling)|tender offer|spin-?off|capital (?:contributions?|commitments?|calls?)|contribut\w* (?:capital|cash)|contributed \$[^.;]{0,40}\bto|limited partner|general partner|preferred stock|common stock|shares of|stock purchase|(?:sale|sell|sold) (?:of )?(?:our|its|the|all|certain|a|an)\b[^$]{0,60}\b(?:business|division|segment|subsidiar\w*|interest|stake|unit|assets|operations|licenses|rights|facilit\w*)|proceeds|distributions? (?:from|received|of)|dividends?|returns? of capital|valuation)\b/],
  ["balance", /\b(receivables?|payables?|owed|owes|outstanding balance|amounts? due|due (?:from|to)|recoverables?|deferred revenue|accrued|unbilled|prepa(?:id|yments?)|deposits?)\b/],
  ["commitment", /\b(commit\w*|obligat\w*|minimum (?:purchase|volume)s?|take-or-pay|non-?cancell?able|(?:agreed|required|obligated) to (?:purchase|buy|pay)|will (?:purchase|buy|pay)|purchase requirements?)\b/],
  ["other", /\b(grants?|funding|fund(?:s|ed)? (?:the|a|our)|subsid(?:y|ies|ized|ised|ize|ise)\b|incentives?|tax credits?|award(?:ed)?\b[^.;]{0,40}\bto (?:support|fund|help|build)|milestones?|potential|eligible|up to|programs? (?:size|budget)|market|capacity|fair value|gains?|loss(?:es)?|impairment|write-?(?:off|down)|valued at|value of|aggregate (?:principal|amount)|plan(?:ned|s)? to (?:invest|spend)|cap(?:ped)?\b|limit)\b/],
];
const CONTRACT = /\b(contracts?|task orders?|delivery orders?|purchase orders?|orders?|awards?|awarded|backlog|book(?:ed|ings?)|idiq|agreements? (?:valued|worth)|worth|to (?:provide|supply|deliver|build|manufacture)|remaining performance obligations?|rpos?)\b/;
/** Order books are stated as obligations; they are contract value between the parties, not a purchase commitment. */
const BACKLOG = /\b(backlog|book(?:ed|ings?)|remaining performance obligations?|rpos?)\b/;
const ROYALTY_PAID = /\broyalt(?:y|ies) (?:paid|payable|owed|expense)|\bpaid [^.;]{0,30}\broyalt/;
const REVENUE = /\b(royalt(?:y|ies)|license fees?|licen[cs]e payments?|up-?front(?:,? non-?refundable)? payments?|royalt(?:y|ies) (?:revenue|income|received|paid to us)|revenues?|premiums (?:earned|written)|net sales|sales (?:to|of|from)|total sales|sold to|sold\b[^.;$]{0,40}?\bto\b|sells?\b[^.;$]{0,40}?\bto\b|billings?|billed|recogni[sz]ed|earned|income from|received from|paid (?:us|to us)|fees? (?:from|earned))\b/;
const PURCHASES = /\b(purchased?|purchases|bought|paid (?:to )?(?!us\b)|payments? (?:to|made to)|spent|spend|procured|cost of|costs (?:of|paid)|fees? (?:paid|to)|expenses? (?:with|paid|to))\b/;

/** Model-written detail that marks the figure as plainly not a trade payment (it can only take a flow away). */
const VETO = /\b(settle\w*|judgm?ent|loans?|credit facilit\w*|borrow\w*|guarant\w*|equity (?:stake|interest|investment)|acqui\w*|divest\w*)\b/;


/**
 * What a verified amount is, read from the words around it in the sentence. `detail` (written by the model) may only
 * push a figure away from being a flow, never towards one. Unverified amounts are `other`.
 */
export function amountKind(quote: string, detail: string, amount?: number | null, counterparty?: string | null): AmountKind {
  const check = amount == null ? null : counterparty != null ? checkPartyAmount(quote, amount, counterparty) : checkAmount(quote, amount);
  const tok = check?.ok ? check.token : moneyTokens(quote).find((t) => t.usd);
  // "power purchase agreement" names a contract, not who buys: the seller's revenue must not read as a purchase
  const near = (tok ? around(quote, tok.at, tok.len) : quote.toLowerCase()).replace(/\b(?:power |energy |gas |asset |stock |share )?purchase agreements?\b/g, "agreement");
  const whole = quote.toLowerCase();
  if (BACKLOG.test(near) && !/\b(grants?|funding|invest\w*|equity|loans?)\b/.test(near)) return "contract";
  for (const [kind, re] of KIND_RULES) if (re.test(near)) return kind;
  const d = (detail ?? "").toLowerCase();
  const vetoed = VETO.test(d);
  if (CONTRACT.test(near) && !/\b(grants?|funding)\b/.test(whole)) return "contract";
  if (ROYALTY_PAID.test(near)) return vetoed ? "other" : "purchases";
  if (REVENUE.test(near)) return vetoed ? "other" : "revenue";
  if (PURCHASES.test(near)) return vetoed ? "other" : "purchases";
  return "other";
}

/* ---------------------------------------------------------------- sole source */

const SOLE_NOUN = String.raw`(?:sources?|sourced|suppliers?|supply|suppl(?:ied|ies)|manufacturers?|manufacturing|contract manufacturer|providers?|vendors?|producers?|foundry|fabricators?|fabs?|licensors?|distributors? (?:of|for) (?:our|the)|pharmacy)`;
const SOLE = new RegExp(
  [
    // "sole source", "single-source suppliers", "only supplier", "exclusive contract manufacturer", "sole provider of our supply"
    String.raw`(?<!non-)\b(?:sole|single|only|exclusive)[- ](?:[a-z\-]+[- ]){0,3}?${SOLE_NOUN}\b`,
    // "single-sourced", "sole-sourced"
    String.raw`\b(?:sole|single)[- ]sourced\b`,
    // "available only from", "purchase ... exclusively from", "manufactured solely by"
    String.raw`\b(?:available|obtained?|purchased?|buy|bought|sourced?|supplied|manufactured|produced|made|procured?|rely|relies|depend|depends)\b[^.;]{0,40}?\b(?:only|exclusively|solely)\s(?:from|by|on|upon)\b`,
    // "100% of our coal purchases", "all of our requirements for X"
    String.raw`\b100\s?(?:%|percent) of (?:our |its |the )?[a-z'\- ]{0,40}?(?:purchases|supply|requirements|needs)\b`,
    // "dependent upon Honeywell for all of its working capital", "dedicated all of our production to"
    String.raw`\b(?:dependent|reliant|rely|relies|depend|depends) (?:up)?on [^.;]{1,50}? for all of\b`,
    String.raw`\bdedicated\b[^.;]{0,60}\ball of (?:our|its)\b`,
    String.raw`\ball of (?:our|its) (?:requirements|supply|needs) (?:of|for)\b`,
  ].join("|"),
  "i",
);
const NOT_SOLE = new RegExp(
  [
    String.raw`\b(?:not|nor|no longer|neither|never)\s(?:be\s|been\s|currently\s|the\s|a\s|our\s|an\s)*(?:sole|single|only|exclusive)\b`,
    String.raw`\bnon-?exclusive\b`,
    String.raw`\bone of (?:several|many|multiple|a number of|our|the)\b`,
    String.raw`\b(?:multiple|several|alternative|alternate|second|other|dual)[- ](?:sources?|suppliers?|vendors?|manufacturers?)\b`,
    String.raw`\bno (?:single|sole)[- ]?(?:source|supplier|vendor)s?\b`,
    String.raw`\bnone of [^.;]{0,60}\b(?:is|are) (?:an? |our )?(?:sole|single)\b`,
    String.raw`\bnot (?:rely|relying|depend|depending|dependent|reliant)\w* (?:up)?on [^.;]{0,40}(?:sole|single|only)\b`,
    String.raw`\bnot (?:dependent|reliant) (?:on|upon) (?:any )?(?:single|one|sole)\b`,
    String.raw`\b(?:previously|formerly|historically|was our [a-z ]{0,20}until)\b`,
  ].join("|"),
  "i",
);
/** The filer is the source ("we are the sole supplier of displays to Apple"): that makes the counterparty a customer, not a sole source. */
const FILER_IS_SOURCE = /\b(?:we|the company|the registrant)\s+(?:are|is|were|was|have been|has been|became|remain|remains|act as|serve as)\s+(?:the |its |their |an? |(?:the )?[a-z0-9&.-]+'s )?(?:sole|single|only|exclusive)\b/i;
/** Breaks between clauses that each make their own claim ("..., and in some cases a single supplier", "...; however, ..."). */
const CLAUSE_SPLIT = /;\s|\.\s(?=[A-Z])|,\s+(?:and|but|while|whereas|though|although|however)\b|\s+(?:but|whereas|though|although)\s/;

/**
 * Does the sentence say sole, single, only or exclusive source or supplier (and not deny it)? With `counterparty`, the
 * wording must sit in a clause that names it (or points to it: "it", "which", "this supplier"), and the counterparty's own
 * name is masked first, so "Single Source Inc." is not sole-source wording.
 */
export function soleSourceInQuote(quote: string, counterparty?: string | null): boolean {
  let q = normText(quote);
  if (counterparty?.trim()) {
    const cp = normText(counterparty).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    q = q.replace(new RegExp(cp, "g"), "the counterparty");
  }
  if (FILER_IS_SOURCE.test(q)) return false;
  // clause by clause on the original casing (the split needs capitals), compared in normalised text
  const clauses = (counterparty?.trim() ? quote.replace(new RegExp(counterparty.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "the counterparty") : quote).split(CLAUSE_SPLIT);
  for (const raw of clauses) {
    const c = normText(raw);
    const m = SOLE.exec(c);
    if (!m) continue;
    const neg = NOT_SOLE.exec(c);
    // a denial counts only inside the same clause, before the wording or overlapping it
    if (neg && neg.index <= m.index + m[0].length) continue;
    if (counterparty?.trim() && !(c.includes("the counterparty") || namesParty(raw, counterparty) || /\b(?:it|they|which|who|this (?:supplier|vendor|manufacturer|company|partner)|such (?:supplier|vendor|manufacturer))\b/.test(c))) continue;
    return true;
  }
  return false;
}

/* ---------------------------------------------------------------- regions */

/** Spellings of a country that `statedCountries` does not read on its own ("U.S." for the United States). */
const SHORT: Record<string, RegExp> = {
  "United States": /(?:^|[^a-z.])(?:u\.s\.|u\.s\.a\.|united states)(?:[^a-z]|$)/i,
  "United Kingdom": /(?:^|[^a-z.])(?:u\.k\.|united kingdom)(?:[^a-z]|$)/i,
  China: /(?:^|[^a-z])(?:prc|people's republic of china|mainland china)(?:[^a-z]|$)/i,
};

/** Words that turn a place into the name of an organisation ("Bank of China", "Air China", "China Mobile", "Japan Tobacco"). */
// utility names ("Georgia Power", "Indiana Electric") are left alone: a utility is named for the area it serves, so the place is a stated region
const ORG_AFTER = String.raw`(?:Mobile|Telecom|Unicom|Tobacco|Steel|Semiconductor|Airlines?|Airways|Railways?|Bank|Life|Insurance|Petroleum|Oil|Motors?|Pharmaceuticals?|Holdings|Telephone|Shipbuilding|Construction)`;
const ORG_BEFORE = String.raw`(?:Bank of|Air|Banco de|Bank of the)`;

/** The sentence with organisation names blanked: the counterparty's own name, and place names used inside a company name. */
export function maskOrgNames(quote: string, counterparty?: string | null): string {
  let q = quote;
  if (counterparty?.trim()) q = q.replace(new RegExp(counterparty.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), (m) => "#".repeat(m.length));
  q = q.replace(new RegExp(String.raw`\b${ORG_BEFORE}\s+(?:[A-Z][a-z]+\s?){1,2}`, "g"), (m) => "#".repeat(m.length));
  q = q.replace(new RegExp(String.raw`\b(?:[A-Z][a-z]+\s){1,3}${ORG_AFTER}\b`, "g"), (m) => "#".repeat(m.length));
  return q;
}

/** Governments, agencies and places: their name is where they are, so it is not masked. */
const PUBLIC_BODY = /\b(?:government|federal|state|states|commonwealth|republic|kingdom|ministry|department|agency|centers? for|administration|city|county|village|town|municipal\w*|province|provincial|army|navy|air force|space force|command|authority|local|board|commission|council|tribe|nation)\b|^u\.s\.\s/i;

/**
 * Regions the sentence itself names, in stored order. Uses `statedCountries` (the globe's own test, so a kept region is a
 * region the globe would also accept) and adds the abbreviations it does not read: "U.S.", "U.K.", "PRC". A place that is
 * only part of a company's name ("Bank of China", the counterparty's own name) is not a stated region.
 */
export function regionsInQuote(quote: string, regions: string[] | null | undefined, counterparty?: string | null): string[] {
  const place = !counterparty || PUBLIC_BODY.test(counterparty) || (regions ?? []).some((r) => normText(r ?? "") === normText(counterparty));
  quote = maskOrgNames(quote, place ? null : counterparty);
  const out: string[] = [];
  for (const raw of regions ?? []) {
    const r = (raw ?? "").trim();
    if (!r || out.includes(r)) continue;
    // "global" says worldwide as plainly as "worldwide" does
    const global = /^(worldwide|global(?:ly)?|world)$/i.test(r) && /\b(worldwide|global(?:ly)?|world-?wide|throughout the world|around the world)\b/i.test(quote);
    const named = global || statedCountries([{ quote, regions: [r] } as RiskLink]).length > 0;
    const short = Object.entries(SHORT).some(([c, re]) => normText(c) === normText(r) || (c === "United States" && /^(u\.?s\.?a?\.?|usa|america)$/i.test(r)) ? re.test(quote) : false);
    if (named || short) out.push(r);
  }
  return out;
}

/* ---------------------------------------------------------------- what kind of link it is */

export type LinkNature = "trade" | "financial" | "corporate" | "regulatory" | "unknown";

const CORPORATE = /\b((?:acquired|acquire|acquires)(?! (?:an? |the |exclusive |global |worldwide |certain )*(?:rights|licen[cs]e agreements?))|acquisition (?:of|from)(?![^.;]{0,60}\bby\b)|(?:completed|announced|closed) (?:the|its|our) (?:acquisition|sale|divestiture|merger)|merger|merge with|divest\w*|spin-?off|(?:sold|sell|sale of|agreement to sell) (?:our|its|the|all|certain|a|an)\b[^.;]{0,60}\b(?:business|division|segment|subsidiar\w*|interest|stake|unit|assets|operations|portfolio)|purchase agreement to (?:sell|acquire)|equity and asset purchase|asset purchase agreement|(?:purchased?|bought|acquired?)\b[^.;$]{0,60}?\b(?:assets|plants?|refiner(?:y|ies)|(?<!course of )business(?:es)?|portfolios?|pipelines?|terminals?|mines?|hospitals?|divisions?|subsidiar(?:y|ies))\b(?![^.;]{0,30}\b(?:services|products|supplies|equipment)\b))\b/i;
const FINANCIAL = /\b(lenders?|administrative agent|collateral agent|credit (?:facilit\w*|agreements?)|line of credit|(?:term|bridge|revolving) loans?|loan agreements?|borrow\w*|indentures?|trustee|underwrit\w*|senior notes|notes due|discount window|preferred stock|equity (?:interest|investment|stake)|purchase of (?:shares|common stock|preferred stock)|invest(?:ed|ment)s? in (?:the company\b|us\b|our (?:company|common|preferred|stock|shares)\b|(?:the )?(?:shares|stock|equity|preferred|common|notes|units|bonds|debentures|warrants|partnership|fund|limited partnership)\b|an? (?:\d+(?:\.\d+)?\s?%|minority|majority|equity|preferred)\b)|\b(?:lent|lends|loaned)\b|(?:minority|equity method|equity-method|strategic) investments?|convertible notes?|stock purchase agreement|limited partner\w*|general partner|warrants?|financing capacity|rate relief bonds|bonds?|(?:sale|sell|sold|factor\w*|securitiz\w*)\b[^.;]{0,30}?\b(?:of )?(?:certain )?(?:accounts )?receivables?|accounts receivable (?:purchase|sale|facilit\w*))\b/i;
const REG_ACTION = /\b(regulat\w*|approv\w*|permits?|licen[sc]es? (?:issued|granted) by|issued by the|rate (?:case|order|base)|tariffs?|orders? of the|oversight|supervis\w*|inspect\w*|warning letters?|consent decree|subject to expiration|recognized as a regulatory|regulatory (?:asset|liability))\b/i;
const REGULATOR = /\b(commission|fda|food and drug administration|regulators?|regulatory authorit\w*|fcc|ferc|nrc|epa|sec\b|securities and exchange|federal reserve|fdic|occ|comptroller|cfpb|finra|bpu|psc|puc|public (?:utilit\w*|service) commission|ministry|nhtsa|faa|ema\b|medicines agency|cms\b)\b/i;
const TRADE = /\b(suppl\w*|purchas\w*|customers?|sales?|sells?|sold|manufactur\w*|distribut\w*|licens\w*|collaborat\w*|partner\w*|joint venture|contracts?|vendors?|provid\w*|services?|products?|revenues?|orders?|agreements?|programs?|deliver\w*|outsourc\w*|foundry|wafers?|leases?|royalt\w*|develop\w*|commerciali[sz]\w*|tenants?|alliances?|joint ventures?|jvs?|joint business|rel(?:y|ies|ied)|depend\w*|operat\w*|audit\w*|brokers?|brokerage|premiums|fabrication|clearing|accounted for|marketing|channels?|carriers?|co-?brand\w*|platforms?|co-?engineer\w*|engineered with)\b/i;

/**
 * What the sentence says the link is: a trading relationship, a financial one (lender, credit facility, investment),
 * a corporate transaction (acquisition, divestiture), a regulator, or `unknown`. `counterparty`, when given, helps tell a
 * regulator from a government customer.
 */
export function linkNature(quote: string, detail: string, relation: Relation | string, counterparty?: string): LinkNature {
  const q = normText(quote);
  const cp = normText(counterparty ?? "");
  if (CORPORATE.test(q)) return "corporate";
  // a regulator is a counterparty that is itself an agency; a manufacturer "approved by the FDA" is still a supplier
  if (REGULATOR.test(cp) && REG_ACTION.test(q) && !/\b(sales to|revenues? from|purchases? from|contracts? with|manufactur\w* (?:for|of)|suppl(?:y|ies|ied) (?:us|our)|for us)\b/.test(q)) return "regulatory";
  if (FINANCIAL.test(q) && !/\b(joint venture|collaborat\w*|supply agreement|license agreement|alliance)\b/.test(q)) return "financial";
  if (FINANCIAL.test(cp) || /\b(bank|lending|capital partners|credit)\b/.test(cp) && /\b(loan|credit|borrow|financ)\w*/.test(q)) return "financial";
  if (TRADE.test(q)) return "trade";
  if (relation === "competitor" && /\bcompet\w*/.test(q)) return "trade";
  if (TRADE.test(normText(detail ?? "")) && q.length > 0) return "unknown";
  return "unknown";
}

/* ---------------------------------------------------------------- the trusted view of a link */

export interface ClaimLink {
  quote: string;
  detail?: string | null;
  relation: Relation | string;
  counterparty?: string;
  amount_usd?: number | null;
  single_source?: boolean | null;
  regions?: string[] | null;
}

export interface TrustedClaims {
  /** the stored amount, kept only when the sentence states it as this counterparty's figure (`checkPartyAmount`) */
  amount_usd: number | null;
  /** the kept amount when it is money passing between the two parties for goods or services; else null */
  flow_usd: number | null;
  /** what the kept amount is; null when no amount is kept */
  amount_kind: AmountKind | null;
  /** sole, single, only or exclusive source wording in the sentence */
  sole_source: boolean;
  /** the model flagged a dependency but the sentence does not say sole source: shown as a dependency, not single source */
  dependency: boolean;
  /** same as `sole_source`, so code reading `single_source` sees only verified flags */
  single_source: boolean;
  /** stored regions the sentence names */
  regions: string[];
  nature: LinkNature;
  /** fields whose stored value was removed, for the source panel ("amount not stated in the sentence") */
  dropped: ("amount_usd" | "single_source" | "regions")[];
}

/** The link with only the claims its own sentence bears out. Never adds a value; only removes or labels. */
export function trustLink<T extends ClaimLink>(link: T): Omit<T, keyof TrustedClaims> & TrustedClaims {
  const quote = link.quote ?? "";
  const dropped: TrustedClaims["dropped"] = [];
  const stated = link.amount_usd != null && checkPartyAmount(quote, link.amount_usd, link.counterparty).ok;
  if (link.amount_usd != null && !stated) dropped.push("amount_usd");
  const amount = stated ? (link.amount_usd as number) : null;
  const kind = amount != null ? amountKind(quote, link.detail ?? "", amount, link.counterparty ?? "") : null;
  // a customer is never the filer's source: on a customer link the wording describes the filer supplying it
  const sole = !!link.single_source && link.relation !== "customer" && link.relation !== "competitor" && soleSourceInQuote(quote, link.counterparty);
  if (link.single_source && !sole) dropped.push("single_source");
  const regions = regionsInQuote(quote, link.regions, link.counterparty);
  if ((link.regions ?? []).filter((r) => r && r.trim()).length !== regions.length) dropped.push("regions");
  const nature = linkNature(quote, link.detail ?? "", link.relation, link.counterparty);
  return {
    ...link,
    amount_usd: amount,
    flow_usd: amount != null && isFlowKind(kind) && nature === "trade" ? amount : null,
    amount_kind: kind,
    sole_source: sole,
    dependency: !!link.single_source && !sole,
    single_source: sole,
    regions,
    nature,
    dropped,
  };
}

export interface AuditRow extends ClaimLink {
  id: string;
  is_current?: boolean | null;
}
export interface ClaimAudit {
  rows: number;
  amounts: { stored: number; kept: number; flows: number; dropped: Record<string, number>; byKind: Record<string, number> };
  soleSource: { flagged: number; kept: number; dependency: number };
  regions: { links: number; pruned: number; entriesStored: number; entriesKept: number };
  nature: Record<LinkNature, number>;
  /** a few rows per kind of change, for reading by eye */
  samples: { id: string; change: string }[];
}

/**
 * What read-time verification (`trustLink`) does to stored rows: counted, never written. Stored rows keep what the model
 * returned, so this is a report on the rules, and running it twice gives the same answer. Used by scripts/supply-revalidate.ts.
 */
export function auditClaims(rows: AuditRow[], samplesPerChange = 5): ClaimAudit {
  const a: ClaimAudit = {
    rows: rows.length,
    amounts: { stored: 0, kept: 0, flows: 0, dropped: {}, byKind: {} },
    soleSource: { flagged: 0, kept: 0, dependency: 0 },
    regions: { links: 0, pruned: 0, entriesStored: 0, entriesKept: 0 },
    nature: { trade: 0, financial: 0, corporate: 0, regulatory: 0, unknown: 0 },
    samples: [],
  };
  const shown = new Map<string, number>();
  const sample = (id: string, change: string) => {
    const k = change.split(":")[0];
    if ((shown.get(k) ?? 0) >= samplesPerChange) return;
    shown.set(k, (shown.get(k) ?? 0) + 1);
    a.samples.push({ id, change });
  };
  for (const r of rows) {
    const t = trustLink(r);
    a.nature[t.nature]++;
    if (r.amount_usd != null) {
      a.amounts.stored++;
      if (t.amount_usd != null) {
        a.amounts.kept++;
        a.amounts.byKind[t.amount_kind as string] = (a.amounts.byKind[t.amount_kind as string] ?? 0) + 1;
        if (t.flow_usd != null) a.amounts.flows++;
      } else {
        const why = checkPartyAmount(r.quote ?? "", r.amount_usd, r.counterparty).ok ? "kept" : (checkPartyAmount(r.quote ?? "", r.amount_usd, r.counterparty) as { why: string }).why;
        a.amounts.dropped[why] = (a.amounts.dropped[why] ?? 0) + 1;
        sample(r.id, `amount ${why}: ${r.amount_usd}`);
      }
    }
    if (r.single_source) {
      a.soleSource.flagged++;
      if (t.sole_source) a.soleSource.kept++;
      else {
        a.soleSource.dependency++;
        sample(r.id, "single_source: shown as a stated dependency");
      }
    }
    const stored = (r.regions ?? []).filter((x) => x && x.trim());
    if (stored.length) {
      a.regions.links++;
      a.regions.entriesStored += stored.length;
      a.regions.entriesKept += t.regions.length;
      if (t.regions.length !== stored.length) {
        a.regions.pruned++;
        sample(r.id, `regions: ${stored.join(";")} -> ${t.regions.join(";") || "none"}`);
      }
    }
  }
  return a;
}
