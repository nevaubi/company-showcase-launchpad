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
}

// number, then an optional unit word glued or spaced ("$1.2 billion", "$5M", "$1.2bn", "$1,018 million")
const NUM = /(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?:[ -]?(trillion|billion|million|thousand|bn|tn|mm|mn|mil\.?)\b|(k|m|b|t)\b)?/gi;
const FOREIGN_BEFORE = /(?:[€£¥₹]\s?|\b(?:eur|euros?|gbp|jpy|yen|rmb|cny|renminbi|chf|cad|aud|inr|krw|sek|nok|dkk|brl|mxn|hkd|twd|sgd)\s?|(?:^|[^a-z])(?:nt|c|a|hk|r|s|mx|nz|ca|au)\$\s?)$/i;
const FOREIGN_AFTER = /^\s?(?:euros?|pounds? sterling|yen|rmb|renminbi|yuan|swiss francs|francs|won|rupees|reais|pesos)\b/i;
const USD_BEFORE = /(?:^|[^a-z])(?:u\.?s\.?\s?\$|us\$|usd\s?|\$)\s?$/i;
const USD_AFTER = /^\s?(?:u\.s\. )?(?:dollars|usd)\b/i;
const CONNECT = /^\s*(?:to|and|or|through|-|–)\s*(?:approximately |about )?$/i;

/** The scale a sentence gives its unmarked figures: "(in millions)", "$ in thousands", "dollars in billions". */
export function contextScale(quote: string): { scale: number; dollars: boolean } | null {
  const m = /\(?\s*(\$|dollars?|u\.s\. dollars)?\s*(?:amounts? )?in (thousands|millions|billions)( of (?:u\.s\. )?dollars)?\b/i.exec(quote);
  if (!m) return null;
  const scale = m[2].toLowerCase() === "thousands" ? 1e3 : m[2].toLowerCase() === "millions" ? 1e6 : 1e9;
  return { scale, dollars: !!(m[1] || m[3]) };
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
    const foreign = FOREIGN_BEFORE.test(before) || FOREIGN_AFTER.test(after);
    const usd = !foreign && (USD_BEFORE.test(before) || USD_AFTER.test(after));
    if (glued && !usd) {
      out.push({ value: raw, raw, at: m.index, len: m[1].length, usd, foreign, scale: "none" });
      continue;
    }
    const unit = unitWord ? UNIT[unitWord] : undefined;
    out.push({ value: unit ? raw * unit : raw, raw, at: m.index, len: m[0].length, usd, foreign, scale: unit ? "unit" : "none" });
  }
  // ranges: "$1.0 to $1.2 billion", "$1-2 billion", "between $5 and $10 million" share the later unit and currency
  for (let i = out.length - 2; i >= 0; i--) {
    const a = out[i], b = out[i + 1];
    const gap = quote.slice(a.at + a.len, b.at).replace(/\$\s?$/, "");
    if (!CONNECT.test(gap)) continue;
    if (a.scale === "none" && b.scale === "unit" && (a.usd || b.usd)) {
      const unit = b.value / b.raw;
      a.value = a.raw * unit;
      a.scale = "unit";
    }
    if (a.usd && !b.usd && !b.foreign) b.usd = true;
    if (b.usd && !a.usd && !a.foreign) a.usd = true;
  }
  // "(in millions)": a dollar figure written without a unit takes the sentence's scale; a bare figure only when the note says dollars
  if (ctx) for (const t of out) if (t.scale === "none" && !t.foreign && (t.usd || ctx.dollars)) {
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

/** True when the sentence states this dollar amount (see `checkAmount`). */
export function amountInQuote(quote: string, amount: number | null | undefined): boolean {
  return checkAmount(quote, amount).ok;
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

/** Ordered: the first family whose wording sits near the figure decides. Non-flow families come first, so a doubt never becomes a flow. */
const KIND_RULES: [Exclude<AmountKind, "revenue" | "purchases" | "contract">, RegExp][] = [
  ["settlement", /\b(settle(?:d|ment|ments)?|judgm?ents?|damages|arbitra\w*|verdict|litigation|lawsuits?|penalt(?:y|ies)|fines?|class action)\b/],
  ["guarantee", /\b(guarant\w*|letters? of credit|surety|indemnif\w*|collateral|pledged?)\b/],
  ["financing", /\b(loans?|credit (?:facilit\w*|agreements?|lines?)|line of credit|revolv\w*|borrow\w*|lenders?|financing|indebtedness|commercial paper|debentures?|notes due|senior notes|(?:term|bridge) loan|bonds?|securitiz\w*|discount window|advances?|debt)\b/],
  ["investment", /\b(invest\w*|equity|stake|ownership|interests? in|acqui\w*|divest\w*|purchase price|enterprise value|merger|(?:cash |purchase |merger |total |aggregate )consideration|consideration (?:of|paid|received|totaling)|tender offer|spin-?off|capital (?:contributions?|commitments?|calls?)|contribut\w* (?:capital|cash)|contributed \$[^.;]{0,40}\bto|limited partner|general partner|preferred stock|common stock|shares of|stock purchase|(?:sale|sell|sold) (?:of )?(?:our|its|the|all|certain|a|an)\b[^$]{0,60}\b(?:business|division|segment|subsidiar\w*|interest|stake|unit|assets|operations|licenses|rights|facilit\w*)|proceeds|distributions? (?:from|received|of)|dividends?|returns? of capital|valuation)\b/],
  ["balance", /\b(receivables?|payables?|owed|owes|outstanding balance|amounts? due|due (?:from|to)|recoverables?|deferred revenue|accrued|unbilled|prepa(?:id|yments?)|deposits?)\b/],
  ["commitment", /\b(commit\w*|obligat\w*|minimum (?:purchase|volume)s?|take-or-pay|non-?cancell?able|(?:agreed|required|obligated) to (?:purchase|buy|pay)|will (?:purchase|buy|pay)|purchase requirements?)\b/],
  ["other", /\b(grants?|funding|fund(?:s|ed)? (?:the|a|our)|subsid\w*|incentives?|tax credits?|award(?:ed)?\b[^.;]{0,40}\bto (?:support|fund|help|build)|milestones?|potential|eligible|up to|programs? (?:size|budget)|market|capacity|fair value|gains?|loss(?:es)?|impairment|write-?(?:off|down)|valued at|value of|aggregate (?:principal|amount)|plan(?:ned|s)? to (?:invest|spend)|cap(?:ped)?\b|limit)\b/],
];
const CONTRACT = /\b(contracts?|task orders?|delivery orders?|purchase orders?|orders?|awards?|awarded|backlog|book(?:ed|ings?)|idiq|agreements? (?:valued|worth)|worth|to (?:provide|supply|deliver|build|manufacture)|remaining performance obligations?|rpos?)\b/;
/** Order books are stated as obligations; they are contract value between the parties, not a purchase commitment. */
const BACKLOG = /\b(backlog|book(?:ed|ings?)|remaining performance obligations?|rpos?)\b/;
const ROYALTY_PAID = /\broyalt(?:y|ies) (?:paid|payable|owed|expense)|\bpaid [^.;]{0,30}\broyalt/;
const REVENUE = /\b(royalt(?:y|ies)|license fees?|licen[cs]e payments?|up-?front(?:,? non-?refundable)? payments?|royalt(?:y|ies) (?:revenue|income|received|paid to us)|revenues?|premiums (?:earned|written)|net sales|sales (?:to|of|from)|total sales|sold to|billings?|billed|recogni[sz]ed|earned|income from|received from|paid (?:us|to us)|fees? (?:from|earned))\b/;
const PURCHASES = /\b(purchased?|purchases|bought|paid (?:to )?(?!us\b)|payments? (?:to|made to)|spent|spend|procured|cost of|costs (?:of|paid)|fees? (?:paid|to)|expenses? (?:with|paid|to))\b/;

/** Model-written detail that marks the figure as plainly not a trade payment (it can only take a flow away). */
const VETO = /\b(settle\w*|judgm?ent|loans?|credit facilit\w*|borrow\w*|guarant\w*|equity (?:stake|interest|investment)|acqui\w*|divest\w*)\b/;

/** The stretch of the sentence that speaks about the figure: from the previous clause break to the next. */
function around(quote: string, at: number, len: number): string {
  const lo = Math.max(0, at - 150), hi = Math.min(quote.length, at + len + 90);
  let s = quote.slice(lo, hi);
  const pre = at - lo;
  // cut at clause breaks that do not belong to the figure ("; " or ". " between sentences)
  const left = Math.max(s.lastIndexOf("; ", pre), s.lastIndexOf(". ", pre));
  if (left > 0) s = s.slice(left + 2);
  return s.toLowerCase();
}

/**
 * What a verified amount is, read from the words around it in the sentence. `detail` (written by the model) may only
 * push a figure away from being a flow, never towards one. Unverified amounts are `other`.
 */
export function amountKind(quote: string, detail: string, amount?: number | null): AmountKind {
  const check = amount != null ? checkAmount(quote, amount) : null;
  const tok = check?.ok ? check.token : moneyTokens(quote).find((t) => t.usd);
  const near = tok ? around(quote, tok.at, tok.len) : quote.toLowerCase();
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
    String.raw`\bno single (?:source|supplier|vendor)\b`,
    String.raw`\bnot (?:dependent|reliant) (?:on|upon) (?:any )?(?:single|one|sole)\b`,
  ].join("|"),
  "i",
);

/** Does the sentence say sole, single, only or exclusive source or supplier (and not deny it)? */
export function soleSourceInQuote(quote: string): boolean {
  const q = normText(quote);
  const m = SOLE.exec(q);
  if (!m) return false;
  // a denial counts only when it speaks about the same wording, not about a later clause ("however, we are not required to purchase exclusively")
  const neg = NOT_SOLE.exec(q);
  if (!neg) return true;
  return !(neg.index <= m.index + m[0].length && neg.index + neg[0].length >= m.index - 30);
}

/* ---------------------------------------------------------------- regions */

/** Spellings of a country that `statedCountries` does not read on its own ("U.S." for the United States). */
const SHORT: Record<string, RegExp> = {
  "United States": /(?:^|[^a-z.])(?:u\.s\.|u\.s\.a\.|united states)(?:[^a-z]|$)/i,
  "United Kingdom": /(?:^|[^a-z.])(?:u\.k\.|united kingdom)(?:[^a-z]|$)/i,
  China: /(?:^|[^a-z])(?:prc|people's republic of china|mainland china)(?:[^a-z]|$)/i,
};

/**
 * Regions the sentence itself names, in stored order. Uses `statedCountries` (the globe's own test, so a kept region is a
 * region the globe would also accept) and adds the abbreviations it does not read: "U.S.", "U.K.", "PRC".
 */
export function regionsInQuote(quote: string, regions: string[] | null | undefined): string[] {
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

const CORPORATE = /\b((?:acquired|acquire|acquires)(?! (?:an? |the |exclusive |global |worldwide |certain )*(?:rights|licen[cs]e agreements?))|acquisition (?:of|from)(?![^.;]{0,60}\bby\b)|(?:completed|announced|closed) (?:the|its|our) (?:acquisition|sale|divestiture|merger)|merger|merge with|divest\w*|spin-?off|(?:sold|sell|sale of|agreement to sell) (?:our|its|the|all|certain|a|an)\b[^.;]{0,60}\b(?:business|division|segment|subsidiar\w*|interest|stake|unit|assets|operations|portfolio)|purchase agreement to (?:sell|acquire)|equity and asset purchase|asset purchase agreement)\b/i;
const FINANCIAL = /\b(lenders?|administrative agent|collateral agent|credit (?:facilit\w*|agreements?)|line of credit|(?:term|bridge|revolving) loans?|loan agreements?|borrow\w*|indentures?|trustee|underwrit\w*|senior notes|notes due|discount window|preferred stock|equity (?:interest|investment|stake)|invest(?:ed|ment) in|stock purchase agreement|limited partner\w*|general partner|warrants?|financing capacity|rate relief bonds|bonds?|(?:sale|sell|sold|factor\w*|securitiz\w*)\b[^.;]{0,30}?\b(?:of )?(?:certain )?(?:accounts )?receivables?|accounts receivable (?:purchase|sale|facilit\w*))\b/i;
const REG_ACTION = /\b(regulat\w*|approv\w*|permits?|licen[sc]es? (?:issued|granted) by|issued by the|rate (?:case|order|base)|tariffs?|orders? of the|oversight|supervis\w*|inspect\w*|warning letters?|consent decree|subject to expiration|recognized as a regulatory|regulatory (?:asset|liability))\b/i;
const REGULATOR = /\b(commission|fda|food and drug administration|regulators?|regulatory authorit\w*|fcc|ferc|nrc|epa|sec\b|securities and exchange|federal reserve|fdic|occ|comptroller|cfpb|finra|bpu|psc|puc|public (?:utilit\w*|service) commission|ministry|nhtsa|faa|ema\b|medicines agency|cms\b)\b/i;
const TRADE = /\b(suppl\w*|purchas\w*|customers?|sales?|sells?|sold|manufactur\w*|distribut\w*|licens\w*|collaborat\w*|partner\w*|joint venture|contracts?|vendors?|provid\w*|services?|products?|revenues?|orders?|agreements?|programs?|deliver\w*|outsourc\w*|foundry|wafers?|leases?|royalt\w*|develop\w*|commerciali[sz]\w*|tenants?|alliances?|joint ventures?|jvs?|joint business|rel(?:y|ies|ied)|depend\w*|operat\w*|audit\w*|brokers?|brokerage|premiums|fabrication|clearing|accounted for|marketing|channels?|carriers?|co-?brand\w*|platforms?)\b/i;

/**
 * What the sentence says the link is: a trading relationship, a financial one (lender, credit facility, investment),
 * a corporate transaction (acquisition, divestiture), a regulator, or `unknown`. `counterparty`, when given, helps tell a
 * regulator from a government customer.
 */
export function linkNature(quote: string, detail: string, relation: Relation | string, counterparty?: string): LinkNature {
  const q = normText(quote);
  const cp = normText(counterparty ?? "");
  if (CORPORATE.test(q)) return "corporate";
  if (REG_ACTION.test(q) && (REGULATOR.test(cp) || REGULATOR.test(q)) && !/\b(sales to|revenues? from|purchases? from|contracts? with)\b/.test(q)) return "regulatory";
  if (FINANCIAL.test(q) && !/\b(joint venture|collaborat\w*|supply agreement|license agreement)\b/.test(q)) return "financial";
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
  /** the stored amount, kept only when the sentence states it */
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
  const stated = link.amount_usd != null && amountInQuote(quote, link.amount_usd);
  if (link.amount_usd != null && !stated) dropped.push("amount_usd");
  const amount = stated ? (link.amount_usd as number) : null;
  const kind = amount != null ? amountKind(quote, link.detail ?? "", amount) : null;
  const sole = !!link.single_source && soleSourceInQuote(quote);
  if (link.single_source && !sole) dropped.push("single_source");
  const regions = regionsInQuote(quote, link.regions);
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

/** Columns to change on a stored row so it keeps only verified claims (used by scripts/supply-revalidate.ts). Empty when nothing changes. */
export function repairPatch(link: ClaimLink): { amount_usd?: null; single_source?: false; regions?: string[] } {
  const t = trustLink(link);
  const patch: { amount_usd?: null; single_source?: false; regions?: string[] } = {};
  if (link.amount_usd != null && t.amount_usd == null) patch.amount_usd = null;
  if (link.single_source && !t.sole_source) patch.single_source = false;
  const before = link.regions ?? [];
  if (before.length !== t.regions.length || before.some((r, i) => r !== t.regions[i])) patch.regions = t.regions;
  return patch;
}

export interface RepairRow extends ClaimLink {
  id: string;
}
export interface RepairPlan {
  rows: number;
  /** rows with at least one change */
  changed: number;
  amountsCleared: number;
  soleSourceCleared: number;
  regionsPruned: number;
  /** one update per distinct set of new values, so a batch writes many rows with one request */
  updates: { set: { amount_usd?: null; single_source?: false; regions?: string[] }; ids: string[] }[];
}

/** The writes that bring stored rows down to their verified claims, grouped by identical change. */
export function planRepairs(rows: RepairRow[]): RepairPlan {
  const groups = new Map<string, { set: RepairPlan["updates"][number]["set"]; ids: string[] }>();
  let changed = 0, amountsCleared = 0, soleSourceCleared = 0, regionsPruned = 0;
  for (const r of rows) {
    const set = repairPatch(r);
    const keys = Object.keys(set);
    if (!keys.length) continue;
    changed++;
    if ("amount_usd" in set) amountsCleared++;
    if ("single_source" in set) soleSourceCleared++;
    if ("regions" in set) regionsPruned++;
    const k = JSON.stringify(set);
    const g = groups.get(k);
    if (g) g.ids.push(r.id);
    else groups.set(k, { set, ids: [r.id] });
  }
  return { rows: rows.length, changed, amountsCleared, soleSourceCleared, regionsPruned, updates: [...groups.values()] };
}
