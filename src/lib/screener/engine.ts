// Screener engine: the screen spec (filters, universe, sort, columns, grouping) and the code that applies
// it. Ported from the Filed Under screener (public/pages/screenspec.js and screener.js) so a spec written
// by the screen agent behaves identically here. Data: screener.json from the partner data service (rich
// rows, about 240 fields) plus basic rows built from the partner universe's SEC fundamentals for companies
// screener.json does not carry yet.
import type { Quote } from "@/lib/market.functions";
import type { UniverseEntry } from "@/lib/financials/types";

export type FieldUnit =
  "usd" | "pct" | "pctl" | "x" | "corr" | "num" | "days" | "bool" | "score" | string;
export interface FieldDef {
  id: string;
  g: string;
  n: string;
  u: FieldUnit;
  d: string;
  src?: string;
  cov?: number;
  q?: [number, number, number];
  min?: number;
  max?: number;
  asof?: string;
  true?: number;
}
export interface ScreenerFile {
  generated: string;
  universe: { id: string };
  asof: { prices?: string; facts?: string };
  groups: { id: string; n: string }[];
  fields: FieldDef[];
  cols: string[];
  rows: unknown[][];
}
export type Row = Record<string, unknown> & {
  ticker: string;
  name: string;
  sector: string;
  industry: string;
  basic?: boolean;
};

export type Op =
  ">" | ">=" | "<" | "<=" | "between" | "=" | "!=" | "top" | "bottom" | "true" | "false" | "exists";
export interface Filter {
  field: string;
  op: Op;
  value?: number | [number | null, number | null];
  pct?: number;
  scope?: "all" | "sector" | "industry";
}
export interface Spec {
  filters: Filter[];
  sectors: string[];
  exclude_sectors: string[];
  industries: string[];
  exclude_industries: string[];
  index: "all" | "sp500" | "sp100";
  tickers: string[];
  exclude_tickers: string[];
  similar_to: { ticker: string; n: number; fields?: string[] } | null;
  sort: { field: string; dir: "asc" | "desc" } | null;
  columns: string[];
  group_by: string | null;
  limit: number | null;
  explanation: string;
  assumptions: string[];
}
export interface Catalogue {
  fields: FieldDef[];
  sectors: string[];
  industries: string[];
  tickers: string[];
}

export const OPS: Op[] = [
  ">",
  ">=",
  "<",
  "<=",
  "between",
  "=",
  "!=",
  "top",
  "bottom",
  "true",
  "false",
  "exists",
];
export const GROUPS = ["sector", "industry", "mcap_bucket"];
export const INDEX_LABELS = { all: "All tracked", sp500: "S&P 500", sp100: "S&P 100" } as const;

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v)
    ? v
    : typeof v === "string" && v.trim() !== "" && Number.isFinite(+v)
      ? +v
      : null;
const uniq = <T>(a: T[]) => [...new Set(a)];

export function emptySpec(): Spec {
  return {
    filters: [],
    sectors: [],
    exclude_sectors: [],
    industries: [],
    exclude_industries: [],
    index: "all",
    tickers: [],
    exclude_tickers: [],
    similar_to: null,
    sort: null,
    columns: [],
    group_by: null,
    limit: null,
    explanation: "",
    assumptions: [],
  };
}

export function inIndex(row: Row, choice: Spec["index"]) {
  if (choice === "all") return true;
  return row[choice] === true || row[choice] === 1;
}

function matchName(map: Map<string, string>, s: unknown, errors: string[], kind: string) {
  const k = String(s ?? "")
    .toLowerCase()
    .trim();
  if (map.has(k)) return map.get(k)!;
  const hits = [...map.keys()].filter((x) => x.includes(k) || k.includes(x));
  if (hits.length === 1) return map.get(hits[0])!;
  errors.push(`Unknown ${kind} "${String(s)}"`);
  return null;
}

/** Same rules as the agent's server-side validation; errors name things the catalogue does not have. */
export function validate(
  input: unknown,
  cat: Catalogue,
): { spec: Spec; errors: string[]; warnings: string[] } {
  const F = new Map(cat.fields.map((f) => [f.id, f]));
  const lower = (arr: string[]) => new Map(arr.map((s) => [s.toLowerCase(), s]));
  const SEC = lower(cat.sectors),
    IND = lower(cat.industries),
    TK = new Set(cat.tickers);
  const errors: string[] = [],
    warnings: string[] = [];
  // Agent output is untrusted JSON; every field is checked below before use.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = (input && typeof input === "object" ? input : {}) as Record<string, any>;
  const out = emptySpec();
  const field = (id: unknown, where?: string) => {
    if (typeof id !== "string" || !F.has(id)) {
      errors.push(`Unknown field "${String(id)}"${where ? ` in ${where}` : ""}`);
      return null;
    }
    return F.get(id)!;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Array.isArray(s.filters) ? s.filters : []).forEach((f0: any, i: number) => {
    if (!f0 || typeof f0 !== "object") return void errors.push(`Filter ${i + 1} is not an object`);
    const fd = field(f0.field, `filter ${i + 1}`);
    if (!fd) return;
    let op = String(f0.op ?? "")
      .trim()
      .toLowerCase();
    const alias: Record<string, string> = {
      "==": "=",
      gt: ">",
      gte: ">=",
      lt: "<",
      lte: "<=",
      top_pct: "top",
      bottom_pct: "bottom",
    };
    if (op === "is")
      op = f0.value === false || f0.value === 0 || f0.value === "false" ? "false" : "true";
    op = alias[op] ?? op;
    if (!OPS.includes(op as Op))
      return void errors.push(`Filter on ${fd.id}: unknown op "${f0.op}"`);
    const f: Filter = { field: fd.id, op: op as Op };
    if (fd.u === "bool" && !["true", "false", "exists"].includes(op)) {
      const v =
        f0.value === true || f0.value === "true"
          ? 1
          : f0.value === false || f0.value === "false"
            ? 0
            : num(f0.value);
      if ((op === "=" && v === 1) || (op === "!=" && v === 0)) f.op = "true";
      else if ((op === "=" && v === 0) || (op === "!=" && v === 1)) f.op = "false";
      else return void errors.push(`Filter on ${fd.id}: a yes/no field takes op "true" or "false"`);
    } else if (op === "between") {
      const v = Array.isArray(f0.value) ? f0.value.map(num) : [num(f0.min), num(f0.max)];
      if (v.length !== 2 || (v[0] == null && v[1] == null))
        return void errors.push(`Filter on ${fd.id}: between needs [low, high]`);
      f.value = v[0] != null && v[1] != null && v[0] > v[1] ? [v[1], v[0]] : [v[0], v[1]];
    } else if (op === "top" || op === "bottom") {
      const p = num(f0.pct ?? f0.value);
      if (p == null || p <= 0 || p > 100)
        return void errors.push(`Filter on ${fd.id}: ${op} needs pct between 0 and 100`);
      f.pct = p <= 1 && f0.pct == null && f0.value != null && p < 1 ? p * 100 : p;
      f.scope = f0.scope === "sector" || f0.scope === "industry" ? f0.scope : "all";
    } else if (op !== "true" && op !== "false" && op !== "exists") {
      const v = num(f0.value);
      if (v == null) return void errors.push(`Filter on ${fd.id}: value must be a number`);
      f.value = v;
    }
    if ((fd.u === "pct" || fd.u === "pctl" || fd.u === "corr") && fd.q) {
      const span = Math.max(
        Math.abs(fd.q[0] ?? 0),
        Math.abs(fd.q[2] ?? 0),
        fd.u === "corr" || fd.u === "pctl" ? 1 : 0,
      );
      const fix = (x: number | null) =>
        x != null && Math.abs(x) > 1.5 && Math.abs(x) > span * 3 && Math.abs(x) <= 1000
          ? x / 100
          : x;
      if (Array.isArray(f.value)) {
        const nv = f.value.map(fix) as [number | null, number | null];
        if (nv.some((x, k) => x !== (f.value as [number | null, number | null])[k])) {
          warnings.push(`Read ${fd.id} bounds as percentages`);
          f.value = nv;
        }
      } else if (typeof f.value === "number") {
        const nv = fix(f.value)!;
        if (nv !== f.value) {
          warnings.push(`Read ${fd.id} ${f.value} as ${f.value}%`);
          f.value = nv;
        }
      }
    }
    out.filters.push(f);
  });
  for (const [k, map, kind] of [
    ["sectors", SEC, "sector"],
    ["exclude_sectors", SEC, "sector"],
    ["industries", IND, "industry"],
    ["exclude_industries", IND, "industry"],
  ] as const) {
    const raw = Array.isArray(s[k]) ? s[k] : s[k] ? [s[k]] : [];
    out[k] = uniq(
      raw.map((x: unknown) => matchName(map, x, errors, kind)).filter(Boolean) as string[],
    );
  }
  if (s.index != null) {
    const v = String(s.index)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    if (v === "all" || v === "sp500" || v === "sp100") out.index = v;
    else errors.push(`Unknown index "${s.index}"`);
  }
  for (const k of ["tickers", "exclude_tickers"] as const) {
    out[k] = uniq(
      (Array.isArray(s[k]) ? s[k] : [])
        .map((t: unknown) => String(t).toUpperCase().replace(".", "-"))
        .filter((t: string) => (TK.has(t) ? true : (errors.push(`Unknown ticker "${t}"`), false))),
    );
  }
  if (s.similar_to) {
    const t = String((typeof s.similar_to === "string" ? s.similar_to : s.similar_to.ticker) ?? "")
      .toUpperCase()
      .replace(".", "-");
    if (!TK.has(t)) errors.push(`Unknown ticker "${t}" in similar_to`);
    else {
      const n = Math.max(3, Math.min(100, Math.round(num(s.similar_to.n) ?? 25)));
      const fields = Array.isArray(s.similar_to.fields)
        ? s.similar_to.fields.filter((id: string) => field(id, "similar_to.fields"))
        : null;
      out.similar_to = { ticker: t, n, ...(fields?.length ? { fields } : {}) };
    }
  }
  if (s.sort) {
    const sf = typeof s.sort === "string" ? s.sort : s.sort.field;
    if (sf === "similarity" && out.similar_to) out.sort = { field: "similarity", dir: "asc" };
    else if (sf && field(sf, "sort"))
      out.sort = {
        field: sf,
        dir: String(s.sort.dir ?? "desc").toLowerCase() === "asc" ? "asc" : "desc",
      };
  }
  out.columns = uniq(
    (Array.isArray(s.columns) ? s.columns : []).filter((id: unknown) => field(id, "columns")),
  );
  if (s.group_by) {
    const g = String(s.group_by);
    if (GROUPS.includes(g)) out.group_by = g;
    else if (/^quintile:/.test(g) && field(g.slice(9), "group_by")) out.group_by = g;
    else if (g !== "corr_cluster") errors.push(`Unknown group_by "${g}"`);
  }
  if (s.limit != null) {
    const l = num(s.limit);
    if (l != null && l > 0) out.limit = Math.min(500, Math.round(l));
  }
  out.explanation = typeof s.explanation === "string" ? s.explanation.slice(0, 1200) : "";
  out.assumptions = (Array.isArray(s.assumptions) ? s.assumptions : [])
    .filter((x: unknown) => typeof x === "string")
    .map((x: string) => x.slice(0, 400))
    .slice(0, 8);
  return { spec: out, errors: uniq(errors), warnings: uniq(warnings) };
}

/* ---------- rows ---------- */
const PRICE_SCALED_UP = ["mcap", "pe", "ps", "pb"]; // move with price
const PRICE_SCALED_DOWN = ["fcf_yield", "earn_yield", "div_yield", "bb_yield", "sh_yield"]; // move against price

export function rowsFromFile(d: ScreenerFile): Row[] {
  const bools = new Set(d.fields.filter((f) => f.u === "bool").map((f) => f.id));
  return d.rows.map((r) => {
    const o: Record<string, unknown> = {};
    d.cols.forEach((c, i) => {
      o[c] = r[i];
    });
    for (const b of bools) if (o[b] != null) o[b] = !!o[b];
    o.sp500 = o.sp500 === true || o.sp500 === 1;
    o.sp100 = o.sp100 === true || o.sp100 === 1;
    return o as Row;
  });
}

/** Companies in the partner universe that screener.json does not carry: SEC fundamentals only. */
export function basicRow(u: UniverseEntry, price: number | null): Row {
  const f = u.f;
  const t = f?.ttm ?? {};
  const bs = f?.bs ?? {};
  const shares = u.sharesOutstanding ?? f?.dilutedShares ?? null;
  const mcap = price != null && shares ? price * shares : null;
  const fin = u.sector === "Financials";
  const debt = bs.totalDebt ?? null;
  const cash = (bs.cash ?? 0) + (bs.shortTermInvestments ?? 0);
  const ev = mcap != null && debt != null && !fin ? mcap + debt - cash : null;
  const div = (a: number | null | undefined, b: number | null | undefined) =>
    a != null && b != null && b !== 0 ? a / b : null;
  const pos = (v: number | null) => (v != null && v > 0 ? v : null);
  const rev = t.revenue ?? null;
  const eps = t.epsDiluted ?? u.epsTTM ?? null;
  const ebitda =
    t.ebitda ?? (t.operatingIncome != null && t.dna != null ? t.operatingIncome + t.dna : null);
  const netDebt = bs.netDebt ?? (debt != null ? debt - cash : null);
  return {
    ticker: u.ticker,
    name: u.name,
    sector: u.sector,
    industry: u.industry,
    sp500: false,
    sp100: false,
    basic: true,
    lq_end: f?.asOf ?? null,
    price,
    mcap,
    ev,
    pe: eps != null && eps > 0 && price != null ? price / eps : null,
    ps: pos(div(mcap, rev)),
    pb: bs.equity && bs.equity > 0 ? div(mcap, bs.equity) : null,
    ev_sales: fin ? null : pos(div(ev, rev)),
    ev_ebit:
      fin || !t.operatingIncome || t.operatingIncome <= 0 ? null : div(ev, t.operatingIncome),
    ev_fcf: fin || !t.fcf || t.fcf <= 0 ? null : div(ev, t.fcf),
    fcf_yield: div(t.fcf, mcap),
    earn_yield: eps != null && price ? eps / price : null,
    gm: div(t.grossProfit, rev) ?? u.grossMarginTTM ?? null,
    om: div(t.operatingIncome, rev),
    nm: div(t.netIncome, rev),
    fcfm: div(t.fcf, rev),
    rev_g_ttm: u.revenueGrowthYoY ?? null,
    rev_cagr3: f?.revenueCagr3y ?? null,
    rev_cagr5: f?.revenueCagr5y ?? null,
    eps_g_ttm: f?.epsGrowthYoY ?? null,
    net_debt: fin ? null : netDebt,
    nd_ebitda: fin || !ebitda || ebitda <= 0 || netDebt == null ? null : netDebt / ebitda,
    roe: bs.equity && bs.equity > 0 ? div(t.netIncome, bs.equity) : null,
    de: bs.equity && bs.equity > 0 && debt != null ? debt / bs.equity : null,
    div_yield: t.dividends != null ? div(Math.abs(t.dividends), mcap) : null,
    bb_yield: t.buybacks != null ? div(Math.abs(t.buybacks), mcap) : null,
    sh_yield:
      t.dividends != null || t.buybacks != null
        ? div(Math.abs(t.dividends ?? 0) + Math.abs(t.buybacks ?? 0), mcap)
        : null,
    sbc_pct: div(t.sbc, rev),
    rnd_int: div(t.rnd, rev),
    capex_int: t.capex != null ? div(Math.abs(t.capex), rev) : null,
  };
}

/** Moves price-based fields to the live quote (screener.json values use its own close). */
export function withLive(r: Row, q: Quote | undefined): Row {
  const p0 = num(r.price);
  if (!q?.price || p0 == null || p0 <= 0 || r.basic) return r;
  const k = q.price / p0;
  if (Math.abs(k - 1) < 1e-6) return r;
  const o: Row = { ...r, price: q.price };
  for (const id of PRICE_SCALED_UP) if (typeof o[id] === "number") o[id] = (o[id] as number) * k;
  for (const id of PRICE_SCALED_DOWN) if (typeof o[id] === "number") o[id] = (o[id] as number) / k;
  if (typeof o.ev === "number" && typeof r.mcap === "number")
    o.ev = (o.ev as number) + (r.mcap as number) * (k - 1);
  return o;
}
const IDENTITY = new Set([
  "ticker",
  "name",
  "sector",
  "industry",
  "sp500",
  "sp100",
  "basic",
  "lq_end",
  "price",
]);
/** Fills a screener row's empty fundamentals from the partner universe (same SEC basis, computed at the live price). */
export function fillFrom(r: Row, b: Row): Row {
  let o: Row | null = null;
  const filled: string[] = [];
  for (const [k, v] of Object.entries(b)) {
    if (IDENTITY.has(k) || v == null || r[k] != null) continue;
    o ??= { ...r };
    o[k] = v;
    filled.push(k);
  }
  if (!o) return r;
  o.filled = filled;
  return o;
}
export const LIVE_FIELDS = new Set(["price", "ev", ...PRICE_SCALED_UP, ...PRICE_SCALED_DOWN]);
export const BASIC_FIELDS = new Set(
  Object.keys(basicRow({ ticker: "", name: "", sector: "", industry: "" } as UniverseEntry, null)),
);

/* ---------- engine ---------- */
export const mcapBucket = (v: unknown) =>
  typeof v !== "number"
    ? "Unknown"
    : v >= 300e9
      ? "Mega (> $300B)"
      : v >= 60e9
        ? "Large ($60B to $300B)"
        : v >= 20e9
          ? "Mid ($20B to $60B)"
          : "Small (< $20B)";
export const BUCKET_ORDER = [
  "Mega (> $300B)",
  "Large ($60B to $300B)",
  "Mid ($20B to $60B)",
  "Small (< $20B)",
  "Unknown",
];

function universeOf(rows: Row[], spec: Spec) {
  return rows.filter(
    (r) =>
      inIndex(r, spec.index) &&
      (!spec.sectors.length || spec.sectors.includes(r.sector)) &&
      !spec.exclude_sectors.includes(r.sector) &&
      (!spec.industries.length || spec.industries.includes(r.industry)) &&
      !spec.exclude_industries.includes(r.industry) &&
      (!spec.tickers.length || spec.tickers.includes(r.ticker)) &&
      !spec.exclude_tickers.includes(r.ticker),
  );
}
function pctPass(rows: Row[], f: Filter) {
  const key = f.scope === "sector" ? "sector" : f.scope === "industry" ? "industry" : null;
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const v = r[f.field];
    if (typeof v !== "number") continue;
    const g = key ? String(r[key]) : "_";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(r);
  }
  const pass = new Set<string>();
  groups.forEach((list) => {
    list.sort((a, b) => (a[f.field] as number) - (b[f.field] as number));
    const n = Math.max(1, Math.round((list.length * (f.pct ?? 0)) / 100));
    (f.op === "top" ? list.slice(-n) : list.slice(0, n)).forEach((r) => pass.add(r.ticker));
  });
  return pass;
}
export function testFilter(f: Filter, v: unknown) {
  if (f.op === "true") return v === true;
  if (f.op === "false") return v === false;
  if (f.op === "exists") return v != null;
  if (typeof v !== "number") return false;
  const x = f.value as number;
  switch (f.op) {
    case ">":
      return v > x;
    case ">=":
      return v >= x;
    case "<":
      return v < x;
    case "<=":
      return v <= x;
    case "=":
      return Math.abs(v - x) < 1e-9;
    case "!=":
      return Math.abs(v - x) >= 1e-9;
    case "between": {
      const [lo, hi] = f.value as [number | null, number | null];
      return (lo == null || v >= lo) && (hi == null || v <= hi);
    }
  }
  return true;
}

export const SIM_FIELDS = [
  "pe",
  "ev_sales",
  "fcf_yield",
  "rev_g_ttm",
  "rev_cagr3",
  "eps_g_ttm",
  "gm",
  "om",
  "roic",
  "nd_ebitda",
  "beta",
  "vol_1y",
  "ret_1y",
  "ret_3m",
  "c_spy",
  "c_tnx",
  "c_oil",
  "c_dxy",
  "div_yield",
  "sbc_pct",
  "rnd_int",
];

function similarity(
  target: Row,
  all: Row[],
  rows: Row[],
  fields: string[],
  F: Map<string, FieldDef>,
) {
  const z: Record<string, (v: unknown) => number | null> = {};
  for (const id of fields) {
    const f = F.get(id);
    if (!f) continue;
    const tr = (v: number) => (id === "mcap" ? Math.log(v) : v);
    const lo = f.q ? tr(f.q[0]) : -Infinity,
      hi = f.q ? tr(f.q[2]) : Infinity;
    const clip = (v: unknown) =>
      typeof v !== "number" || (id === "mcap" && v <= 0) ? null : Math.min(hi, Math.max(lo, tr(v)));
    const vals = all.map((r) => clip(r[id])).filter((v): v is number => v != null);
    if (vals.length < 20) continue;
    const m = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length) || 1;
    z[id] = (v) => {
      const c = clip(v);
      return c == null ? null : (c - m) / sd;
    };
  }
  const ids = Object.keys(z);
  const tv = ids.map((id) => z[id](target[id]));
  const have = tv.filter((v) => v != null).length;
  const out = new Map<string, number>();
  for (const r of rows) {
    let s = 0,
      n = 0;
    ids.forEach((id, k) => {
      const a = tv[k],
        b = z[id](r[id]);
      if (a != null && b != null) {
        s += (a - b) ** 2;
        n++;
      }
    });
    // Compare on most of the traits the target has, so sparse rows don't look close by omission.
    if (n >= Math.max(Math.min(8, ids.length), Math.ceil(0.75 * have)))
      out.set(r.ticker, Math.sqrt(s / n));
  }
  return out;
}

export function run(all: Row[], spec: Spec, F: Map<string, FieldDef>, q = "") {
  const uni = universeOf(all, spec);
  const pass = new Map<number, Set<string>>();
  spec.filters.forEach((f, i) => {
    if (f.op === "top" || f.op === "bottom") pass.set(i, pctPass(uni, f));
  });
  let rows = uni.filter((r) =>
    spec.filters.every((f, i) =>
      pass.has(i) ? pass.get(i)!.has(r.ticker) : testFilter(f, r[f.field]),
    ),
  );
  const qq = q.trim().toLowerCase();
  if (qq)
    rows = rows.filter(
      (r) =>
        r.ticker.toLowerCase().includes(qq) ||
        r.name.toLowerCase().includes(qq) ||
        (r.industry ?? "").toLowerCase().includes(qq),
    );
  let sim: Map<string, number> | null = null;
  const target = spec.similar_to
    ? all.find((r) => r.ticker === spec.similar_to!.ticker)
    : undefined;
  if (spec.similar_to && target) {
    sim = similarity(target, all, rows, spec.similar_to.fields ?? SIM_FIELDS, F);
    rows = rows
      .filter((r) => sim!.has(r.ticker) && r.ticker !== target.ticker)
      .sort((a, b) => sim!.get(a.ticker)! - sim!.get(b.ticker)!)
      .slice(0, spec.similar_to.n);
  }
  const s = spec.sort;
  if (s?.field === "similarity" && sim)
    rows.sort((a, b) => sim!.get(a.ticker)! - sim!.get(b.ticker)!);
  else if (s?.field) {
    const dir = s.dir === "asc" ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      const x = a[s.field],
        y = b[s.field];
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return typeof x === "string"
        ? dir * x.localeCompare(String(y))
        : dir * ((x as number) - (y as number));
    });
  }
  if (spec.limit) rows = rows.slice(0, spec.limit);
  return { rows, uni, sim };
}

/* ---------- describing ---------- */
export function fmtField(f: FieldDef | undefined, v: unknown): string {
  if (v == null || v === "") return "–";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v !== "number" || !Number.isFinite(v)) return String(v);
  const u = f?.u;
  if (u === "usd") {
    const a = Math.abs(v),
      s = v < 0 ? "−" : "";
    if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`;
    if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(1)}B`;
    if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(0)}M`;
    if (a === 0) return "$0";
    return `${s}$${a.toFixed(a < 100 ? 2 : 0)}`;
  }
  if (u === "pct") return `${(v * 100).toFixed(Math.abs(v) < 0.1 ? 1 : 0)}%`;
  if (u === "pctl") return `${Math.round(v * 100)}th`;
  if (u === "x") return `${v.toFixed(v >= 100 ? 0 : 1)}×`;
  if (u === "corr") return v.toFixed(2);
  if (u === "days") return `${Math.round(v)}d`;
  return Math.abs(v) >= 1000
    ? Math.round(v).toLocaleString("en-US")
    : v.toFixed(Math.abs(v) < 10 ? 2 : 1);
}
const OPTXT: Record<string, string> = {
  ">": ">",
  ">=": "≥",
  "<": "<",
  "<=": "≤",
  "=": "=",
  "!=": "≠",
};
export function filterText(f: Filter, F: Map<string, FieldDef>) {
  const fd = F.get(f.field);
  const n = fd?.n ?? f.field;
  if (f.op === "true") return `${n}: yes`;
  if (f.op === "false") return `${n}: no`;
  if (f.op === "exists") return `${n} reported`;
  if (f.op === "top" || f.op === "bottom")
    return `${n}: ${f.op} ${f.pct}%${f.scope && f.scope !== "all" ? ` in ${f.scope}` : ""}`;
  if (f.op === "between") {
    const [lo, hi] = f.value as [number | null, number | null];
    return `${n} ${lo != null ? fmtField(fd, lo) : "…"} to ${hi != null ? fmtField(fd, hi) : "…"}`;
  }
  return `${n} ${OPTXT[f.op]} ${fmtField(fd, f.value)}`;
}

/* ---------- presets and column sets ---------- */
export const PRESETS: { id: string; n: string; why: string; spec: Partial<Spec> }[] = [
  {
    id: "quality",
    n: "Quality compounders",
    why: "ROIC above 15%, gross margin no lower than three years ago, five-year revenue CAGR above 7% and modest leverage.",
    spec: {
      filters: [
        { field: "roic", op: ">", value: 0.15 },
        { field: "gm_chg3", op: ">=", value: 0 },
        { field: "rev_cagr5", op: ">", value: 0.07 },
        { field: "nd_ebitda", op: "<", value: 2 },
      ],
      sort: { field: "roic", dir: "desc" },
      columns: ["roic", "gm", "gm_chg3", "rev_cagr5", "nd_ebitda", "pe", "pe_p5"],
    },
  },
  {
    id: "deepvalue",
    n: "Deep value, improving margins",
    why: "Cheapest 25% of each sector on P/E with operating margin up over three years.",
    spec: {
      filters: [
        { field: "pe", op: "bottom", pct: 25, scope: "sector" },
        { field: "om_chg3", op: ">", value: 0 },
        { field: "om", op: ">", value: 0 },
      ],
      sort: { field: "pe_p5", dir: "asc" },
      columns: ["pe", "pe_p5", "om", "om_chg3", "rev_g_ttm", "fcf_yield"],
    },
  },
  {
    id: "fcf",
    n: "High FCF yield, low debt",
    why: "Free cash flow yield above 6% with net debt under 1.5× EBITDA.",
    spec: {
      filters: [
        { field: "fcf_yield", op: ">", value: 0.06 },
        { field: "nd_ebitda", op: "<", value: 1.5 },
      ],
      sort: { field: "fcf_yield", dir: "desc" },
      columns: ["fcf_yield", "nd_ebitda", "fcfm", "ev_fcf", "sh_yield", "mcap"],
    },
  },
  {
    id: "momentum",
    n: "Momentum leaders",
    why: "Top fifth on three-month return, above the 200-day average and within 10% of the 52-week high.",
    spec: {
      filters: [
        { field: "mom_rank_3m", op: ">", value: 0.8 },
        { field: "above_sma200", op: "true" },
        { field: "dist_hi52", op: ">", value: -0.1 },
      ],
      sort: { field: "ret_6m", dir: "desc" },
      columns: ["ret_3m", "ret_6m", "mom_rank_3m", "dist_hi52", "dist_sma200", "rsi14"],
    },
  },
  {
    id: "insiders",
    n: "Insider cluster buying",
    why: "Two or more insiders bought on the open market in the last 90 days, net buying.",
    spec: {
      filters: [
        { field: "ins_buyers_90d", op: ">=", value: 2 },
        { field: "ins_net_90d", op: ">", value: 0 },
      ],
      sort: { field: "ins_net_90d", dir: "desc" },
      columns: ["ins_buyers_90d", "ins_net_90d", "ins_net_1y", "ret_3m", "pe"],
    },
  },
  {
    id: "accel",
    n: "Accelerating growth",
    why: "Revenue up more than 10% in the latest quarter with the growth rate rising at least 2 points.",
    spec: {
      filters: [
        { field: "rev_g_q", op: ">", value: 0.1 },
        { field: "rev_accel", op: ">", value: 0.02 },
      ],
      sort: { field: "rev_accel", dir: "desc" },
      columns: ["rev_g_q", "rev_accel", "eps_g_q", "om", "ps"],
    },
  },
  {
    id: "netcash",
    n: "Net cash, high margin",
    why: "More cash than debt and operating margin above 25%.",
    spec: {
      filters: [
        { field: "net_debt", op: "<", value: 0 },
        { field: "om", op: ">", value: 0.25 },
      ],
      sort: { field: "om", dir: "desc" },
      columns: ["net_debt", "om", "gm", "roic", "ev_ebit", "fcf_yield"],
    },
  },
  {
    id: "shyield",
    n: "Shareholder yield",
    why: "Dividends plus buybacks above 6% of market cap with the share count down on the year.",
    spec: {
      filters: [
        { field: "sh_yield", op: ">", value: 0.06 },
        { field: "shr_chg1", op: "<", value: 0 },
      ],
      sort: { field: "sh_yield", dir: "desc" },
      columns: ["sh_yield", "div_yield", "bb_yield", "shr_chg1", "fcf_yield"],
    },
  },
  {
    id: "cheaphist",
    n: "Cheap vs own history",
    why: "P/E and EV/Sales both in the bottom fifth of their own five-year range.",
    spec: {
      filters: [
        { field: "pe_p5", op: "<", value: 0.2 },
        { field: "ev_sales_p5", op: "<", value: 0.2 },
      ],
      sort: { field: "pe_p5", dir: "asc" },
      columns: ["pe", "pe_p5", "ev_sales", "ev_sales_p5", "rev_g_ttm", "om_chg3"],
    },
  },
  {
    id: "ratedown",
    n: "Rate-sensitive",
    why: "Bottom 10% by correlation with 10-year yield changes.",
    spec: {
      filters: [{ field: "c_tnx", op: "bottom", pct: 10, scope: "all" }],
      sort: { field: "c_tnx", dir: "asc" },
      columns: ["c_tnx", "div_yield", "nd_ebitda", "beta", "ret_3m"],
    },
  },
  {
    id: "earnings",
    n: "Reporting in two weeks",
    why: "Estimated from each company's results 8-K cadence.",
    spec: {
      filters: [{ field: "next_earn_days", op: "between", value: [0, 14] }],
      sort: { field: "next_earn_days", dir: "asc" },
      columns: ["next_earn_days", "rev_g_q", "eps_g_q", "ret_1m"],
    },
  },
];
export const COLSETS: Record<string, string[]> = {
  Overview: ["price", "mcap", "pe", "rev_g_ttm", "om", "fcf_yield", "div_yield", "ret_1y"],
  Valuation: [
    "mcap",
    "pe",
    "pe_p5",
    "ev_ebit",
    "ev_sales",
    "ev_fcf",
    "pb",
    "fcf_yield",
    "earn_yield",
  ],
  Growth: ["rev_g_q", "rev_g_ttm", "rev_cagr3", "rev_cagr5", "rev_accel", "eps_g_ttm", "fcf_g_ttm"],
  Quality: ["gm", "om", "nm", "fcfm", "om_chg3", "roe", "roic", "sbc_pct"],
  Momentum: [
    "ret_1m",
    "ret_3m",
    "ret_6m",
    "ret_1y",
    "mom_rank_3m",
    "dist_hi52",
    "dist_sma200",
    "rsi14",
  ],
  Risk: ["beta", "vol_1y", "mdd_1y", "nd_ebitda", "de", "int_cov", "altman_z", "pio_f"],
  Income: ["div_yield", "bb_yield", "sh_yield", "fcf_yield", "shr_chg1", "nd_ebitda"],
};
