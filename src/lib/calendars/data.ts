// Earnings, economic, dividend and IPO calendars from the Filed Under pipeline:
// estimates/index.json (scheduled earnings dates and consensus), macro/releases.json (the publishers' own release
// schedules), calendars/dividends.json (8-K dividend declarations plus price-history cadence) and
// calendars/ipos.json (EDGAR registration statements, effectiveness notices and final prospectuses).
import { queryOptions } from "@tanstack/react-query";
import { partnerFile } from "@/lib/data";

export interface EarningsEntry {
  date: string | null;
  is_estimate: boolean | null;
  call_date: string | null;
  eps: number | null;
  revenue: number | null;
  provider?: string;
  url?: string;
  as_of?: string;
  last: {
    quarter_end: string;
    eps_actual: number | null;
    eps_estimate: number | null;
    surprise_pct: number | null;
    beat: number | null;
  } | null;
}
export interface EstimatesIndexRow {
  ticker: string;
  next_earnings: string | null;
  consensus_as_of: string | null;
  eps_0q: number | null;
  earnings?: EarningsEntry;
}
export interface EstimatesIndex {
  generated: string;
  companies: EstimatesIndexRow[];
}

export interface MacroRelease {
  release: string;
  release_date: string;
  release_time: string | null;
  provider: string;
  title: string;
  source_url: string;
  retrieved_at?: string;
}

export interface Declaration {
  amount: number;
  kind: string;
  record: string | null;
  payable: string | null;
  ex_date: string | null;
  increase: boolean;
  quote: string;
  filed: string;
  accn: string;
  doc: string;
  url: string;
  form: string;
  exhibit: string | null;
}
export interface DividendRow {
  ticker: string;
  name: string | null;
  close: number | null;
  declared: Declaration[];
  upcoming: Declaration[];
  history?: [string, number][];
  last?: { ex_date: string; amount: number };
  frequency?: string | null;
  median_gap_days?: number | null;
  ttm?: number;
  ttm_count?: number;
  forward_annual?: number | null;
  yield_ttm?: number | null;
  yield_forward?: number | null;
  projected?: { ex_date: string; amount: number; basis: string } | null;
}
export interface DividendsFile {
  generated: string;
  as_of: string;
  declared_window_days: number;
  rows: DividendRow[];
  sources: Record<string, string>;
}

export interface IpoTerm {
  quote: string;
  url?: string;
  date?: string;
}
export interface IpoFiling {
  form: string;
  date: string;
  accn: string;
  doc: string | null;
  url: string;
}
export interface IpoRow {
  cik: number;
  name: string;
  status: "filed" | "amended" | "effective" | "priced" | "withdrawn";
  spac: boolean;
  sic: string | null;
  sic_desc: string | null;
  country: string | null;
  form: string | null;
  first_filed: string | null;
  last_activity: string;
  effective: string | null;
  priced: string | null;
  withdrawn: string | null;
  symbol: string | null;
  exchange: string | null;
  symbol_quote: string | null;
  range: (IpoTerm & { lo: number; hi: number; unit: string }) | null;
  price: (IpoTerm & { value: number }) | null;
  shares: (IpoTerm & { value: number; unit: string }) | null;
  proceeds: number | null;
  direct_listing?: boolean;
  filings: IpoFiling[];
}
export interface IposFile {
  generated: string;
  as_of: string;
  window_days: number;
  rows: IpoRow[];
  method: string;
}

const opts = { staleTime: 30 * 60_000, retry: 0 } as const;
export const earningsIndexQuery = queryOptions({
  queryKey: ["cal", "earnings"],
  queryFn: () => partnerFile<EstimatesIndex>("estimates/index.json"),
  ...opts,
});
export const releasesQuery = queryOptions({
  queryKey: ["cal", "releases"],
  queryFn: () => partnerFile<MacroRelease[]>("macro/releases.json"),
  ...opts,
});
export const dividendsQuery = queryOptions({
  queryKey: ["cal", "dividends"],
  queryFn: () => partnerFile<DividendsFile>("calendars/dividends.json"),
  ...opts,
});
export const iposQuery = queryOptions({
  queryKey: ["cal", "ipos"],
  queryFn: () => partnerFile<IposFile>("calendars/ipos.json"),
  ...opts,
});

/** Release keys to a short label, a group and how much the market usually moves on them (3 = most). */
export const RELEASE_META: Record<string, { label: string; group: string; weight: 1 | 2 | 3 }> = {
  "FOMC:DECISION": { label: "FOMC decision", group: "Fed", weight: 3 },
  "FOMC:MINUTES": { label: "FOMC minutes", group: "Fed", weight: 2 },
  "BLS:CPI": { label: "CPI", group: "Inflation", weight: 3 },
  "BLS:PPI": { label: "PPI", group: "Inflation", weight: 2 },
  "BLS:MXP": { label: "Import/export prices", group: "Inflation", weight: 1 },
  "BLS:EMPSIT": { label: "Jobs report", group: "Labor", weight: 3 },
  "BLS:JOLTS": { label: "JOLTS", group: "Labor", weight: 2 },
  "BLS:ECI": { label: "Employment cost index", group: "Labor", weight: 2 },
  "BLS:REAL": { label: "Real earnings", group: "Labor", weight: 1 },
  "BLS:PROD": { label: "Productivity and costs", group: "Labor", weight: 1 },
  "BEA:GDP": { label: "GDP", group: "Growth", weight: 3 },
  "BEA:PIO": { label: "Personal income & PCE", group: "Inflation", weight: 3 },
  "BEA:TRADE": { label: "Trade balance", group: "Growth", weight: 1 },
  "BEA:BOP": { label: "International transactions", group: "Growth", weight: 1 },
  "CEN:RETAIL": { label: "Retail sales", group: "Consumer", weight: 3 },
  "CEN:DURABLES": { label: "Durable goods", group: "Growth", weight: 2 },
  "CEN:STARTS": { label: "Housing starts", group: "Housing", weight: 2 },
  "CEN:NEWHOME": { label: "New home sales", group: "Housing", weight: 1 },
  "CEN:CONSTR": { label: "Construction spending", group: "Housing", weight: 1 },
  "CEN:M3": { label: "Factory orders", group: "Growth", weight: 1 },
  "CEN:AEI": { label: "Advance economic indicators", group: "Growth", weight: 1 },
  "FRB:H.15": { label: "Selected interest rates", group: "Rates", weight: 1 },
  "FRB:H.4.1": { label: "Fed balance sheet", group: "Fed", weight: 1 },
  "FRB:H.8": { label: "Bank assets & liabilities", group: "Credit", weight: 1 },
  "FRB:H.6": { label: "Money stock", group: "Fed", weight: 1 },
  "FRB:G.17": { label: "Industrial production", group: "Growth", weight: 2 },
  "FRB:G.19": { label: "Consumer credit", group: "Credit", weight: 1 },
  "FRB:Z.1": { label: "Financial accounts (Z.1)", group: "Credit", weight: 1 },
  "FRB:SLOOS": { label: "Senior loan officer survey", group: "Credit", weight: 2 },
  "FRB:SCOOS": { label: "Senior credit officer survey", group: "Credit", weight: 1 },
  "FRB:DSR": { label: "Household debt service", group: "Credit", weight: 1 },
  "CFTC:COT": { label: "Commitments of traders", group: "Positioning", weight: 1 },
};
export const releaseMeta = (k: string) =>
  RELEASE_META[k] ?? { label: k.split(":")[1] ?? k, group: "Other", weight: 1 as const };

// ---------------------------------------------------------------- dates
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const todayIso = () => {
  // the calendars are in US Eastern dates; noon UTC keeps the date stable across time zones
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return p;
};
export function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDay(d);
}
/** Monday of the week containing iso (weekends roll forward to the next Monday). */
export function weekStart(iso: string) {
  const d = new Date(`${iso}T12:00:00Z`);
  const wd = d.getUTCDay();
  const shift = wd === 0 ? 1 : wd === 6 ? 2 : 1 - wd;
  return addDays(iso, shift);
}
export const weekday = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();
export function dayDiff(a: string, b: string) {
  return Math.round(
    (new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 864e5,
  );
}
/** "8:30 a.m. ET" to minutes after midnight, for ordering a day's releases. */
export function minutesOf(t: string | null | undefined) {
  const m = /(\d{1,2}):(\d{2})\s*([ap])\.?m/i.exec(t ?? "");
  if (!m) return 24 * 60;
  let h = Number(m[1]) % 12;
  if (m[3].toLowerCase() === "p") h += 12;
  return h * 60 + Number(m[2]);
}
export const shortTime = (t: string | null | undefined) =>
  (t ?? "")
    .replace(/\s*ET$/, "")
    .replace(" a.m.", "a")
    .replace(" p.m.", "p")
    .replace(":00", "");

export function earningsOf(r: EstimatesIndexRow): EarningsEntry {
  return (
    r.earnings ?? {
      date: r.next_earnings,
      is_estimate: null,
      call_date: null,
      eps: r.eps_0q,
      revenue: null,
      last: null,
    }
  );
}

export const fmtMoney = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return "–";
  const a = Math.abs(v);
  return a >= 1e12
    ? `$${(v / 1e12).toFixed(2)}T`
    : a >= 1e9
      ? `$${(v / 1e9).toFixed(2)}B`
      : a >= 1e6
        ? `$${(v / 1e6).toFixed(1)}M`
        : `$${v.toLocaleString()}`;
};
/** Per-share amounts: at least two decimals, up to `d` when the amount has them ($0.09, $0.0725, $1.0885). */
export const fmtPerShare = (v: number | null | undefined, d = 4) =>
  v == null || !Number.isFinite(v)
    ? "–"
    : `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: d })}`;
export const fmtPct = (v: number | null | undefined, d = 1) =>
  v == null || !Number.isFinite(v) ? "–" : `${(v * 100).toFixed(d)}%`;

/** First words of a quote, used as the in-document search that highlights the sentence. */
export const searchOf = (quote: string) =>
  quote.replace(/\s+/g, " ").split(" ").slice(0, 12).join(" ");
