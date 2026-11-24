// Sector and industry analysis built by the Filed Under sectors job (etl/sectors.py) from each company's
// filings, prices and the macro store, served through the partner data service:
//   sectors.json            overview of every sector and industry, ETF rotation, SPY returns
//   sectors/{slug}.json     one group: quarterly aggregates, valuation range, performance, macro, KPIs,
//                           constituents, segment exposure, insiders, filings
//   sectors/{slug}.comp.json per-company inputs behind every aggregate
//   sectors/notes.json      weekly notes whose every figure is a reference to a stored aggregate
// The aggregate formulas here mirror etl/sectors.py (company_metrics, aggregate) so a breakdown sums to
// the published figure.
import { queryOptions } from "@tanstack/react-query";
import { partnerFile } from "@/lib/data";

export type Latest = [string, number | null, number];
export interface GroupSummary {
  slug: string;
  name: string;
  kind: "sector" | "industry";
  sector: string;
  etf?: string | null;
  n: number;
  mcap: number | null;
  q: string;
  latest: Record<string, Latest>;
  val_now?: Record<string, number | null>;
  pe_range?: ValRange | null;
  returns?: Record<"cw" | "ew" | "spy" | "etf", Record<string, number | null> | null>;
  rrg?: [string, number, number][] | null;
  breadth?: Record<string, number | null> | null;
}
export interface ValRange {
  min: number;
  max: number;
  med: number;
  from: string;
  to: string;
  n: number;
  min_q?: string;
  max_q?: string;
  pct: number | null;
}
export interface Overview {
  generated: string;
  as_of: string;
  groups: GroupSummary[];
  metrics: Record<string, { name: string; unit: string }>;
  etf_rrg: Record<string, [string, number, number][]>;
  spy_returns: Record<string, number>;
}
export interface Series {
  agg: (number | null)[];
  cw: (number | null)[];
  med: (number | null)[];
  n: number[];
}
export interface Constituent {
  tk: string;
  name: string;
  industry: string;
  mcap: number | null;
  w: number | null;
  price: number | null;
  chg_1d?: number | null;
  ret_1m?: number | null;
  ret_ytd?: number | null;
  ret_1y?: number | null;
  pe?: number | null;
  ps?: number | null;
  fcf_yield?: number | null;
  beta?: number | null;
  spark?: number[];
  q?: string;
  rev_growth?: number | null;
  gm?: number | null;
  om?: number | null;
  roic?: number | null;
}
export interface GroupFile {
  slug: string;
  name: string;
  kind: "sector" | "industry";
  sector: string;
  sector_slug: string;
  etf?: string | null;
  generated: string;
  members: string[];
  industries?: { slug: string; name: string; n: number }[];
  quarters: string[];
  agg: Record<string, Series>;
  metrics: Record<string, { name: string; unit: string }>;
  val_now?: {
    n: number;
    rows: [string, string, number | null, number | null, number | null, number | null][];
  } & Record<string, unknown>;
  val_range?: Record<string, ValRange | null>;
  perf?: {
    dates: string[];
    spy: (number | null)[];
    cw: (number | null)[];
    ew: (number | null)[];
    b50?: (number | null)[];
    b200?: (number | null)[];
  };
  returns?: Record<"cw" | "ew" | "spy" | "etf", Record<string, number | null> | null>;
  macro?: {
    id: string;
    name: string;
    unit: string;
    d: { corr: number; beta: number; n: number; from: string; to: string } | null;
    m?: { corr: number; n: number } | null;
  }[];
  factors?: { id: string; name: string; source: string; url: string; latest: [string, number] }[];
  kpis?: {
    id: string;
    name: string;
    unit: string;
    how: string;
    definition: string;
    quarters: string[];
    agg: (number | null)[];
    n?: number[];
    industry?: string;
  }[];
  constituents: Constituent[];
  segments?: {
    inside?: {
      tk: string;
      label: string;
      industry: string;
      v: number;
      end: string;
      fy: string;
      accn: string;
      member: string;
    }[];
  };
  insiders?: {
    since: string;
    buy: number;
    sell: number;
    n_buy: number;
    n_sell: number;
    companies: { tk: string; buy: number; sell: number; nb: number; ns: number; owners: number }[];
  };
  filings?: {
    accession: string;
    ticker: string;
    form: string;
    filed: string;
    description: string;
    url: string;
    items?: string;
  }[];
}
export interface CompFile {
  fields: string[];
  quarters: string[];
  data: Record<string, ((string | number | null)[] | null)[]>;
  mcap_now: Record<string, number | null>;
}
export interface Note {
  slug: string;
  sector: string;
  week: string;
  title: string;
  text: string;
  facts: Record<
    string,
    {
      label: string;
      text?: string;
      value?: number;
      unit?: string;
      ref?: { type: string; metric?: string; q?: string };
    }
  >;
  generated_at: string;
  model: string;
}

const hour = 3600_000;
export const overviewQuery = queryOptions({
  queryKey: ["sectors", "overview"],
  queryFn: () => partnerFile<Overview>("sectors.json"),
  staleTime: hour,
  retry: 1,
});
export const notesQuery = queryOptions({
  queryKey: ["sectors", "notes"],
  queryFn: () => partnerFile<{ notes: Note[] }>("sectors/notes.json"),
  staleTime: hour,
  retry: 1,
});
export const groupQuery = (slug: string) =>
  queryOptions({
    queryKey: ["sectors", "group", slug],
    queryFn: () => partnerFile<GroupFile>(`sectors/${slug}.json`),
    staleTime: hour,
    retry: 1,
  });
export const compQuery = (slug: string) =>
  queryOptions({
    queryKey: ["sectors", "comp", slug],
    queryFn: () => partnerFile<CompFile>(`sectors/${slug}.comp.json`),
    staleTime: hour,
    retry: 1,
  });

export const SECTOR_ETF: Record<string, string> = {
  "Information Technology": "XLK",
  Financials: "XLF",
  Energy: "XLE",
  "Health Care": "XLV",
  "Consumer Discretionary": "XLY",
  "Consumer Staples": "XLP",
  Industrials: "XLI",
  Utilities: "XLU",
  Materials: "XLB",
  "Real Estate": "XLRE",
  "Communication Services": "XLC",
};

/* ---------- formatting ---------- */
export function fmtMetric(v: number | null | undefined, unit: string | undefined, digits = 1) {
  if (v == null || !Number.isFinite(v)) return "–";
  if (unit === "pct")
    return `${(v * 100).toFixed(Math.abs(v) < 0.1 ? digits : Math.max(0, digits - 1))}%`;
  if (unit === "x") return `${v.toFixed(1)}×`;
  if (unit === "usd") {
    const a = Math.abs(v),
      s = v < 0 ? "−" : "";
    return a >= 1e12
      ? `${s}$${(a / 1e12).toFixed(2)}T`
      : a >= 1e9
        ? `${s}$${(a / 1e9).toFixed(1)}B`
        : `${s}$${(a / 1e6).toFixed(0)}M`;
  }
  if (unit === "days") return `${v.toFixed(0)}d`;
  if (unit === "%") return `${v.toFixed(2)}%`;
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
export const qLabel = (q: string) => q.replace(/^(\d{4})Q(\d)$/, "Q$2 $1");

/* ---------- aggregate breakdown (mirrors etl/sectors.py) ---------- */
type CompRow = Record<string, number | string | null>;
interface CompanyM {
  rev_growth: number | null;
  ni_growth: number | null;
  fcf_ttm: number | null;
  nopat: number | null;
  ic: number | null;
  nd: number | null;
  ebitda: number | null;
}

export function compRow(c: CompFile, tk: string, qi: number): CompRow | null {
  const r = c.data[tk]?.[qi];
  if (!r) return null;
  return Object.fromEntries(c.fields.map((f, i) => [f, r[i] ?? null]));
}
const N = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function metricsOf(r: CompRow): CompanyM {
  const rq = N(r.rev_q),
    rpy = N(r.rev_py),
    nq = N(r.ni_q),
    npy = N(r.ni_py);
  const ocf = N(r.ocf_ttm),
    capex = N(r.capex_ttm),
    oi = N(r.oi_ttm),
    eq = N(r.eq),
    tax = N(r.tax_ttm),
    pre = N(r.pretax_ttm),
    ltd = N(r.ltd),
    cash = N(r.cash),
    da = N(r.da_ttm);
  const fcf = ocf != null && capex != null ? ocf - capex : null;
  let nopat: number | null = null,
    ic: number | null = null;
  if (oi != null && eq != null) {
    let t = tax != null && pre && pre > 0 ? tax / pre : null;
    if (t == null || t < 0 || t > 0.5) t = 0.21;
    ic = eq + (ltd ?? 0) - (cash ?? 0);
    nopat = oi * (1 - t);
  }
  return {
    rev_growth: rq != null && rpy && rpy > 0 ? rq / rpy - 1 : null,
    ni_growth: nq != null && npy && npy > 0 ? nq / npy - 1 : null,
    fcf_ttm: fcf,
    nopat,
    ic,
    nd: ltd != null ? ltd - (cash ?? 0) : null,
    ebitda: oi != null && da != null ? oi + da : null,
  };
}

/** How each aggregate is formed: Σ numerator ÷ Σ denominator over companies with both. */
const RATIO: Record<
  string,
  {
    num: (r: CompRow, m: CompanyM) => number | null;
    den: (r: CompRow, m: CompanyM) => number | null;
    minus1?: boolean;
    positive?: boolean;
    numL: string;
    denL: string;
    cap?: number;
  }
> = {
  rev_growth: {
    num: (r) => N(r.rev_q),
    den: (r) => N(r.rev_py),
    minus1: true,
    numL: "Revenue, quarter",
    denL: "Revenue, year-ago quarter",
  },
  ni_growth: {
    num: (r) => N(r.ni_q),
    den: (r) => N(r.ni_py),
    minus1: true,
    numL: "Net income, quarter",
    denL: "Net income, year-ago quarter",
  },
  gm: {
    num: (r) => N(r.gp_ttm),
    den: (r) => posRev(r),
    numL: "Gross profit TTM",
    denL: "Revenue TTM",
  },
  om: {
    num: (r) => N(r.oi_ttm),
    den: (r) => posRev(r),
    numL: "Operating income TTM",
    denL: "Revenue TTM",
  },
  nm: {
    num: (r) => N(r.ni_ttm),
    den: (r) => posRev(r),
    numL: "Net income TTM",
    denL: "Revenue TTM",
  },
  fcfm: {
    num: (_r, m) => m.fcf_ttm,
    den: (r) => posRev(r),
    numL: "Free cash flow TTM",
    denL: "Revenue TTM",
  },
  roic: {
    num: (_r, m) => m.nopat,
    den: (_r, m) => (m.ic && m.ic > 0 ? m.ic : null),
    numL: "NOPAT TTM",
    denL: "Invested capital",
  },
  roe: {
    num: (r) => N(r.ni_ttm),
    den: (r) => ((N(r.eq) ?? 0) > 0 ? N(r.eq) : null),
    numL: "Net income TTM",
    denL: "Equity",
  },
  nd_ebitda: {
    num: (_r, m) => m.nd,
    den: (_r, m) => (m.ebitda && m.ebitda > 0 ? m.ebitda : null),
    numL: "Net debt",
    denL: "EBITDA TTM",
  },
  de: {
    num: (r) => N(r.ltd),
    den: (r) => ((N(r.eq) ?? 0) > 0 ? N(r.eq) : null),
    numL: "Debt",
    denL: "Equity",
  },
  pe: {
    num: (r) => N(r.mcap),
    den: (r) => N(r.ni_ttm),
    numL: "Market cap",
    denL: "Net income TTM",
    cap: 150,
  },
  ps: { num: (r) => N(r.mcap), den: (r) => posRev(r), numL: "Market cap", denL: "Revenue TTM" },
  pfcf: {
    num: (r) => N(r.mcap),
    den: (_r, m) => m.fcf_ttm,
    numL: "Market cap",
    denL: "Free cash flow TTM",
    cap: 150,
  },
};
const posRev = (r: CompRow) => ((N(r.rev_ttm) ?? 0) > 0 ? N(r.rev_ttm) : null);
export const BREAKDOWN_METRICS = new Set(Object.keys(RATIO));

export interface Breakdown {
  metric: string;
  q: string;
  value: number | null;
  numL: string;
  denL: string;
  rows: {
    tk: string;
    end: string | null;
    num: number;
    den: number;
    own: number | null;
    share: number;
  }[];
}
export function breakdown(g: GroupFile, c: CompFile, metric: string, q: string): Breakdown | null {
  const spec = RATIO[metric];
  const qi = c.quarters.indexOf(q);
  if (!spec || qi < 0) return null;
  const rows: Breakdown["rows"] = [];
  for (const tk of g.members) {
    const r = compRow(c, tk, qi);
    if (!r) continue;
    const m = metricsOf(r);
    const a = spec.num(r, m),
      b = spec.den(r, m);
    if (a == null || b == null) continue;
    rows.push({
      tk,
      end: typeof r.end === "string" ? r.end : null,
      num: a,
      den: b,
      own: b !== 0 ? (spec.minus1 ? a / b - 1 : a / b) : null,
      share: 0,
    });
  }
  const sa = rows.reduce((s, x) => s + x.num, 0),
    sb = rows.reduce((s, x) => s + x.den, 0);
  let value: number | null =
    !rows.length || sb === 0 || (spec.positive !== false && sb <= 0) ? null : sa / sb;
  if (value != null && spec.minus1) value -= 1;
  if (value != null && spec.cap && value > spec.cap) value = null;
  for (const x of rows) x.share = sb ? x.den / sb : 0;
  rows.sort((x, y) => Math.abs(y.den) - Math.abs(x.den));
  return { metric, q, value, numL: spec.numL, denL: spec.denL, rows };
}

/** Fill a weekly note's {{id}} placeholders with its stored facts. */
export function noteParts(n: Note): (string | { id: string; text: string; label: string })[] {
  const out: (string | { id: string; text: string; label: string })[] = [];
  const re = /\{\{(\w+)\}\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(n.text))) {
    if (m.index > last) out.push(n.text.slice(last, m.index));
    const f = n.facts[m[1]];
    out.push({
      id: m[1],
      label: f?.label ?? m[1],
      text: f
        ? (f.text ??
          fmtMetric(f.value ?? null, f.unit === "x" ? "x" : f.unit === "pct" ? "pct" : f.unit))
        : "–",
    });
    last = m.index + m[0].length;
  }
  if (last < n.text.length) out.push(n.text.slice(last));
  return out;
}
