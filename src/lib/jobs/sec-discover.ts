// Pure parsers for market-wide SEC filing discovery (shared by the scheduled job and the catch-up
// script). EDGAR's daily master index is the complete list for a finished day; the current-filings
// Atom feed covers today within minutes and carries 8-K item numbers.

export interface DiscoveredFiling {
  cik: string; // unpadded
  accn: string;
  form: string;
  filed: string; // YYYY-MM-DD
  items: string | null; // "2.02,9.01" for 8-Ks from the Atom feed, null when unknown
}

/** Same exclusions as the per-company walk, so a discovered filing is one the walk would store. */
export const SKIP_FORMS = /^(424B|FWP|SC 13|S-3)/;
export const isEarnings = (form: string, items: string | null) => /^8-K/.test(form) && /(^|,)\s*2\.02/.test(items ?? "");

/** `master.YYYYMMDD.idx`: CIK|Company|Form|Date|edgar/data/CIK/ACCN.txt */
export function parseMasterIndex(text: string): DiscoveredFiling[] {
  const out: DiscoveredFiling[] = [];
  for (const line of text.split("\n")) {
    const p = line.split("|");
    if (p.length !== 5 || !/^\d+$/.test(p[0]) || !/^\d{8}$/.test(p[3])) continue;
    const accn = p[4].match(/(\d{10}-\d{2}-\d{6})\.txt\s*$/)?.[1];
    if (!accn) continue;
    out.push({ cik: String(Number(p[0])), accn, form: p[2].trim(), filed: `${p[3].slice(0, 4)}-${p[3].slice(4, 6)}-${p[3].slice(6, 8)}`, items: null });
  }
  return out;
}

const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** `browse-edgar?action=getcurrent&output=atom` entries. */
export function parseCurrentAtom(xml: string): DiscoveredFiling[] {
  const out: DiscoveredFiling[] = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const accn = e.match(/accession-number=(\d{10}-\d{2}-\d{6})/)?.[1];
    const cik = e.match(/\((\d{10})\)/)?.[1];
    const form = e.match(/term="([^"]+)"/)?.[1];
    const summary = decode(e.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)?.[1] ?? "");
    const filed = summary.match(/Filed:<\/b>\s*(\d{4}-\d{2}-\d{2})/)?.[1];
    if (!accn || !cik || !form || !filed) continue;
    const items = [...summary.matchAll(/Item (\d+\.\d+)/g)].map((x) => x[1]);
    out.push({ cik: String(Number(cik)), accn, form, filed, items: items.length ? items.join(",") : null });
  }
  return out;
}

/** Keep covered filers' filings the walk would store; dedupe by accession (Atom lists filer + subject). */
export function coveredOnly(rows: DiscoveredFiling[], ciks: Map<string, string>): (DiscoveredFiling & { ticker: string })[] {
  const seen = new Set<string>();
  const out: (DiscoveredFiling & { ticker: string })[] = [];
  for (const r of rows) {
    const ticker = ciks.get(r.cik);
    if (!ticker || SKIP_FORMS.test(r.form) || seen.has(`${r.accn}:${ticker}`)) continue;
    seen.add(`${r.accn}:${ticker}`);
    out.push({ ...r, ticker });
  }
  return out;
}

/** Feed pages rotated by the scheduled job (newest 100 of each type). */
export const FEED_TYPES = ["8-K", "10-Q", "10-K", "4", "6-K", "DEF 14A", "S-1", "20-F", "3", "144"];
export const feedUrl = (type: string) =>
  `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=${encodeURIComponent(type)}&company=&dateb=&owner=include&start=0&count=100&output=atom`;
export const masterUrl = (day: string) => {
  const [y, m, d] = day.split("-");
  return `https://www.sec.gov/Archives/edgar/daily-index/${y}/QTR${Math.ceil(Number(m) / 3)}/master.${y}${m}${d}.idx`;
};
export const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
