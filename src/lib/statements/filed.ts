// As-filed statements from the SEC Financial Statement Data Sets, published by the Filed Under
// pipeline (etl/statements.py) and read through the partner data service:
//   statements/{T}/index.json            every 10-K/10-Q since 2009 and the statements each one rendered
//   statements/{T}/{accession}.json.gz   one filing: every statement's lines (pre.txt) and values (num.txt)
//   statements/{T}/std.json.gz           per filing, the values mapped onto an industry template
//   statements/std_map.json              the five industry templates and their tag priority lists
//   kpis/{T}.json                        the company's KPI file, including its non-GAAP reconciliations
// Every value keeps the accession it was filed in, so a click opens that filing at the tagged fact.
import { queryOptions } from "@tanstack/react-query";
import { partnerFile } from "@/lib/data";

export type StmtCode = "BS" | "IS" | "CI" | "CF" | "EQ" | "UN";

export interface FiledIndexEntry {
  a: string;
  form: string;
  fy: number | null;
  fp: string | null;
  period: string;
  filed: string;
  accepted?: string;
  cik: number;
  registrant: string;
  template: TemplateId;
  sic: string | null;
  prevrpt: boolean;
  /** [report, stmt, inpth, lines] */
  reports: [number, StmtCode, number, number][];
  url: string;
}
export interface FiledIndex {
  ticker: string;
  filings: FiledIndexEntry[];
}

/** [line, tag, custom (0|1), filed label, negating (0|1), ...] */
export type FiledLine = [number, string, number, string, number, ...unknown[]];
/** [tag, ddate, qtrs, uom, segments, coregistrant, value, footnote] */
export type FiledFact = [
  string,
  string,
  number,
  string,
  string | null,
  string | null,
  number | null,
  string | null,
];

export interface FiledReport {
  report: number;
  stmt: StmtCode;
  inpth: number;
  lines: FiledLine[];
  facts: FiledFact[];
}
export interface FiledDoc {
  accession: string;
  ticker: string;
  cik: number;
  registrant: string;
  form: string;
  period: string;
  fy: number | null;
  fp: string | null;
  filed: string;
  sic: string | null;
  template: TemplateId;
  reports: FiledReport[];
  std: { lines: Record<string, unknown[][]>; unmapped: [number, number][] };
  url: string;
  source?: string;
}

export type TemplateId = "industrial" | "bank" | "insurer" | "reit" | "utility";
export interface TemplateLine {
  id: string;
  label: string;
  stmt: "IS" | "BS" | "CF";
  tags: string[];
  sign?: number;
  calc?: string;
}
export interface StdMap {
  templates: Record<TemplateId, TemplateLine[]>;
}
/** Per filing: template line id → [ddate, qtrs, value, tag | "calc", report, line, filed label][] */
export interface StdFile {
  ticker: string;
  filings: Record<
    string,
    {
      form: string;
      filed: string;
      fy: number | null;
      fp: string | null;
      period: string;
      template: TemplateId;
      lines: Record<
        string,
        [string, number, number, string, number | null, number | null, string][]
      >;
    }
  >;
}

export interface KpiValue {
  v: number;
  q?: string | null;
  quote?: string;
  printed?: string;
  doc_title?: string;
  url?: string;
  label?: string;
}
export interface KpiItem {
  id: string;
  name: string;
  unit?: string;
  parent?: string | null;
  is_total?: boolean;
  description?: string;
  category?: string;
  subcategory?: string;
  values?: Partial<Record<"Q" | "A", Record<string, KpiValue>>>;
}
export interface KpiFile {
  ticker: string;
  groups: { category: string; subcategory?: string; items: KpiItem[] }[];
}

const hour = 60 * 60 * 1000;
export const filedIndexQuery = (t: string) =>
  queryOptions({
    queryKey: ["filed", "index", t],
    queryFn: () => partnerFile<FiledIndex>(`statements/${t}/index.json`),
    staleTime: hour,
    retry: 1,
  });
export const filedDocQuery = (t: string, accession: string) =>
  queryOptions({
    queryKey: ["filed", "doc", t, accession],
    queryFn: () => partnerFile<FiledDoc>(`statements/${t}/${accession}.json.gz`),
    staleTime: 6 * hour,
    retry: 1,
  });
export const stdFileQuery = (t: string) =>
  queryOptions({
    queryKey: ["filed", "std", t],
    queryFn: () => partnerFile<StdFile>(`statements/${t}/std.json.gz`),
    staleTime: hour,
    retry: 1,
  });
export const stdMapQuery = queryOptions({
  queryKey: ["filed", "stdmap"],
  queryFn: () => partnerFile<StdMap>("statements/std_map.json"),
  staleTime: 24 * hour,
  retry: 1,
});
export const kpiFileQuery = (t: string) =>
  queryOptions({
    queryKey: ["filed", "kpi", t],
    queryFn: () => partnerFile<KpiFile>(`kpis/${t}.json`),
    staleTime: hour,
    retry: 1,
  });

export const STMT_LABEL: Record<StmtCode, string> = {
  BS: "Balance sheet",
  IS: "Income statement",
  CI: "Comprehensive income",
  CF: "Cash flow",
  EQ: "Shareholders' equity",
  UN: "Other statement",
};
export const STMT_ORDER: Record<StmtCode, number> = { IS: 1, CI: 2, BS: 3, CF: 4, EQ: 5, UN: 6 };
export const TEMPLATE_NAME: Record<TemplateId, string> = {
  industrial: "Industrial and services",
  bank: "Bank and broker-dealer",
  insurer: "Insurer",
  reit: "REIT",
  utility: "Utility",
};

const TOTAL_TAGS = new Set([
  "Assets",
  "AssetsCurrent",
  "Liabilities",
  "LiabilitiesCurrent",
  "LiabilitiesAndStockholdersEquity",
  "StockholdersEquity",
  "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
  "GrossProfit",
  "OperatingIncomeLoss",
  "NetIncomeLoss",
  "ProfitLoss",
  "Revenues",
  "CostsAndExpenses",
  "OperatingExpenses",
  "NetCashProvidedByUsedInOperatingActivities",
  "NetCashProvidedByUsedInInvestingActivities",
  "NetCashProvidedByUsedInFinancingActivities",
  "ComprehensiveIncomeNetOfTax",
  "InterestIncomeExpenseNet",
  "NoninterestIncome",
  "NoninterestExpense",
  "BenefitsLossesAndExpenses",
]);
const TOTAL_LABEL =
  /^(total|net (cash|income|earnings|increase|decrease|change|loss|revenue)|gross (profit|margin)|operating income|income before|comprehensive income)/i;
export const isTotalLine = (ln: FiledLine) => TOTAL_TAGS.has(ln[1]) || TOTAL_LABEL.test(ln[3]);
export const isTotalTemplateLine = (id: string) =>
  /total|operating$|net_income$|liab_equity|equity_parent|gross_profit|operating_income|cf_(operating|investing|financing)$/.test(
    id,
  );

/* ---------- periods ---------- */
const monthEnd = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
export function shiftMonths(d: string, k: number) {
  const [y, m] = d.split("-").map(Number);
  const t = y * 12 + (m - 1) + k;
  return monthEnd(Math.floor(t / 12), (t % 12) + 1);
}
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
/** SEC rounds period ends to month ends; qtrs = quarters covered (0 = instant). */
export const startOf = (ddate: string, qtrs: number) =>
  qtrs ? addDays(shiftMonths(ddate, -3 * qtrs), 1) : undefined;
const dayDiff = (a: string, b: string) => (Date.parse(a) - Date.parse(b)) / 86400000;

/* ---------- units and scale ---------- */
const PER_SHARE_TAGS = new Set([
  "EarningsPerShareBasic",
  "EarningsPerShareDiluted",
  "EarningsPerShareBasicAndDiluted",
  "IncomeLossFromContinuingOperationsPerBasicShare",
  "IncomeLossFromContinuingOperationsPerDilutedShare",
  "CommonStockDividendsPerShareDeclared",
  "CommonStockDividendsPerShareCashPaid",
]);
export const isPerShare = (u: string | null | undefined) => /\//.test(u ?? "");
export const isShares = (u: string | null | undefined) => /^shares$/i.test(u ?? "");
/** Some data-set EPS facts carry a currency-only unit; those exact concepts are per-share amounts. */
export function unitOf(uom: string, tag: string, custom: boolean) {
  if (!custom && PER_SHARE_TAGS.has(tag) && /^[A-Z]{3}$/.test(uom ?? "")) return `${uom}/shares`;
  return isShares(uom) ? "shares" : uom;
}
export interface FiledScale {
  money: number;
  shares: number;
}
/** The filer's rounding: the largest scale nearly every value is a whole multiple of. */
export function scaleFor(facts: FiledFact[], lines: FiledLine[]): FiledScale {
  const custom = new Set(lines.filter((ln) => ln[2]).map((ln) => ln[1]));
  const money = facts
    .filter((f) => unitOf(f[3], f[0], custom.has(f[0])) === "USD" && f[6] != null)
    .map((f) => Math.abs(f[6]!));
  const sh = facts.filter((f) => isShares(f[3]) && f[6] != null).map((f) => Math.abs(f[6]!));
  const share = (arr: number[], k: number) => arr.filter((v) => v % k === 0).length / arr.length;
  const pick = (arr: number[]) =>
    !arr.length ? 1 : share(arr, 1e6) >= 0.9 ? 1e6 : share(arr, 1e3) >= 0.9 ? 1e3 : 1;
  return { money: pick(money), shares: pick(sh) };
}
export const SCALE_WORD: Record<number, string> = { 1e6: "millions", 1e3: "thousands", 1: "units" };
export function fmtFiled(v: number | null | undefined, uom: string, sc: FiledScale) {
  if (v == null) return "";
  let x = v;
  let d = 0;
  if (isPerShare(uom)) d = 2;
  else if (isShares(uom)) x = v / sc.shares;
  else if (uom === "USD") x = v / sc.money;
  else d = Math.abs(v) < 100 && v % 1 ? 2 : 0;
  if (!isPerShare(uom) && x % 1) d = Math.min(3, String(+x.toFixed(3)).split(".")[1]?.length ?? 0);
  const s = Math.abs(x).toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
  return x < 0 ? `(${s})` : s;
}
/** USD in millions (the template view's fixed scale), per-share to two decimals. */
export function fmtMillions(v: number, perShare: boolean) {
  if (perShare) return v < 0 ? `(${Math.abs(v).toFixed(2)})` : v.toFixed(2);
  const s = Math.abs(v / 1e6).toLocaleString("en-US", {
    maximumFractionDigits: Math.abs(v) < 1e7 ? 1 : 0,
  });
  return v < 0 ? `(${s})` : s;
}

/** "Segment=Member;Axis=Member" → readable member names. */
export function memberText(seg: string | null | undefined, coreg?: string | null) {
  let items = (seg ?? "")
    .split(";")
    .filter(Boolean)
    .map((p) => p.split("="));
  if (items.length > 1)
    items = items.filter(
      ([, mem]) => !/^(OperatingSegments|SegmentReportingSegments)(Member)?$/.test(mem ?? ""),
    );
  const parts = items.map(([ax, mem]) =>
    (mem || ax)
      .replace(/Member$/, "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]{2,})([A-Z][a-z])/g, "$1 $2"),
  );
  if (coreg) parts.push(coreg.replace(/([a-z])([A-Z])/g, "$1 $2"));
  return parts.join(" · ");
}

export function filingName(
  f: Pick<FiledIndexEntry, "form" | "fp" | "fy" | "period" | "filed">,
  fmt: (d: string) => string,
) {
  const period = f.fp && f.fy ? (f.fp === "FY" ? `FY ${f.fy}` : `${f.fp} ${f.fy}`) : fmt(f.period);
  return `${f.form} · ${period} · filed ${fmt(f.filed)}`;
}

/* ---------- standardized template series ---------- */
export interface StdPoint {
  a: string;
  form: string;
  filed: string;
  d: string;
  q: number;
  v: number;
  tag: string;
  plabel: string;
}
/** For each template line and period: every filing that presented it, oldest filing first. */
export function stdSeries(std: StdFile) {
  const out: Record<string, Record<string, StdPoint[]>> = {};
  const fl = Object.entries(std.filings).sort(
    (a, b) => a[1].filed.localeCompare(b[1].filed) || a[0].localeCompare(b[0]),
  );
  for (const [a, f] of fl)
    for (const [lid, pts] of Object.entries(f.lines))
      for (const [d, q, v, tag, , , plabel] of pts) {
        const k = `${d}|${q}`;
        ((out[lid] ??= {})[k] ??= []).push({
          a,
          form: f.form,
          filed: f.filed,
          d,
          q,
          v,
          tag,
          plabel,
        });
      }
  return out;
}
export type Basis = "latest" | "first";
export interface StdValue {
  p: StdPoint;
  restated: boolean;
  /** Quarter derived as year-to-date minus the prior year-to-date */
  derived?: { from: StdPoint; minus: StdPoint };
  v: number;
}
export function periodsFor(series: Record<string, Record<string, StdPoint[]>>, kind: "A" | "Q") {
  const s = new Set<string>();
  const dur = kind === "A" ? 4 : 1;
  for (const byK of Object.values(series))
    for (const k of Object.keys(byK)) {
      const [d, q] = k.split("|");
      if (+q === dur || (kind === "Q" && +q > 1)) s.add(d);
    }
  return [...s].sort();
}
export function stdValue(
  series: Record<string, Record<string, StdPoint[]>>,
  line: TemplateLine,
  d: string,
  kind: "A" | "Q",
  basis: Basis,
): StdValue | null {
  const byK = series[line.id] ?? {};
  const pick = (list: StdPoint[]) => (basis === "first" ? list[0] : list[list.length - 1]);
  const q = line.stmt === "BS" ? 0 : kind === "A" ? 4 : 1;
  const list = byK[`${d}|${q}`];
  if (list?.length) {
    const p = pick(list);
    return { p, v: p.v, restated: list.some((x) => x.v !== list[0].v) };
  }
  if (kind === "Q" && line.stmt !== "BS" && !line.calc && !/eps|dps|shares/.test(line.id)) {
    for (let k = 2; k <= 4; k++) {
      const cur = byK[`${d}|${k}`];
      const prior = byK[`${shiftMonths(d, -3)}|${k - 1}`];
      if (cur?.length && prior?.length) {
        const a = pick(cur);
        const b = pick(prior);
        return { p: a, v: a.v - b.v, restated: false, derived: { from: a, minus: b } };
      }
    }
  }
  return null;
}
export function nearKey(byK: Record<string, StdPoint[]>, e: string, q: number) {
  if (byK[`${e}|${q}`]) return `${e}|${q}`;
  for (const k of Object.keys(byK)) {
    const [d, qq] = k.split("|");
    if (+qq === q && Math.abs(dayDiff(d, e)) <= 12) return k;
  }
  return null;
}

/* ---------- adjusted (company non-GAAP reconciliations) ---------- */
export const ADJ_FAMILIES = [
  {
    id: "op",
    name: "Adjusted operating income",
    rx: /(adjusted|non-gaap|core|underlying|base business)[^%]*(operating (income|profit|earnings)|income from operations|segment profit|\bebit\b)|(operating (income|profit)|income from operations)[^%]*(adjusted|non-gaap|excluding)/i,
    gaap: "is_operating_income",
  },
  {
    id: "eps",
    name: "Adjusted EPS",
    rx: /(adjusted|non-gaap|core|underlying|operating|base business)[^%]*(eps|earnings per (diluted )?share)|(eps|earnings per share)[^%]*(adjusted|non-gaap|excluding)/i,
    gaap: "is_eps_diluted",
  },
  { id: "ebitda", name: "Adjusted EBITDA", rx: /ebitda/i, gaap: "is_net_income" },
  { id: "fcf", name: "Free cash flow", rx: /free cash flow/i, gaap: "cf_operating" },
] as const;
export function kpiItems(kpi: KpiFile | null | undefined): KpiItem[] {
  const out: KpiItem[] = [];
  for (const g of kpi?.groups ?? [])
    for (const it of g.items)
      out.push({ ...it, category: g.category, subcategory: it.subcategory ?? g.subcategory });
  return out;
}
const nvals = (it: KpiItem, K: "Q" | "A") => Object.keys(it.values?.[K] ?? {}).length;
/** Up to two headline measures of one non-GAAP family, top-level and best covered first. */
export function pickMeasures(items: KpiItem[], rx: RegExp, K: "Q" | "A") {
  const cand = items.filter(
    (it) =>
      rx.test(it.name) &&
      !/%|pct|percent/i.test(it.unit ?? "") &&
      !/\b(margins?|growth|ratios?|per unit|guidance|outlook|segments?)\b/i.test(it.name) &&
      !/segment/i.test(it.category ?? "") &&
      nvals(it, K) > 0,
  );
  const top = cand.filter((it) => !it.parent || !cand.some((c) => c.id === it.parent));
  const kids = (id: string) => items.filter((x) => x.parent === id).length;
  top.sort(
    (a, b) =>
      Number(!!b.is_total) - Number(!!a.is_total) ||
      kids(b.id) - kids(a.id) ||
      nvals(b, K) - nvals(a, K),
  );
  return top.slice(0, 2);
}
export function fmtKpiValue(v: number, unit: string | undefined, perShare: boolean) {
  if (perShare) return v < 0 ? `(${Math.abs(v).toFixed(2)})` : v.toFixed(2);
  if (/usd/i.test(unit ?? "USD")) return fmtMillions(v, false);
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
