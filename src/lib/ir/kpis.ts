// Pure assembly of IR-sourced segment / KPI series.
//  1. optional cross-period label map (renames, merges, category / parent fixes) is applied
//  2. every (series, period) keeps all vintages — one per document that printed it
//  3. fourth quarters are derived (FY − Q1 − Q2 − Q3, else FY − nine-month YTD); fiscal years are
//     read directly or derived as the sum of four quarters
//  4. each breakdown is shown, period by period, "as reported in the latest consistent release":
//     the newest document that printed the total *and* whose printed parts add up to it. Lines that
//     release no longer shows (a recast segment structure) are hidden for that period, so every
//     column of a breakdown adds up to its total — and the check result is recorded per period.

export interface IrFact {
  id?: string;
  document_id?: string;
  document_kind?: string | null;
  category: string; // dimension, e.g. "segment", "product", "geography", "kpi", "cost"
  metric: string; // e.g. "revenue", "operating_income", "units"
  breakdown?: string | null;
  parent: string | null;
  label: string;
  is_total: boolean;
  period_start: string | null;
  period_end: string;
  months: number; // 3, 6, 9, 12; 0 = point in time
  value: number;
  unit: string;
  accn: string | null;
  doc: string | null;
  filed: string | null;
  method?: string;
  locator: { t: number; r: number; c: number; text?: string } | { page: number; box: number[]; text?: string } | Record<string, never>;
}

export interface IrPart {
  label: string;
  value: number;
  sign: 1 | -1;
  fact: IrFact;
}

export interface IrCell {
  v: number;
  fact?: IrFact;
  derived?: { formula: string; parts: IrPart[] };
}

export interface IrSeries {
  key: string;
  category: string;
  metric: string;
  label: string;
  parent: string | null;
  isTotal: boolean;
  unit: string;
  breakdown?: string | null;
  /**
   * Set when one release prints the same line with different values in several tables (bank
   * segment tables all have "Net interest income" → "Total revenue"): the table's breakdown name
   * keeps them apart, and children only roll into a total of the same scope.
   */
  scope?: string | null;
  /** Point-in-time values (balances, subscriber counts) rather than flows */
  pit?: boolean;
  cells: Record<string, IrCell>; // quarter end (YYYY-MM-DD)
  annual: Record<string, IrCell>; // fiscal-year end
}

export interface ReconcileCheck {
  group: string; // `${category}:${total label}`
  totalKey: string;
  period: string;
  kind: "q" | "fy";
  total: number;
  sum: number;
  ok: boolean;
  children: number;
  /** The release itemizes only selected lines: parts cover part of the total, never exceed it. */
  partial?: boolean;
  /** parts that add up only when these lines are subtracted (deductions printed as positives) */
  subtracted?: string[];
}

export interface LabelMapEntry {
  category: string;
  metric: string;
  label: string;
  parent: string | null;
  is_total: boolean;
  drop?: boolean;
}

/** Reconciling lines a release may print outside the table that holds the other parts. */
const BORROWABLE = /\b(elimination|eliminations|intersegment|inter-segment|corporate|reconciling|unallocated|adjustments?)\b/i;

/** Lines that reduce their total: costs, eliminations, reserves, adjustments, "less …". */
const DEDUCTION = /\b(cost|costs|expense|expenses|elimination|eliminations|intersegment|inter-segment|less|deduct|deductions|discount|discounts|allowance|provision|reserve|returns|rebates|chargebacks|adjustment|adjustments|reconciling|corporate|unallocated|impairment|amortization|depreciation|tax|taxes|interest expense|minority|noncontrolling)\b/i;

const DAY = 86_400_000;
const t = (d: string) => Date.parse(`${d}T00:00:00Z`);
const near = (a: string, b: string, days = 6) => Math.abs(t(a) - t(b)) <= days * DAY;
export const normLabel = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(net sales|net revenues?|revenues?|total)\b/g, (m) => (m === "total" ? "total" : "revenue"))
    .trim();

/** Brand names print with trademark marks ("Humulin®"); the line is the same with or without them. */
const unmark = (s: string) => s.replace(/\s*[®™©℠]+/g, "").replace(/\s{2,}/g, " ").trim();

/** Identity of a raw extracted line, used to key the label map. */
export const rawKey = (f: Pick<IrFact, "category" | "metric" | "unit" | "label" | "parent">) => `${f.category}|${f.metric}|${f.unit}|${normLabel(f.label)}|${normLabel(f.parent ?? "")}`;

/** A line is its dimension, label and the total it rolls into (the same label can appear in two tables). */
const seriesKey = (f: Pick<IrFact, "category" | "metric" | "label" | "unit" | "parent">) => `${f.category}|${f.metric}|${normLabel(f.label)}|${f.unit}|${normLabel(f.parent ?? "")}`;
const docOf = (f: IrFact) => f.document_id ?? f.accn ?? "doc";
const FLOW_UNITS = new Set(["usd", "count", "other"]);
/** Lines that can't be negative: a negative derived value means mismatched vintages, not data. */
const NONNEG_METRICS = new Set(["revenue", "units", "users", "volume", "backlog", "assets", "deposits", "loans", "aum", "headcount", "stores"]);

/** Snap a period end to an existing grid date within a few days (52/53-week filers). */
function snap(ends: string[], d: string) {
  return ends.find((e) => near(e, d)) ?? d;
}

export function applyLabelMap(facts: IrFact[], map: Record<string, LabelMapEntry> | undefined): IrFact[] {
  if (!map) return facts;
  const out: IrFact[] = [];
  for (const f of facts) {
    const m = map[rawKey(f)];
    if (!m) out.push(f);
    else if (!m.drop) out.push({ ...f, category: m.category, metric: m.metric, label: m.label, parent: m.parent, is_total: m.is_total });
  }
  return out;
}

interface Vintage {
  v: number;
  fact?: IrFact;
  derived?: IrCell["derived"];
  doc: string;
  filed: string;
  /** subtotal rebuilt from its printed parts — never counted as a reconciliation check */
  synthetic?: boolean;
}

/** Fiscal-year end month (1-12): the most common end month among 12-month periods (trailing-twelve-month columns are rarer). */
export function fiscalYearEndMonth(facts: IrFact[]): number | null {
  const n = new Map<number, number>();
  for (const f of facts) if (f.months === 12) n.set(Number(f.period_end.slice(5, 7)), (n.get(Number(f.period_end.slice(5, 7))) ?? 0) + 1);
  const best = [...n.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : null;
}

const monthNear = (d: string, m: number) => {
  const dm = Number(d.slice(5, 7));
  const day = Number(d.slice(8, 10));
  return dm === m || (dm === (m % 12) + 1 && day <= 7) || (dm === ((m + 10) % 12) + 1 && day >= 24);
};

/** Row labels that only name the metric ("Net sales", "Total revenue, net of interest expense"). */
const GENERIC_LINE = new Set([
  "revenue",
  "total revenue",
  "sales",
  "total sales",
  "revenue net of interest expense",
  "total revenue net of interest expense",
  "operating profit",
  "operating income",
  "total operating income",
  "segment profit",
  "segment operating profit",
  "segment operating income",
]);
const NOT_A_SEGMENT = /^(non[- ]?gaap|gaap|as reported|reported|adjusted|comparable|unaudited|continued|cont|in (millions|billions|thousands)|quarterly|annual|ytd|year to date|(three|six|nine|twelve) months|fy|q\d|total|consolidated|summary|detail)\b/i;

/** The business a per-segment table is about: "Revenue by reportable segment — Aeronautics", "Consumer Banking results". */
export function segmentOfBreakdown(bd: string | null | undefined): string | null {
  if (!bd) return null;
  const tail = bd.match(/\s[—–-]\s+(.+)$/) ?? bd.match(/:\s*(.+)$/);
  let seg = tail?.[1]?.trim() ?? null;
  if (!seg) {
    const head = bd.match(/^(.+?)\s+(?:segment\s+)?(?:results|revenues?(?:\s+by\s+.+)?|net revenues?|sales|financial (?:results|highlights)|highlights|key metrics)$/i);
    seg = head?.[1]?.trim() ?? null;
    if (seg && /^(revenues?|net revenues?|net sales|sales|total|segment|consolidated|company|business|income|operating)\b/i.test(seg)) seg = null;
  }
  if (!seg || seg.length > 60 || !/[a-z]/i.test(seg) || NOT_A_SEGMENT.test(seg)) return null;
  return seg;
}

/**
 * Releases often print one small table per segment whose rows only say "Net sales" or "Total
 * revenue"; the segment is in the table title. When a release has such tables for at least two
 * segments, name each generic row after its segment so it lines up with the segment summary
 * instead of stacking several identical "Net sales" lines under one total.
 */
export function qualifyGenericLines(facts: IrFact[]): IrFact[] {
  const segs = new Map<string, Set<string>>();
  const gkey = (f: IrFact) => `${docOf(f)}|${f.category}|${f.metric}|${normLabel(f.label)}`;
  for (const f of facts) {
    if (!GENERIC_LINE.has(normLabel(f.label))) continue;
    const seg = segmentOfBreakdown(f.breakdown);
    if (!seg) continue;
    const k = gkey(f);
    if (!segs.has(k)) segs.set(k, new Set());
    segs.get(k)!.add(normLabel(seg));
  }
  const rename = new Map<string, string>(); // doc|breakdown|generic label → segment
  for (const f of facts) {
    if (!GENERIC_LINE.has(normLabel(f.label)) || (segs.get(gkey(f))?.size ?? 0) < 2) continue;
    const seg = segmentOfBreakdown(f.breakdown)!;
    rename.set(`${docOf(f)}|${f.breakdown}|${normLabel(f.label)}`, seg);
  }
  if (!rename.size) return facts;
  return facts.map((f) => {
    const own = rename.get(`${docOf(f)}|${f.breakdown}|${normLabel(f.label)}`);
    const par = f.parent ? rename.get(`${docOf(f)}|${f.breakdown}|${normLabel(f.parent)}`) : undefined;
    if (!own && !par) return f;
    return { ...f, ...(own ? { label: own } : {}), ...(par ? { parent: par } : {}) };
  });
}

/** Geography of a U.S. / international / worldwide column set, from the table's breakdown name. */
export function geoOfBreakdown(bd: string | null | undefined): "U.S." | "International" | "Worldwide" | null {
  const raw = (bd ?? "").toLowerCase();
  const t = ` ${raw.replace(/[’']/g, "").replace(/[^a-z.\- ]+/g, " ")} `;
  if (/\b(outside (the )?u\.?s\.?|ex[- ]u\.?s\.?|non[- ]u\.?s\.?|international|intl\.?|rest of (the )?world|row)(\s|$)/.test(t)) return "International";
  if (/\b(global|worldwide|world wide|total company)\b/.test(t) || /[—–-]\s*total\.?\s*$/.test(raw.trim())) return "Worldwide";
  if (/(^|\s)(u\.s\.?|us|united states|domestic)(\s|$)/.test(t)) return "U.S.";
  return null;
}

/**
 * Pharma releases print each product's U.S., international and worldwide sales side by side
 * under one label. When a release has the same line in two or more of those column sets, the U.S.
 * and international values become "— U.S." / "— International" lines (with their totals), and
 * the worldwide value keeps the plain label, so the three never collide.
 */
export function splitGeoColumns(facts: IrFact[]): IrFact[] {
  const geos = new Map<string, Set<string>>();
  const k = (f: IrFact) => `${docOf(f)}|${f.category}|${f.metric}|${normLabel(f.label)}|${f.period_end}|${f.months}`;
  for (const f of facts) {
    const g = geoOfBreakdown(f.breakdown);
    if (!g) continue;
    const key = k(f);
    if (!geos.has(key)) geos.set(key, new Set());
    geos.get(key)!.add(g);
  }
  const splitDocs = new Set<string>();
  for (const [key, set] of geos) if (set.size >= 2) splitDocs.add(key.split("|")[0]);
  if (!splitDocs.size) return facts;
  return facts.map((f) => {
    if (!splitDocs.has(docOf(f))) return f;
    const g = geoOfBreakdown(f.breakdown);
    if (!g || g === "Worldwide") return f;
    return { ...f, label: `${f.label} — ${g}`, parent: f.parent ? `${f.parent} — ${g}` : null };
  });
}

/**
 * KPI tables often print a period-end count next to the change in the period under one label
 * ("Customer relationships": 31,339 and net additions 370). The period-end value is the line;
 * flows under the same label become their own "— net change" line so the two never mix.
 */
export function splitStockAndFlow(facts: IrFact[]): IrFact[] {
  const lk = (f: IrFact, label: string) => `${f.category}|${f.metric}|${f.unit}|${normLabel(label)}`;
  const stock = new Set<string>();
  const flow = new Set<string>();
  for (const f of facts) {
    if (f.unit === "pct" || f.unit === "ratio") continue;
    (f.months === 0 ? stock : flow).add(lk(f, f.label));
  }
  const mixed = new Set([...stock].filter((k) => flow.has(k)));
  if (!mixed.size) return facts;
  return facts.map((f) => {
    if (f.months === 0) return f;
    const own = mixed.has(lk(f, f.label));
    const par = !!f.parent && mixed.has(lk(f, f.parent));
    if (!own && !par) return f;
    return { ...f, ...(own ? { label: `${f.label} — net change` } : {}), ...(par ? { parent: `${f.parent} — net change` } : {}) };
  });
}

/**
 * A line can only be counted once in its total. When the same line arrives from several tables of a
 * release (Coca-Cola prints each segment's third-party, intersegment and total revenue), take every
 * part from one table: the table whose parts come closest to the printed total.
 */
function oneTablePerLine(members: IrSeries[], val: (s: IrSeries) => number, total: number): IrSeries[] {
  const labels = new Set(members.map((k) => normLabel(k.label)));
  if (labels.size === members.length) return members;
  let best: { set: IrSeries[]; err: number } | null = null;
  for (const sc of new Set(members.map((k) => k.scope ?? ""))) {
    const pick = new Map<string, IrSeries>();
    for (const k of members) {
      const l = normLabel(k.label);
      const cur = pick.get(l);
      if (!cur || ((k.scope ?? "") === sc && (cur.scope ?? "") !== sc)) pick.set(l, k);
    }
    const set = [...pick.values()];
    const err = Math.abs(set.reduce((n, k) => n + val(k), 0) - total);
    if (!best || err < best.err) best = { set, err };
  }
  return best!.set;
}

const tableOf = (f: IrFact) => {
  const l = f.locator as { t?: number; p?: number } | null | undefined;
  return l?.t ?? (l?.p != null ? `p${l.p}` : null);
};

/**
 * Utilities and conglomerates print one table per subsidiary with identical rows (Duke Energy:
 * "Commercial", "Industrial", "Total Retail Sales" for the parent and five operating companies).
 * When the breakdown name doesn't tell them apart, keep the table with the largest values — the
 * consolidated one — so subsidiaries' numbers never mix into the company series.
 */
export function dropRepeatedTables(facts: IrFact[]): IrFact[] {
  const groups = new Map<string, Map<string | number, IrFact[]>>();
  for (const f of facts) {
    const t = tableOf(f);
    if (t == null) continue;
    const g = `${docOf(f)}|${f.category}|${f.metric}|${f.unit}|${scopeName(f.breakdown)}`;
    let m = groups.get(g);
    if (!m) groups.set(g, (m = new Map()));
    const list = m.get(t) ?? [];
    list.push(f);
    m.set(t, list);
  }
  const drop = new Set<IrFact>();
  for (const tables of groups.values()) {
    if (tables.size < 2) continue;
    const entries = [...tables].map(([t, list]) => ({
      t,
      list,
      mag: list.reduce((n, f) => n + Math.abs(f.value), 0),
      vals: new Map(list.map((f) => [`${normLabel(f.label)}|${f.period_end}|${f.months}`, f.value])),
    }));
    entries.sort((a, b) => b.mag - a.mag);
    const kept: typeof entries = [];
    for (const e of entries) {
      const clash = kept.some((k) => {
        let n = 0;
        for (const [key, v] of e.vals) {
          const kv = k.vals.get(key);
          if (kv != null && Math.abs(kv - v) > Math.max(Math.abs(kv) * 0.001, 1)) n++;
        }
        return n >= 2;
      });
      if (clash) for (const f of e.list) drop.add(f);
      else kept.push(e);
    }
  }
  return drop.size ? facts.filter((f) => !drop.has(f)) : facts;
}

/**
 * Totals whose listed lines never add up in any period (at least three tries, every one off by more
 * than 2%): the hierarchy came from a mislabelled table, so those lines aren't parts of that total.
 */
export function neverTies(checks: ReconcileCheck[]): Set<string> {
  const by = new Map<string, { n: number; close: number }>();
  for (const c of checks) {
    if (c.partial) continue;
    const r = by.get(c.totalKey) ?? { n: 0, close: 0 };
    r.n++;
    if (c.ok || Math.abs(c.sum - c.total) <= Math.abs(c.total) * 0.02) r.close++;
    by.set(c.totalKey, r);
  }
  return new Set([...by].filter(([, r]) => r.n >= 3 && r.close === 0).map(([k]) => k));
}

export function buildIrSeries(
  input: IrFact[],
  opts: { labelMap?: Record<string, LabelMapEntry>; fyEndMonth?: number | null; unlink?: Set<string> } = {},
): { series: IrSeries[]; quarters: string[]; years: string[]; checks: ReconcileCheck[] } {
  const mapped = dropRepeatedTables(splitStockAndFlow(splitGeoColumns(qualifyGenericLines(applyLabelMap(input, opts.labelMap).filter((f) => Number.isFinite(f.value))))));
  // Trailing-twelve-month columns ending mid-year are not fiscal years.
  const fyEnd = opts.fyEndMonth ?? fiscalYearEndMonth(mapped);
  const facts = fyEnd ? mapped.filter((f) => f.months !== 12 || monthNear(f.period_end, fyEnd)) : mapped;

  // Period grids: quarter ends (3-month and point-in-time values) and fiscal-year ends.
  const quarters: string[] = [];
  for (const f of facts.filter((x) => x.months === 3).sort((a, b) => a.period_end.localeCompare(b.period_end))) {
    if (!quarters.some((e) => near(e, f.period_end))) quarters.push(f.period_end);
  }
  const years: string[] = [];
  for (const f of facts.filter((x) => x.months === 12).sort((a, b) => a.period_end.localeCompare(b.period_end))) {
    const e = snap(quarters, f.period_end);
    if (!years.some((y) => near(y, e))) years.push(e);
  }
  for (const y of years) if (!quarters.some((e) => near(e, y))) quarters.push(y);
  for (const f of facts.filter((x) => x.months === 0)) if (!quarters.some((e) => near(e, f.period_end, 20))) quarters.push(f.period_end);
  quarters.sort();
  years.sort();

  // All vintages per series and period, newest filing first.
  const bySeries = new Map<string, IrSeries>();
  const qv = new Map<string, Map<string, Vintage[]>>(); // quarterly (3M or point in time)
  const fv = new Map<string, Map<string, Vintage[]>>(); // fiscal year
  const nine = new Map<string, IrFact[]>();
  const votes = new Map<string, { total: number; n: number; breakdown: Map<string, number>; parent: Map<string, number> }>();
  const push = (m: Map<string, Map<string, Vintage[]>>, key: string, end: string, v: Vintage) => {
    let per = m.get(key);
    if (!per) m.set(key, (per = new Map()));
    const list = per.get(end) ?? [];
    list.push(v);
    per.set(end, list);
  };
  // Lines printed with different values in two tables of one release need their table scope.
  const conflicts = new Set<string>();
  const firstVal = new Map<string, number>();
  for (const f of facts) {
    const ck = `${seriesKey(f)}|${docOf(f)}|${f.period_end}|${f.months}`;
    const prev = firstVal.get(ck);
    if (prev == null) firstVal.set(ck, f.value);
    else if (Math.abs(prev - f.value) > Math.max(Math.abs(prev) * 0.001, 1)) conflicts.add(seriesKey(f));
  }
  const scopeOf = (f: IrFact) => (conflicts.has(seriesKey(f)) ? scopeName(f.breakdown) || "unscoped" : null);
  for (const f of facts) {
    const scope = scopeOf(f);
    const key = scope ? `${seriesKey(f)}|@${scope}` : seriesKey(f);
    let s = bySeries.get(key);
    if (!s) {
      s = { key, category: f.category, metric: f.metric, label: unmark(f.label), parent: f.parent && unmark(f.parent), isTotal: f.is_total, unit: f.unit, scope, cells: {}, annual: {} };
      bySeries.set(key, s);
      votes.set(key, { total: 0, n: 0, breakdown: new Map(), parent: new Map() });
    }
    const vt = votes.get(key)!;
    vt.n++;
    if (f.is_total) vt.total++;
    if (f.breakdown) vt.breakdown.set(f.breakdown, (vt.breakdown.get(f.breakdown) ?? 0) + 1);
    vt.parent.set(f.parent ?? "", (vt.parent.get(f.parent ?? "") ?? 0) + 1);
    const vin: Vintage = { v: f.value, fact: f, doc: docOf(f), filed: f.filed ?? "" };
    if (f.months === 3) push(qv, key, snap(quarters, f.period_end), vin);
    else if (f.months === 0) {
      s.pit = true;
      push(qv, key, quarters.find((e) => near(e, f.period_end, 20)) ?? f.period_end, vin);
    } else if (f.months === 12) push(fv, key, snap(years, f.period_end), vin);
    else if (f.months === 9) nine.set(key, [...(nine.get(key) ?? []), f]);
  }
  const top = <K>(m: Map<K, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  for (const s of bySeries.values()) {
    const vt = votes.get(s.key)!;
    s.isTotal = vt.total * 2 >= vt.n;
    s.breakdown = top(vt.breakdown) ?? null;
    s.parent = top(vt.parent) || null;
  }
  mergeFlattened(bySeries, qv, fv, nine);
  for (const m of [qv, fv]) for (const per of m.values()) for (const list of per.values()) list.sort((a, b) => b.filed.localeCompare(a.filed));

  // Latest vintage per cell.
  for (const s of bySeries.values()) {
    // Prefer a printed value over a rebuilt subtotal from the same filing date.
    const pick = (list: Vintage[]) => list.find((v) => !v.synthetic && v.filed === list[0].filed) ?? list[0];
    for (const [end, list] of qv.get(s.key) ?? []) {
      const v = pick(list);
      s.cells[end] = { v: v.v, fact: v.fact, derived: v.derived };
    }
    for (const [end, list] of fv.get(s.key) ?? []) {
      const v = pick(list);
      s.annual[end] = { v: v.v, fact: v.fact, derived: v.derived };
    }
  }

  // Fourth quarters: FY − (Q1+Q2+Q3), else FY − 9M YTD. Never for ratios, percentages or balances.
  for (const s of bySeries.values()) {
    if (s.pit || !FLOW_UNITS.has(s.unit)) continue;
    for (const [fyEnd, list] of fv.get(s.key) ?? []) {
      const fy = list.find((v) => v.fact)?.fact;
      if (!fy) continue;
      const q4 = snap(quarters, fyEnd);
      if (s.cells[q4]) continue;
      const start = fy.period_start ?? new Date(t(fy.period_end) - 364 * DAY).toISOString().slice(0, 10);
      const qs = Object.entries(s.cells)
        .filter(([end, c]) => c.fact && t(end) > t(start) && t(end) < t(fy.period_end) - 40 * DAY)
        .sort(([a], [b]) => a.localeCompare(b));
      const fyPart: IrPart = { label: `Fiscal year ending ${fy.period_end}`, value: fy.value, sign: 1, fact: fy };
      let cell: IrCell | null = null;
      if (qs.length === 3) {
        cell = {
          v: fy.value - qs.reduce((n, [, c]) => n + c.v, 0),
          derived: { formula: "Full year − Q1 − Q2 − Q3", parts: [fyPart, ...qs.map(([end, c]) => ({ label: `Quarter ending ${end}`, value: c.v, sign: -1 as const, fact: c.fact! }))] },
        };
      } else {
        const ytd = (nine.get(s.key) ?? []).filter((y) => t(y.period_end) < t(fy.period_end) && t(y.period_end) > t(fy.period_end) - 120 * DAY).sort((a, b) => (b.filed ?? "").localeCompare(a.filed ?? ""))[0];
        if (ytd) cell = { v: fy.value - ytd.value, derived: { formula: "Full year − nine-month YTD", parts: [fyPart, { label: `Nine months ending ${ytd.period_end}`, value: ytd.value, sign: -1, fact: ytd }] } };
      }
      if (!cell || (cell.v < 0 && NONNEG_METRICS.has(s.metric))) continue;
      s.cells[q4] = cell;
      push(qv, s.key, q4, { v: cell.v, derived: cell.derived, doc: "derived", filed: fy.filed ?? "" });
    }
  }

  // Fiscal years not printed: sum of the four quarters inside the year.
  for (const s of bySeries.values()) {
    for (const fyEnd of years) {
      if (s.annual[fyEnd]) continue;
      if (s.pit) {
        const c = s.cells[snap(quarters, fyEnd)];
        if (c) {
          s.annual[fyEnd] = c;
          push(fv, s.key, fyEnd, { v: c.v, fact: c.fact, derived: c.derived, doc: c.fact ? docOf(c.fact) : "derived", filed: c.fact?.filed ?? "" });
        }
        continue;
      }
      if (!FLOW_UNITS.has(s.unit)) continue;
      const qs = quarters.filter((e) => t(e) <= t(fyEnd) + 6 * DAY && t(e) > t(fyEnd) - 360 * DAY).slice(-4);
      if (qs.length !== 4 || !qs.every((e) => s.cells[e])) continue;
      const parts = qs.map((e) => ({ e, c: s.cells[e] }));
      const cell: IrCell = {
        v: parts.reduce((n, p) => n + p.c.v, 0),
        derived: {
          formula: "Q1 + Q2 + Q3 + Q4",
          parts: parts.flatMap((p) => (p.c.fact ? [{ label: `Quarter ending ${p.e}`, value: p.c.v, sign: 1 as const, fact: p.c.fact }] : (p.c.derived?.parts ?? []))),
        },
      };
      s.annual[fyEnd] = cell;
      push(fv, s.key, fyEnd, { v: cell.v, derived: cell.derived, doc: "derived-fy", filed: "" });
    }
  }

  const series = [...bySeries.values()];
  borrowTotals(series, qv, fv);
  inferSubtotals(series);
  splitDoubleBreakdowns(series, qv, fv);
  if (opts.unlink?.size) {
    const cut = series.filter((s) => opts.unlink!.has(s.key)).flatMap((t) => childrenOf(series, t));
    for (const k of cut) k.parent = null;
  }

  // Per-period vintage choice and reconciliation, top-down from each root total.
  const checks: ReconcileCheck[] = [];
  const kidsMemo = new Map<IrSeries, IrSeries[]>();
  const kidsOf = (s: IrSeries) => {
    let k = kidsMemo.get(s);
    if (!k) kidsMemo.set(s, (k = childrenOf(series, s)));
    return k;
  };
  const byParent = new Map<string, IrSeries[]>();
  for (const x of series) {
    if (!x.parent) continue;
    const k = `${x.category}|${x.metric}|${x.unit}|${normLabel(x.parent)}`;
    byParent.set(k, [...(byParent.get(k) ?? []), x]);
  }
  const tol = (v: number) => Math.max(Math.abs(v) * 0.005, 1.5e6);
  const tolFor = (s: IrSeries, v: number) => (s.unit === "usd" ? tol(v) : Math.max(Math.abs(v) * 0.005, 1.5));

  for (const kind of ["q", "fy"] as const) {
    const store = kind === "q" ? qv : fv;
    const cellsOf = (s: IrSeries) => (kind === "q" ? s.cells : s.annual);
    const fromDoc = (s: IrSeries, end: string, doc: string) => store.get(s.key)?.get(end)?.find((x) => x.doc === doc);

    /** Evaluate a subtree for one period using one document's printed values. */
    const evaluate = (node: IrSeries, end: string, doc: string, out: ReconcileCheck[], apply: boolean): boolean => {
      const own = fromDoc(node, end, doc);
      if (apply && own) cellsOf(node)[end] = { v: own.v, fact: own.fact, derived: own.derived };
      const value = own?.v ?? cellsOf(node)[end]?.v;
      if (!kidsOf(node).length || value == null) return true;
      // A subtotal introduced later (Alphabet's "Google" = Services + Cloud from 2025) has no value
      // in older periods: its own parts then roll straight into this total.
      const flatKids = (n: IrSeries, depth: number): IrSeries[] =>
        kidsOf(n).flatMap((k) => (depth < 3 && !fromDoc(k, end, doc) && !cellsOf(k)[end] && kidsOf(k).length ? flatKids(k, depth + 1) : [k]));
      const kids = flatKids(node, 0);
      const inDoc = kids.filter((k) => fromDoc(k, end, doc));
      let members: IrSeries[];
      if (inDoc.length >= 2) {
        members = inDoc;
        if (apply) for (const k of kids) if (!inDoc.includes(k)) delete cellsOf(k)[end];
      } else {
        members = kids.filter((k) => cellsOf(k)[end]);
      }
      members = oneTablePerLine(members, (k) => fromDoc(k, end, doc)?.v ?? cellsOf(k)[end]?.v ?? 0, value);
      let ok = true;
      for (const k of members) {
        const childDoc = fromDoc(k, end, doc) ? doc : (store.get(k.key)?.get(end)?.[0]?.doc ?? doc);
        ok = evaluate(k, end, childDoc, out, apply) && ok;
      }
      if (members.length >= 2 && node.isTotal && !own?.synthetic && (node.unit === "usd" || node.unit === "count")) {
        const vals = members.map((k) => fromDoc(k, end, doc)?.v ?? cellsOf(k)[end]?.v ?? 0);
        let sum = vals.reduce((n, v) => n + v, 0);
        let pass = Math.abs(sum - value) <= tolFor(node, value);
        let subtracted: string[] | undefined;
        if (!pass && node.scope) {
          // A scoped total (one table of a transposed segment grid) can miss a reconciling line that
          // the release prints in a neighbouring table — Coca-Cola's "Eliminations" column.
          const have = new Set(members.map((k) => normLabel(k.label)));
          const extra = (byParent.get(`${node.category}|${node.metric}|${node.unit}|${normLabel(node.label)}`) ?? []).find((k) => {
            if (have.has(normLabel(k.label)) || !BORROWABLE.test(k.label)) return false;
            const v = fromDoc(k, end, doc)?.v ?? cellsOf(k)[end]?.v;
            return v != null && Math.abs(sum + v - value) <= tolFor(node, value);
          });
          if (extra) {
            sum += fromDoc(extra, end, doc)?.v ?? cellsOf(extra)[end]!.v;
            pass = true;
          }
        }
        if (!pass) {
          // Deductions printed without parentheses ("Revenue 100, Cost of sales 60, Gross profit 40").
          const i = members.findIndex((k, j) => vals[j] > 0 && DEDUCTION.test(k.label) && Math.abs(sum - 2 * vals[j] - value) <= tolFor(node, value));
          if (i >= 0) {
            sum -= 2 * vals[i];
            pass = true;
            subtracted = [members[i].label];
          }
        }
        out.push({ group: `${node.category}:${node.label}`, totalKey: node.key, period: end, kind, total: value, sum, ok: pass, children: members.length, ...(subtracted ? { subtracted } : {}) });
        ok = ok && pass;
      }
      return ok;
    };

    const roots = series.filter((s) => s.isTotal && kidsOf(s).length && !series.some((p) => p !== s && kidsOf(p).includes(s)));
    for (const root of roots) {
      for (const end of Object.keys(cellsOf(root))) {
        const vintages = store.get(root.key)?.get(end) ?? [];
        let chosen = vintages[0]?.doc;
        for (const v of vintages) {
          const trial: ReconcileCheck[] = [];
          if (evaluate(root, end, v.doc, trial, false) && trial.length) {
            chosen = v.doc;
            break;
          }
        }
        if (!chosen) continue;
        evaluate(root, end, chosen, checks, true);
      }
    }
  }
  markPartialLists(checks, series);
  return { series, quarters, years, checks };
}

/**
 * "Selected products" tables list some lines and the total without an "other" line, so the parts
 * always fall short. When a total's misses are (almost) all short — never over — and they're most
 * of its checks, or the table says "selected", flag them as partial lists instead of errors.
 */
export function markPartialLists(checks: ReconcileCheck[], series: IrSeries[]) {
  const byTotal = new Map<string, ReconcileCheck[]>();
  for (const c of checks) byTotal.set(c.totalKey, [...(byTotal.get(c.totalKey) ?? []), c]);
  const byKey = new Map(series.map((x) => [x.key, x]));
  for (const [key, list] of byTotal) {
    const bad = list.filter((c) => !c.ok);
    if (!bad.length) continue;
    const short = bad.filter((c) => c.sum < c.total && c.sum > 0 && c.sum >= c.total * 0.2);
    const kids = childrenOf(series, byKey.get(key)!);
    const selected = /selected|key product|select /i.test(`${byKey.get(key)?.breakdown ?? ""} ${kids.map((k) => k.breakdown ?? "").join(" ")}`);
    if (short.length === bad.length && (selected || bad.length >= list.length * 0.8)) for (const c of short) c.partial = true;
  }
}

/**
 * Some releases print a line under its subtotal ("iPhone" under "Products"), others flatten the
 * table and put it straight under the grand total. When the other parent is itself a child of that
 * grand total, both are the same line: merge the flattened copy into the nested one, then rebuild
 * the missing subtotal for those releases from the parts they printed (marked synthetic).
 */
function mergeFlattened(bySeries: Map<string, IrSeries>, qv: Map<string, Map<string, Vintage[]>>, fv: Map<string, Map<string, Vintage[]>>, nine: Map<string, IrFact[]>) {
  const dim = (s: IrSeries) => `${s.category}|${s.metric}|${s.unit}|${s.scope ?? ""}`;
  const byLabel = new Map<string, IrSeries[]>();
  for (const s of bySeries.values()) {
    const k = `${dim(s)}|${normLabel(s.label)}`;
    byLabel.set(k, [...(byLabel.get(k) ?? []), s]);
  }
  const parentsOf = (d: string, label: string) => new Set((byLabel.get(`${d}|${normLabel(label)}`) ?? []).map((x) => normLabel(x.parent ?? "")));
  const nested = new Set<IrSeries>();
  for (const list of byLabel.values()) {
    if (list.length < 2) continue;
    for (const deep of list) {
      if (!deep.parent) continue;
      for (const flat of list) {
        if (flat === deep || !bySeries.has(flat.key) || !bySeries.has(deep.key)) continue;
        // deep.parent must itself roll into flat.parent
        if (!parentsOf(dim(deep), deep.parent).has(normLabel(flat.parent ?? ""))) continue;
        for (const m of [qv, fv]) {
          const src = m.get(flat.key);
          if (!src) continue;
          let dst = m.get(deep.key);
          if (!dst) m.set(deep.key, (dst = new Map()));
          for (const [end, vs] of src) dst.set(end, [...(dst.get(end) ?? []), ...vs]);
          m.delete(flat.key);
        }
        if (nine.has(flat.key)) nine.set(deep.key, [...(nine.get(deep.key) ?? []), ...nine.get(flat.key)!]);
        nine.delete(flat.key);
        bySeries.delete(flat.key);
        const sub = (byLabel.get(`${dim(deep)}|${normLabel(deep.parent)}`) ?? []).find((x) => bySeries.has(x.key) && normLabel(x.parent ?? "") === normLabel(flat.parent ?? ""));
        if (sub) {
          sub.isTotal = true;
          nested.add(sub);
        }
      }
    }
  }
  // Rebuild each nested subtotal for releases that printed its parts but not the subtotal itself.
  for (const sub of nested) {
    if (!FLOW_UNITS.has(sub.unit)) continue;
    const kids = [...bySeries.values()].filter((k) => k !== sub && dim(k) === dim(sub) && k.parent && normLabel(k.parent) === normLabel(sub.label));
    if (kids.length < 2) continue;
    for (const m of [qv, fv]) {
      const ends = new Set(kids.flatMap((k) => [...(m.get(k.key)?.keys() ?? [])]));
      for (const end of ends) {
        const have = new Set((m.get(sub.key)?.get(end) ?? []).map((v) => v.doc));
        const docs = new Set(kids.flatMap((k) => (m.get(k.key)?.get(end) ?? []).map((v) => v.doc)));
        for (const doc of docs) {
          if (have.has(doc) || doc.startsWith("derived")) continue;
          const parts = kids.flatMap((k) => (m.get(k.key)?.get(end) ?? []).filter((v) => v.doc === doc && v.fact).map((v) => ({ k, v })));
          if (parts.length < 2) continue;
          const v = parts.reduce((n, p) => n + p.v.v, 0);
          let per = m.get(sub.key);
          if (!per) m.set(sub.key, (per = new Map()));
          per.set(end, [
            ...(per.get(end) ?? []),
            {
              v,
              doc,
              filed: parts[0].v.filed,
              synthetic: true,
              derived: { formula: "Sum of the components printed in this release", parts: parts.map((p) => ({ label: p.k.label, value: p.v.v, sign: 1 as const, fact: p.v.fact! })) },
            },
          ]);
        }
      }
    }
  }
}

/**
 * A second breakdown of the same total (revenue by product type next to revenue by segment) lives
 * in its own category but names the shared total as parent. Give that category a copy of the total.
 */
function borrowTotals(series: IrSeries[], qv: Map<string, Map<string, Vintage[]>>, fv: Map<string, Map<string, Vintage[]>>) {
  const has = new Set(series.filter((s) => s.isTotal).map((s) => `${s.category}|${s.metric}|${s.unit}|${normLabel(s.label)}`));
  const wanted = new Map<string, IrSeries>();
  for (const s of series) {
    if (!s.parent) continue;
    const k = `${s.category}|${s.metric}|${s.unit}|${normLabel(s.parent)}`;
    if (has.has(k) || wanted.has(k)) continue;
    const src = series.find((t) => t.isTotal && t.metric === s.metric && t.unit === s.unit && t.category !== s.category && normLabel(t.label) === normLabel(s.parent!));
    if (src) wanted.set(k, { ...src, key: `${src.key}#in:${s.category}`, category: s.category, cells: { ...src.cells }, annual: { ...src.annual } });
  }
  for (const copy of wanted.values()) {
    const base = copy.key.split("#in:")[0];
    series.push(copy);
    if (qv.has(base)) qv.set(copy.key, qv.get(base)!);
    if (fv.has(base)) fv.set(copy.key, fv.get(base)!);
  }
}

/** Scopes of the totals carrying each label, cached per series list (rebuilt when it grows). */
const scopeCache = new WeakMap<IrSeries[], { n: number; m: Map<string, Set<string>> }>();
function totalScopes(series: IrSeries[]) {
  let c = scopeCache.get(series);
  if (!c || c.n !== series.length) {
    const m = new Map<string, Set<string>>();
    for (const s of series) {
      if (!s.scope) continue;
      const k = `${s.category}|${s.metric}|${s.unit}|${normLabel(s.label)}`;
      m.set(k, (m.get(k) ?? new Set()).add(s.scope));
    }
    scopeCache.set(series, (c = { n: series.length, m }));
  }
  return c.m;
}

/** Table scope from a breakdown name, ignoring filler words that vary between releases. */
export const scopeName = (bd: string | null | undefined) =>
  normLabel(bd ?? "")
    .replace(/\b(segments?|results?|summary|selected|financial|data|highlights|information|and|the|of|by|for|key|metrics|line)\b/g, " ")
    .replace((globalThis as { __noRep?: boolean }).__noRep ? /$^/ : /\b(as reported|reported|u s gaap|gaap)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** A child's table scope: its own when split, else its table's breakdown name. */
const kidScope = (s: IrSeries) => s.scope ?? scopeName(s.breakdown);

export const childrenOf = (series: IrSeries[], total: IrSeries) => {
  const scopes = totalScopes(series).get(`${total.category}|${total.metric}|${total.unit}|${normLabel(total.label)}`);
  return series.filter((s) => {
    if (s === total || s.category !== total.category || s.metric !== total.metric || s.unit !== total.unit || !s.parent || normLabel(s.parent) !== normLabel(total.label)) return false;
    if (!scopes) return true;
    // Scoped totals take the children of their own table; the unscoped one takes the rest.
    return total.scope ? kidScope(s) === total.scope : !scopes.has(kidScope(s));
  });
};

const rowOf = (c?: IrCell) => {
  const l = c?.fact?.locator as { t?: number; r?: number } | undefined;
  return l && typeof l.t === "number" && typeof l.r === "number" ? { doc: c!.fact!.doc, t: l.t, r: l.r } : null;
};

/** The parts sit in consecutive rows of the subtotal's table, directly above or below it. */
export function printedAsBlock(parts: IrSeries[], subtotal: IrSeries, end: string) {
  const k = rowOf(subtotal.cells[end]);
  if (!k) return false;
  const rows: number[] = [];
  for (const p of parts) {
    const l = rowOf(p.cells[end]);
    if (!l || l.doc !== k.doc || l.t !== k.t) return false;
    rows.push(l.r);
  }
  rows.sort((a, b) => a - b);
  if (rows[rows.length - 1] - rows[0] + 1 > rows.length + 1) return false;
  return (k.r > rows[rows.length - 1] && k.r - rows[rows.length - 1] <= 2) || (k.r < rows[0] && rows[0] - k.r <= 2);
}

/**
 * Releases often print a flat product table next to a "Products / Services" split. When one child
 * equals the sum of a subset of its siblings in every shared quarter, it is a subtotal: re-parent
 * that subset under it so totals reconcile at each level.
 */
export function inferSubtotals(series: IrSeries[]) {
  for (const total of series.filter((s) => s.isTotal)) {
    const kids = childrenOf(series, total);
    if (kids.length < 3 || kids.length > 14) continue;
    const ends = Object.keys(total.cells).filter((e) => kids.every((k) => k.cells[e]));
    if (!ends.length) continue;
    const kidSum = (e: string) => kids.reduce((n, k) => n + k.cells[e].v, 0);
    if (ends.every((e) => Math.abs(kidSum(e) - total.cells[e].v) <= Math.abs(total.cells[e].v) * 0.005)) continue;
    // Subtotals are larger than their parts: try the biggest candidates first.
    for (const k of [...kids].sort((a, b) => Math.abs(b.cells[ends[0]].v) - Math.abs(a.cells[ends[0]].v))) {
      const others = kids.filter((o) => o !== k);
      const e0 = ends[0];
      let found: IrSeries[] | null = null;
      for (let mask = 1; mask < 1 << others.length && !found; mask++) {
        const sub = others.filter((_, i) => mask & (1 << i));
        if (sub.length < 2) continue;
        const ok = ends.every((e) => Math.abs(sub.reduce((n, o) => n + o.cells[e].v, 0) - k.cells[e].v) <= Math.max(Math.abs(k.cells[e].v) * 0.002, 1e6));
        if (ok && Math.abs(sub.reduce((n, o) => n + o.cells[e0].v, 0)) > 0) found = sub;
      }
      if (found) {
        // A coincidental subset sum must not nest sibling segments: the subset has to add up to
        // the candidate in (nearly) every quarter where they're all printed, and in at least two.
        const sub = found;
        const both = Object.keys(k.cells).filter((e) => sub.every((o) => o.cells[e]));
        const hits = both.filter((e) => Math.abs(sub.reduce((n, o) => n + o.cells[e].v, 0) - k.cells[e].v) <= Math.max(Math.abs(k.cells[e].v) * 0.002, 1e6));
        const consistent = hits.length >= Math.ceil(both.length * 0.9);
        // One shared quarter is enough only when the parts are printed as a block right next to
        // the subtotal row in the same table.
        if (!consistent || (hits.length < 2 && !hits.every((e) => printedAsBlock(sub, k, e)))) continue;
        k.isTotal = true;
        for (const o of found) o.parent = k.label;
        break;
      }
    }
  }
}

/**
 * Two breakdowns of the same total (e.g. by segment and by product) are sometimes put under one
 * parent, so the children add to 2× the total. When a subset of children matches the total in every
 * quarter and the rest does too, split the rest into its own "second breakdown" group.
 */
export function splitDoubleBreakdowns(series: IrSeries[], qv?: Map<string, Map<string, Vintage[]>>, fv?: Map<string, Map<string, Vintage[]>>) {
  for (const total of series.filter((s) => s.isTotal && !s.key.endsWith("#alt"))) {
    const kids = childrenOf(series, total);
    if (kids.length < 4 || kids.length > 16) continue;
    const ends = Object.keys(total.cells).filter((e) => kids.every((k) => k.cells[e]));
    if (!ends.length) continue;
    const tol = (e: string) => Math.max(Math.abs(total.cells[e].v) * 0.005, 1.5e6);
    const sumOf = (xs: IrSeries[], e: string) => xs.reduce((n, k) => n + k.cells[e].v, 0);
    if (!ends.every((e) => Math.abs(sumOf(kids, e) - 2 * total.cells[e].v) <= 2 * tol(e))) continue;
    // Both breakdowns must be printed side by side in one release — otherwise it's a recast, not a split.
    if (qv) {
      const together = ends.some((e) => {
        const docSets = kids.map((k) => new Set((qv.get(k.key)?.get(e) ?? []).map((v) => v.doc)));
        return [...docSets[0]].some((d) => docSets.every((ds) => ds.has(d)));
      });
      if (!together) continue;
    }
    let split: IrSeries[] | null = null;
    for (let mask = 1; mask < 1 << kids.length && !split; mask++) {
      const sub = kids.filter((_, i) => mask & (1 << i));
      if (sub.length < 2 || sub.length > kids.length - 2 || !(mask & 1)) continue;
      if (ends.every((e) => Math.abs(sumOf(sub, e) - total.cells[e].v) <= tol(e))) split = kids.filter((_, i) => !(mask & (1 << i)));
    }
    if (!split) continue;
    const alt: IrSeries = { ...total, key: `${total.key}#alt`, label: `${total.label} — second breakdown`, cells: { ...total.cells }, annual: { ...total.annual } };
    series.push(alt);
    if (qv?.has(total.key)) qv.set(alt.key, qv.get(total.key)!);
    if (fv?.has(total.key)) fv.set(alt.key, fv.get(total.key)!);
    for (const k of split) k.parent = alt.label;
  }
}

/** Compare IR top-line totals against the SEC-reported statement value for the same quarter. */
export function crossCheckTotals(
  series: IrSeries[],
  reported: { end: string; v: number }[],
  metric = "revenue",
): { label: string; period: string; ir: number; sec: number; ok: boolean }[] {
  const out: { label: string; period: string; ir: number; sec: number; ok: boolean }[] = [];
  for (const s of series) {
    if (!s.isTotal || s.metric !== metric || s.unit !== "usd" || s.parent || s.key.endsWith("#alt")) continue;
    for (const [end, c] of Object.entries(s.cells)) {
      const r = reported.find((x) => near(x.end, end));
      if (!r) continue;
      out.push({ label: s.label, period: end, ir: c.v, sec: r.v, ok: Math.abs(c.v - r.v) <= Math.max(Math.abs(r.v) * 0.005, 1e6) });
    }
  }
  return out;
}
