// Matches a customer/supplier name tagged in XBRL ("Amazon", "Walmart Inc.") to a covered ticker.
// Exact normalised name first, then the name followed by more words ("Walmart Stores" → Walmart),
// then a one-word label that starts exactly one covered company's name ("Amazon" → Amazon.com).
// Anonymous labels ("Customer A", "Two customers", "Top ten") never match. Pure.

const SUFFIX = /\b(inc|incorporated|incorporation|corp|corporation|corporate|co|company|ltd|limited|plc|holdings?|group|the|llc|lp|sa|nv|ag|se|pte)\b/g;

export function normCompany(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[“”"][^“”"]*[“”"]/g, " ")
    .replace(/\bmember$/, "")
    .replace(/\.com\b/g, "")
    .replace(/&/g, " and ")
    .replace(/[.,'’()]/g, "")
    .replace(/-/g, " ")
    .replace(SUFFIX, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ANON = /^(customer|customers|client|distributor|partner|payor|payer|vendor|supplier|wholesaler|retailer|reseller|licensee|collaborator)\b|^(one|two|three|four|five|six|seven|eight|nine|ten|\d+) |^(largest|second|third|top|major|significant|other|others|all|minimum|maximum|single)\b|\bcustomers?\b/;
// Words that name a market, not a company, even when a covered company's name starts with them.
const GENERIC = new Set(
  (
    "general american united national international first global us u s federal state medicare medicaid government us government u s government " +
    "commercial medical service services retail wholesale industrial residential consumer enterprise domestic foreign military defense healthcare health " +
    "energy utility utilities airline airlines automotive auto oem oems hospital hospitals pharmacy insurance financial technology software hardware carrier " +
    "carriers operator operators dealer dealers network mobile wireless cable media digital north south east west central pacific atlantic southern northern " +
    "western eastern public private institutional affiliate affiliates related related party related parties"
  ).split(" "),
);
// Extra words allowed after a covered company's full name ("Walmart Stores", "Lowe's Companies and affiliates").
const TAIL = new Set("stores store companies affiliates affiliated subsidiaries subcontractors and its entities worldwide us usa america north international global services web".split(" "));
// Words after a company's name that make it a different company (a bottler, a partnership, a foundation).
const OTHER = /\b(partners|bottlers?|bottling|consolidated|europacific|hellenic|femsa|foundation|employees|union|authority|trust)\b/;

export function companyMatcher(universe: { ticker: string; name: string }[]) {
  const names = universe
    .map((u) => ({ t: u.ticker, n: normCompany(u.name) }))
    .filter((x) => x.n.length >= 3)
    .sort((a, b) => b.n.length - a.n.length);
  return (label: string, self: string): string | null => {
    const l = normCompany(label);
    if (!l || l.length < 3 || ANON.test(l) || GENERIC.has(l)) return null;
    const exact = names.find((x) => x.t !== self && x.n === l);
    if (exact) return exact.t;
    const longer = names.find((x) => {
      if (x.t === self || !l.startsWith(`${x.n} `) || GENERIC.has(x.n)) return false;
      const tail = l.slice(x.n.length + 1);
      if (OTHER.test(tail)) return false;
      // "Expedia and Booking": two companies in one label
      const after = tail.split(/\band\b/).slice(1).map((w) => w.trim()).filter(Boolean);
      if (after.some((w) => names.some((y) => y.t !== x.t && (w === y.n || w.startsWith(`${y.n} `))))) return false;
      // a one-word name ("alamo") may only be followed by corporate words; longer names are distinctive
      return x.n.includes(" ") || x.n.length >= 6 || tail.split(" ").every((w) => TAIL.has(w));
    });
    if (longer) return longer.t;
    if (!l.includes(" ") && l.length >= 4) {
      const starts = names.filter((x) => x.t !== self && x.n.startsWith(`${l} `));
      if (starts.length === 1) return starts[0].t;
    }
    return null;
  };
}
