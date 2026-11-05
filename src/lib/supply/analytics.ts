// Pure analytics for the supply-chain page: country exposure, region shocks, concentration history,
// link freshness and ecosystem baskets. No browser/Node APIs — shared by app and tests.
import { entityKey, HOTSPOTS, linkDollars, type ProLink, type SupplyLink } from "./core";

const ALIAS: Record<string, string> = {
  "u.s.": "United States", us: "United States", usa: "United States", "united states of america": "United States", "u.s.a.": "United States", america: "United States",
  "greater china": "China", prc: "China", "mainland china": "China", "people's republic of china": "China",
  uk: "United Kingdom", "u.k.": "United Kingdom", "great britain": "United Kingdom", britain: "United Kingdom", england: "United Kingdom",
  "republic of korea": "South Korea", korea: "South Korea", "s. korea": "South Korea",
  "the netherlands": "Netherlands", holland: "Netherlands", "czech republic": "Czechia", "russian federation": "Russia",
  "viet nam": "Vietnam", "republic of china": "Taiwan", "hong kong sar": "Hong Kong", "uae": "United Arab Emirates",
};
/** Canonical country name; map/world-atlas spellings and filing spellings meet here. */
export function canonCountry(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim().replace(/\s+/g, " ");
  if (!t) return null;
  return ALIAS[t.toLowerCase()] ?? (t === t.toLowerCase() ? t.replace(/\b\w/g, (c) => c.toUpperCase()) : t);
}
/** Headquarters country of well-known non-U.S. counterparties (public facts), so a link to TSMC counts as a Taiwan tie even when the filing sentence names no country. */
const HQ: [RegExp, string][] = [
  [/taiwan semiconductor|\btsmc\b|hon hai|foxconn|wistron|quanta|pegatron|compal|inventec|mediatek|united microelectronics|\bumc\b|\base\b technology|advanced semiconductor engineering|largan|delta electronics|unimicron|nanya|realtek|asustek|acer\b/, "Taiwan"],
  [/samsung|sk hynix|hynix|\blg\b|lg (energy|display|electronics|chem)|hyundai|\bkia\b|sk on\b|posco/, "South Korea"],
  [/\bsony\b|toyota|panasonic|murata|kioxia|tokyo electron|mitsubishi|hitachi|toshiba|nidec|kyocera|renesas|shin-etsu|sumco|\btdk\b|fujitsu|nintendo|honda|nissan|softbank|takeda|astellas|daiichi|olympus|canon\b|keyence|denso/, "Japan"],
  [/huawei|\bbyd\b|catl|contemporary amperex|alibaba|tencent|baidu|xiaomi|lenovo|\bzte\b|smic|semiconductor manufacturing international|jd\.com|pdd|bytedance|luxshare|goertek|boe technology|haier|midea|cosco|sinopec|petrochina|cnooc/, "China"],
  [/\basml\b|nxp|philips|stellantis|shell\b|heineken|prosus/, "Netherlands"],
  [/infineon|siemens|\bbasf\b|\bsap\b|bosch|zeiss|volkswagen|bmw|mercedes|bayer|merck kgaa|deutsche telekom|continental ag|allianz/, "Germany"],
  [/novo nordisk|maersk|vestas|genmab/, "Denmark"],
  [/nestl|novartis|roche|stmicro|abb\b|ubs\b|logitech|glencore|te connectivity/, "Switzerland"],
  [/teva|check point|mobileye|tower semiconductor|elbit/, "Israel"],
  [/tata\b|infosys|wipro|reliance|hcl tech|dr\. reddy|sun pharma/, "India"],
  [/nokia/, "Finland"], [/ericsson|volvo|spotify/, "Sweden"],
  [/astrazeneca|glaxo|\bgsk\b|unilever|\bbp\b|arm holdings|\barm\b ltd|rolls-royce|bae systems|vodafone|hsbc|barclays|diageo|rio tinto/, "United Kingdom"],
  [/airbus|sanofi|lvmh|totalenergies|schneider|safran|thales|capgemini|danone|kering|l'or[eé]al|dassault/, "France"],
  [/bhp|\bcsl\b/, "Australia"], [/shopify|nutrien|enbridge|\bcn rail|canadian (national|pacific)|celestica|magna\b|teck/, "Canada"],
  [/vale\b|petrobras|embraer/, "Brazil"], [/aramco/, "Saudi Arabia"], [/femsa|cemex|grupo bimbo|walmex/, "Mexico"],
];
export function counterpartyCountry(name: string): string | null {
  const n = name.toLowerCase();
  for (const [re, c] of HQ) if (re.test(n)) return c;
  return null;
}

export const isHotspot = (country: string) => HOTSPOTS.some((h) => country.toLowerCase().includes(h));

export interface SignalLite { ticker: string; kind: string; country: string | null; impact: string; title: string; amount_usd: number | null }

export interface CountryRow {
  country: string;
  hotspot: boolean;
  links: number;
  companies: string[];
  singleSource: number;
  dollars: number;
  facilities: number;
  policy: number;
  risks: number;
  /** links to counterparties headquartered there (no country in the sentence needed) */
  hq: number;
}

/** Every stated tie to each country across links (regions) and verified signals (facility / policy / other). */
export function countryExposure(links: ProLink[], signals: SignalLite[], revenue: Record<string, number | undefined>): CountryRow[] {
  const m = new Map<string, CountryRow & { _c: Set<string> }>();
  const row = (c: string) => {
    let r = m.get(c);
    if (!r) { r = { country: c, hotspot: isHotspot(c), links: 0, companies: [], singleSource: 0, dollars: 0, facilities: 0, policy: 0, risks: 0, hq: 0, _c: new Set() }; m.set(c, r); }
    return r;
  };
  for (const l of links) {
    for (const raw of new Set((l.regions ?? []).map(canonCountry).filter(Boolean) as string[])) {
      const r = row(raw);
      r.links++; r._c.add(l.ticker);
      if (l.single_source) r.singleSource++;
      r.dollars += linkDollars(l, revenue) ?? 0;
    }
    const hq = l.relation !== "competitor" ? counterpartyCountry(l.counterparty) : null;
    if (hq) { const r = row(hq); r.hq++; r._c.add(l.ticker); if (l.single_source) r.singleSource++; }
  }
  for (const s of signals) {
    const c = canonCountry(s.country);
    if (!c) continue;
    const r = row(c);
    r._c.add(s.ticker);
    if (s.kind === "facility") r.facilities++;
    if (s.kind === "policy") r.policy++;
    if (s.impact === "risk") r.risks++;
  }
  return [...m.values()]
    .map(({ _c, ...r }) => ({ ...r, companies: [..._c].sort() }))
    .sort((a, b) => b.links + b.hq + b.facilities + b.policy - (a.links + a.hq + a.facilities + a.policy));
}

export interface RegionHit {
  ticker: string;
  links: number;
  singleSource: number;
  facilities: number;
  policy: number;
  hq: number;
  dollars: number;
  /** 0–100 */
  score: number;
  severity: "high" | "medium" | "low";
  examples: string[];
}

/**
 * Who is hurt if `country` is disrupted (export ban, conflict, tariff): every covered company whose own
 * filing ties a link, facility or policy item to it, or that names a counterparty headquartered there.
 * Score = single-source ties ×25 + stated $ as a share of revenue (×200, capped 40) + facilities ×8 +
 * counterparties headquartered there ×6 + other stated links ×4 + policy flags ×3, capped 100.
 */
export function regionShock(country: string, links: ProLink[], signals: SignalLite[], revenue: Record<string, number | undefined>): RegionHit[] {
  const c = canonCountry(country)!;
  const by = new Map<string, RegionHit>();
  const hit = (t: string) => {
    let h = by.get(t);
    if (!h) { h = { ticker: t, links: 0, singleSource: 0, facilities: 0, policy: 0, hq: 0, dollars: 0, score: 0, severity: "low", examples: [] }; by.set(t, h); }
    return h;
  };
  for (const l of links) {
    const stated = (l.regions ?? []).some((r) => canonCountry(r) === c);
    if (!stated) {
      if (l.relation === "competitor" || counterpartyCountry(l.counterparty) !== c) continue;
      const h = hit(l.ticker);
      h.hq++;
      if (l.single_source) h.singleSource++;
      h.dollars += linkDollars(l, revenue) ?? 0;
      if (h.examples.length < 3) h.examples.push(`${l.relation}: ${l.counterparty}`);
      continue;
    }
    const h = hit(l.ticker);
    h.links++;
    if (l.single_source) h.singleSource++;
    h.dollars += linkDollars(l, revenue) ?? 0;
    if (h.examples.length < 3) h.examples.push(`${l.relation}: ${l.counterparty}`);
  }
  for (const s of signals) {
    if (canonCountry(s.country) !== c) continue;
    const h = hit(s.ticker);
    if (s.kind === "facility") h.facilities++;
    else if (s.kind === "policy") h.policy++;
    if (h.examples.length < 3) h.examples.push(s.title);
  }
  for (const h of by.values()) {
    const rev = revenue[h.ticker];
    const dollarPts = rev && h.dollars ? Math.min(40, (h.dollars / rev) * 200) : 0;
    const other = Math.max(0, h.links - h.singleSource);
    h.score = Math.round(Math.min(100, h.singleSource * 25 + dollarPts + h.facilities * 8 + other * 4 + h.hq * 6 + h.policy * 3));
    h.severity = h.score >= 50 ? "high" : h.score >= 20 ? "medium" : "low";
  }
  return [...by.values()].sort((a, b) => b.score - a.score || a.ticker.localeCompare(b.ticker));
}

export interface ConcPoint { filed: string; [counterparty: string]: number | string }

/** Stated customer revenue shares per annual filing (10-K only), oldest first — one series per named customer. */
export function concentrationHistory(ticker: string, history: SupplyLink[], top = 6): { points: ConcPoint[]; series: string[] } {
  const own = history.filter((l) => l.ticker === ticker && l.form === "10-K" && l.relation === "customer" && l.share_pct != null);
  const names = new Map<string, string>();
  const peak = new Map<string, number>();
  const byFiled = new Map<string, Map<string, number>>();
  for (const l of own) {
    const k = entityKey(l.counterparty, l.counterparty_ticker);
    if (!names.has(k)) names.set(k, l.counterparty);
    peak.set(k, Math.max(peak.get(k) ?? 0, l.share_pct!));
    const f = byFiled.get(l.filed) ?? new Map();
    f.set(k, Math.max(f.get(k) ?? 0, l.share_pct!));
    byFiled.set(l.filed, f);
  }
  const keys = [...peak].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k]) => k);
  const series = keys.map((k) => names.get(k)!);
  const points = [...byFiled].sort((a, b) => a[0].localeCompare(b[0])).map(([filed, f]) => {
    const p: ConcPoint = { filed };
    keys.forEach((k, i) => { if (f.has(k)) p[series[i]] = f.get(k)!; });
    return p;
  });
  return { points, series };
}

export type Freshness = "fresh" | "aging" | "stale";
/** How recently a filing re-stated this link: fresh ≤ 200 days, aging ≤ 400, else stale. */
export function freshness(filed: string, today: string): { days: number; status: Freshness } {
  const days = Math.max(0, Math.round((Date.parse(today) - Date.parse(filed)) / 86400_000));
  return { days, status: days <= 200 ? "fresh" : days <= 400 ? "aging" : "stale" };
}

/** Newest filing date among links that state the same (filer, relation, counterparty) — "last confirmed". */
export function lastConfirmed(l: SupplyLink, history: SupplyLink[]): string {
  const k = `${l.ticker}|${l.relation}|${entityKey(l.counterparty, l.counterparty_ticker)}`;
  return history.reduce((m, h) => (`${h.ticker}|${h.relation}|${entityKey(h.counterparty, h.counterparty_ticker)}` === k && h.filed > m ? h.filed : m), l.filed);
}

export interface BasketMember { ticker: string; ret: number; vol: number; corr: number | null }
export interface Basket { index: { date: string; basket: number; focus: number; spy: number | null }[]; members: BasketMember[]; basketRet: number; focusRet: number; spyRet: number | null; dispersion: number }

/**
 * Equal-weight daily-rebalanced basket of `members` over the last `days` sessions vs the focus and SPY.
 * Index starts at 100. ret = cumulative return; vol = annualised; corr = daily-return correlation with focus.
 */
export function ecosystemBasket(focus: string, members: string[], dates: string[], returns: Record<string, (number | null)[]>, days: number): Basket | null {
  const f = returns[focus];
  const mem = members.filter((t) => t !== focus && returns[t]);
  if (!f || !mem.length) return null;
  const start = Math.max(1, dates.length - days);
  let b = 100, fo = 100, sp = 100;
  const spy = returns["SPY"];
  const index: Basket["index"] = [{ date: dates[start - 1], basket: 100, focus: 100, spy: spy ? 100 : null }];
  for (let i = start; i < dates.length; i++) {
    const rs = mem.map((t) => returns[t][i]).filter((x): x is number => x != null);
    b *= 1 + (rs.length ? rs.reduce((a, x) => a + x, 0) / rs.length : 0);
    fo *= 1 + (f[i] ?? 0);
    if (spy) sp *= 1 + (spy[i] ?? 0);
    index.push({ date: dates[i], basket: b, focus: fo, spy: spy ? sp : null });
  }
  const fr = f.slice(start).map((x) => x ?? 0);
  const rows = mem.map((t) => {
    const r = returns[t].slice(start).map((x) => x ?? 0);
    const ret = r.reduce((a, x) => a * (1 + x), 1) - 1;
    const mean = r.reduce((a, x) => a + x, 0) / r.length;
    const vol = Math.sqrt(r.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, r.length - 1)) * Math.sqrt(252);
    return { ticker: t, ret, vol, corr: pearson(fr, r) };
  }).sort((a, b) => b.ret - a.ret);
  const mr = rows.map((m) => m.ret);
  const mm = mr.reduce((a, x) => a + x, 0) / mr.length;
  return {
    index, members: rows,
    basketRet: b / 100 - 1, focusRet: fo / 100 - 1, spyRet: spy ? sp / 100 - 1 : null,
    dispersion: Math.sqrt(mr.reduce((a, x) => a + (x - mm) ** 2, 0) / mr.length),
  };
}

/** Short name tokens used to spot a company in prose ("Taiwan Semiconductor Manufacturing Co" → ["taiwan semiconductor", "tsmc"]). */
export function nameVariants(name: string, ticker?: string | null): string[] {
  const base = name.toLowerCase().replace(/[.,]/g, "").replace(/\b(inc|corp|corporation|co|ltd|limited|plc|llc|lp|ag|sa|nv|holdings?|group|company|the)\b/g, "").replace(/\s+/g, " ").trim();
  const words = base.split(" ").filter(Boolean);
  const out = new Set<string>([base]);
  if (words.length > 2) out.add(words.slice(0, 2).join(" "));
  if (words[0] && words[0].length >= 5) out.add(words[0]);
  if (/taiwan semiconductor/.test(base)) out.add("tsmc");
  if (ticker && ticker.length >= 3) out.add(ticker.toLowerCase());
  return [...out].filter((v) => v.length >= 3);
}

/** Verbatim sentences (20–400 chars) in `text` that mention both companies. */
export function cooccurringSentences(text: string, a: string[], b: string[], max = 6): string[] {
  const sents = text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z"“(])/);
  const has = (s: string, vs: string[]) => vs.some((v) => new RegExp(`\\b${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(s));
  const out: string[] = [];
  for (const s of sents) {
    const t = s.trim().replace(/^[#>*\-\s]+/, "");
    if (t.length < 20 || t.length > 400 || /\]\(|https?:/.test(t)) continue;
    if (has(t, a) && has(t, b) && !out.includes(t)) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

export function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 10) return null;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n;
  let c = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) { c += (a[i] - ma) * (b[i] - mb); va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2; }
  return va && vb ? c / Math.sqrt(va * vb) : null;
}
