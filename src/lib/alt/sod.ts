// FDIC Summary of Deposits: every insured branch's deposits each June 30, rolled up per company
// (all banks under its holding company) by state, with the company's share of each state's
// deposits and its largest metro areas. Pure.
import { guardEntry } from "@/lib/sources/company/guard";

export const SOD_API = "https://api.fdic.gov/banks/sod";
export const SOD_PAGE = "https://www.fdic.gov/resources/data-tools/summary-deposits";

export const STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico", GU: "Guam", VI: "U.S. Virgin Islands", AS: "American Samoa", MP: "Northern Mariana Islands", FM: "Micronesia", MH: "Marshall Islands", PW: "Palau",
};

/** One aggregate bucket as the FDIC API returns it (deposits in $ thousands). */
export interface SodBucket {
  key: string;
  branches: number;
  depositsK: number;
}

/** Who the company is at the FDIC: its holding company (all its banks) or, without one, its bank. */
export interface SodEntity {
  ticker: string;
  cert: number;
  rssd: string | null;
  name: string;
}

/** What a roll-up covers, recorded on every row it writes (`meta.scope`) so the page can tell its rows apart. */
export interface SodScope {
  filter: string;
  rssd: string | null;
  cert: number;
  scope: string;
  name: string;
}

/**
 * The branches a company's roll-up covers. By default all banks under the holding company (RSSDHCR), or the bank
 * alone without one. For a company the official mapping covers (src/lib/sources/company/links.json), only its
 * proven banks: the holder's RSSD only when the registrant is the top holder of every proven bank, otherwise the
 * proven certificates themselves; a certificate the mapping does not prove for the company is never used.
 */
export function sodScope(e: SodEntity): SodScope {
  const g = guardEntry(e.ticker);
  const byHolder = !!e.rssd && e.rssd !== "0";
  if (!g || (g.certs.includes(e.cert) && (!byHolder || g.rollup.includes(e.rssd!))))
    return byHolder ? { filter: `RSSDHCR:${e.rssd}`, rssd: e.rssd, cert: e.cert, scope: `rssd:${e.rssd}`, name: e.name } : { filter: `CERT:${e.cert}`, rssd: null, cert: e.cert, scope: `cert:${e.cert}`, name: e.name };
  const certs = g.certs;
  return { filter: certs.length === 1 ? `CERT:${certs[0]}` : `CERT:(${certs.join(" OR ")})`, rssd: null, cert: g.main, scope: `certs:${certs.join(",")}`, name: g.name };
}

export const sodFilter = (e: SodEntity, year: number) => `${sodScope(e).filter} AND YEAR:${year}`;
export const sodUrl = (filter: string, by: string, limit = 100) => `${SOD_API}?filters=${encodeURIComponent(filter)}&agg_by=${by}&agg_sum_fields=DEPSUMBR&agg_limit=${limit}&limit=1`;

/** Reads an FDIC aggregate response; zero-deposit buckets (an office that takes no deposits) are kept only for branch counts. */
export function parseBuckets(j: unknown, field: string): SodBucket[] {
  const data = (j as { data?: { data: Record<string, unknown> }[] })?.data ?? [];
  return data
    .map(({ data: d }) => ({ key: String(d[field] ?? ""), branches: Number(d.count ?? 0), depositsK: Number(d.sum_DEPSUMBR ?? 0) }))
    .filter((b) => b.key && Number.isFinite(b.depositsK));
}

interface Row {
  uid: string;
  ticker: string;
  dataset: string;
  kind: string;
  date: string;
  title: string;
  value: number;
  unit: string;
  meta: Record<string, unknown>;
  source: string;
  source_url: string;
}

export const stateTitle = (st: string) => `Deposits · ${st}`;
export const TOTAL_TITLE = "Branch deposits";

/**
 * Rows for one company and year: total branch deposits (with its states and largest metros in
 * meta) and one series per state with the company's share of its own deposits and of the state's.
 * States where the company has offices but no deposits are left out.
 */
export function sodRows(e: SodEntity, year: number, states: SodBucket[], stateTotals: Map<string, number>, metros: SodBucket[] = []): Row[] {
  const held = states.filter((s) => s.depositsK > 0);
  const totalK = held.reduce((n, s) => n + s.depositsK, 0);
  if (!totalK) return [];
  const date = `${year}-06-30`;
  const scope = sodScope(e);
  const url = sodUrl(sodFilter(e, year), "STALPBR");
  const base = { ticker: e.ticker, dataset: "deposits", kind: "series", date, unit: "USD", source: "FDIC Summary of Deposits", source_url: url };
  const ranked = [...held].sort((a, b) => b.depositsK - a.depositsK);
  const out: Row[] = [
    {
      ...base,
      uid: `sod:${e.ticker}:${year}:total`,
      title: TOTAL_TITLE,
      value: totalK * 1000,
      meta: {
        year,
        entity: scope.name,
        rssd: scope.rssd,
        cert: scope.cert,
        scope: scope.scope,
        states: held.length,
        branches: states.reduce((n, s) => n + s.branches, 0),
        top: ranked.slice(0, 8).map((s) => ({ state: s.key, value: s.depositsK * 1000, share: s.depositsK / totalK })),
        metros: metros
          .filter((m) => m.depositsK > 0 && m.key.trim())
          .sort((a, b) => b.depositsK - a.depositsK)
          .slice(0, 12)
          .map((m) => ({ name: m.key, value: m.depositsK * 1000, branches: m.branches, share: m.depositsK / totalK })),
      },
    },
  ];
  for (const s of held) {
    const all = stateTotals.get(s.key);
    out.push({
      ...base,
      uid: `sod:${e.ticker}:${year}:${s.key}`,
      title: stateTitle(s.key),
      value: s.depositsK * 1000,
      meta: { year, state: s.key, name: STATES[s.key] ?? s.key, branches: s.branches, share: s.depositsK / totalK, ...(all ? { market_share: s.depositsK / all, state_total: all * 1000 } : {}), rank: ranked.indexOf(s) + 1, scope: scope.scope },
    });
  }
  return out;
}
