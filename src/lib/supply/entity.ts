// Names of counterparties: text normalisation for verbatim checks and one stable key per company however a filing
// spells it. Kept apart from core.ts so identity.ts can use it without an import cycle. Pure, no browser/Node APIs.

/** Collapse whitespace, unify quotes/dashes, lowercase — for verbatim checks. */
export function normText(s: string): string {
  return s
    .replace(/[\u2018\u2019\u201b]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Known alias spellings → one canonical counterparty key, so "TSMC" and "Taiwan Semiconductor" merge. */
const ALIASES: [RegExp, string][] = [
  [/taiwan semiconductor|\btsmc\b/, "TSM"],
  [/samsung/, "SSNLF"],
  [/sk hynix|hynix/, "HXSCL"],
  [/foxconn|hon hai/, "HNHPF"],
  [/amazon web services|\baws\b/, "AMZN"],
  [/google cloud|\bgoogle\b/, "GOOGL"],
  [/microsoft azure|\bazure\b/, "MSFT"],
];

/** Stable identity for a counterparty: its ticker, a known alias, or its normalised name minus corporate suffixes. */
export function entityKey(name: string, ticker: string | null): string {
  if (ticker) return ticker.toUpperCase();
  const n = normText(name);
  for (const [re, k] of ALIASES) if (re.test(n)) return k;
  return n.replace(/[.,]/g, "").replace(/\b(inc|corp|corporation|co|ltd|limited|plc|llc|lp|ag|sa|nv|holdings?|group|company)\b/g, "").replace(/\s+/g, " ").trim();
}

