// One table per subject (pure; runs when a payload is built and again when an older payload is
// loaded). Releases print the same breakdown under drifting names ("Medical membership - Commercial",
// "Commercial - Medical membership", "Medical membership: Commercial") and in several documents, so a
// built payload can hold several tables that are really one table split by era or by wording. This
// pass:
//   1. merges lines of one table that are the same line under another name (never in the same
//      period with different numbers),
//   2. merges tables with the same subject whose lines and total agree wherever they overlap, so an
//      old and a new era of a breakdown read as one continuous table,
//   3. drops tables that only repeat another table's numbers,
//   4. gives tables that still share a subject a title that tells them apart (Adjusted vs GAAP, or
//      the years they cover), and splits long "other lines" lists by the prefix their lines share.
// Every value keeps its own source cell: merging only moves cells between lines, it never changes a
// number or invents one.
import { METRIC_LABEL, groupTitle } from "@/lib/ir/display";
import type { IrPayload, PayloadCell, PayloadCheck, PayloadGroup, PayloadSeries } from "@/lib/ir/payload";

export const TIDY_VERSION = 2;

const STOP = new Set(["total", "totals", "the", "of", "for", "in", "on", "a", "an", "and", "by", "segment", "segments", "reportable", "measure", "line", "lines", "item", "items", "amount", "amounts", "consolidated", "reported", "as", "from", "to", "all", "per"]);
/** Years glued to a label ("… end of the period — 2024") come from a column header, not the line. */
const YEAR_TAG = /(\s*[—–-]\s*|\s*,\s*|\s+)(fy\s*|fiscal\s+(year\s+)?)?(19|20)\d{2}\s*$/i;
const singular = (w: string) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us") ? w.slice(0, -1) : w);

/** Words that name the table, not the line: a line's own name keeps them ("Reportable segment operating income"). */
const SUBJECT_ONLY = new Set(["segment", "segments", "reportable", "consolidated"]);

/** Content words of a label, without footnote marks, units, years and generic words. */
const tokenCache = new Map<string, string[]>();
export function labelTokens(label: string, keepParens = false, line = false): string[] {
  const id = `${keepParens ? 1 : 0}${line ? 1 : 0}${label}`;
  const hit = tokenCache.get(id);
  if (hit) return hit;
  if (tokenCache.size > 50_000) tokenCache.clear();
  const out = tokensOf(label, keepParens, line);
  tokenCache.set(id, out);
  return out;
}
function tokensOf(label: string, keepParens: boolean, line: boolean): string[] {
  let s = label.toLowerCase().replace(/[’']/g, "").replace(/[®™©℠]/g, "");
  s = keepParens ? s.replace(/[()]/g, " ") : s.replace(/\([^)]*\)/g, " ");
  s = s.replace(YEAR_TAG, "").replace(/&/g, " and ");
  return [...new Set(s.split(/[^a-z0-9%]+/).filter((w) => w && (!STOP.has(w) || (line && SUBJECT_ONLY.has(w))) && !/^\d$/.test(w)).map(singular))];
}

const METRIC_CONTEXT: Record<string, string[]> = {
  revenue: ["revenue", "net", "sale", "income"],
  operating_income: ["operating", "income", "loss", "profit"],
  segment_profit: ["profit", "income", "loss", "operating", "contribution"],
  gross_profit: ["gross", "profit", "margin"],
  net_income: ["net", "income", "loss", "earning"],
};

const YEAR_AT_END = /(19|20)\d{2}\s*$/;
/**
 * A line's identity inside one subject: its words minus the words every line of the subject shares.
 * A year at the end of the label is dropped only when it is the line's own period (a column header
 * glued to the label); a year that names something else (a maturity, a program) stays part of the name.
 */
const keyCache = new WeakMap<PayloadSeries, Map<Set<string>, string>>();
function memberKey(s: PayloadSeries, ctx: Set<string>) {
  let m = keyCache.get(s);
  if (!m) keyCache.set(s, (m = new Map()));
  let k = m.get(ctx);
  if (k == null) m.set(ctx, (k = computeKey(s, ctx)));
  return k;
}
/**
 * The name a line really has: a generic line ("Adjusted operating income") printed in a named table
 * ("Health Services") is that table's line, so two segments' lines never read as one.
 */
const fullName = (s: PayloadSeries) => (s.sc && !s.label.toLowerCase().includes(s.sc.toLowerCase()) ? `${s.sc} ${s.label}` : s.label);
function computeKey(s: PayloadSeries, ctx: Set<string>) {
  const own = labelTokens(fullName(s), false, true).filter((w) => !ctx.has(w));
  // "(non-GAAP)", "(annualized)", "(average)" in brackets still change what the line measures.
  for (const w of labelTokens(fullName(s), true, true)) if (MODIFIERS.has(w) && !own.includes(w) && !ctx.has(w)) own.push(w);
  if (YEAR_TAG.test(s.label) && !yearIsPeriod(s)) own.push(s.label.match(YEAR_AT_END)![0].trim());
  return own.sort().join(" ");
}
/** The label ends in the year of every period it reports (fiscal years ending in January or February count for the prior year). */
function yearIsPeriod(s: PayloadSeries) {
  const tag = Number(s.label.match(YEAR_AT_END)?.[0]);
  if (!tag || !YEAR_TAG.test(s.label)) return false;
  const ends = [...periodsOf(s)];
  return ends.length > 0 && ends.every((e) => Number(e.slice(0, 4)) === tag || (Number(e.slice(0, 4)) === tag + 1 && Number(e.slice(5, 7)) <= 2));
}

const allCells = (s: PayloadSeries): [string, Record<string, PayloadCell>][] => [
  ["q", s.q],
  ["y", s.y],
  ["mo", s.mo ?? {}],
];

interface Agreement {
  agree: number;
  /** identical printed values that are unlikely to coincide (not small whole numbers) */
  exact: number;
  conflict: number;
}
const distinctive = (v: number) => Math.abs(v) >= 1000 || (!Number.isInteger(v) && Math.abs(v) >= 1);
/** Printed values of two lines in the periods both report (calculated cells and unit-flagged cells don't count). */
function compare(a: PayloadSeries, b: PayloadSeries): Agreement {
  const r = { agree: 0, exact: 0, conflict: 0 };
  for (const [kind, ca] of allCells(a)) {
    const cb = (kind === "q" ? b.q : kind === "y" ? b.y : b.mo ?? {}) as Record<string, PayloadCell>;
    for (const e of Object.keys(ca)) {
      const x = ca[e];
      const y = cb[e];
      if (!y || x.f || y.f || x.w || y.w) continue;
      const tol = Math.max(Math.abs(x.v), Math.abs(y.v)) * 0.005 + (a.unit === "pct" || a.unit === "ratio" ? 0.05 : 0.5);
      if (Math.abs(x.v - y.v) <= tol) {
        r.agree++;
        if (x.v === y.v && distinctive(x.v)) r.exact++;
      } else r.conflict++;
    }
  }
  return r;
}

const periodCache = new WeakMap<PayloadSeries, Set<string>>();
const periodsOf = (s: PayloadSeries) => {
  let p = periodCache.get(s);
  if (!p) periodCache.set(s, (p = new Set([...Object.keys(s.q), ...Object.keys(s.y), ...Object.keys(s.mo ?? {})])));
  return p;
};
const overlaps = (a: Set<string>, b: Set<string>) => {
  for (const e of a) if (b.has(e)) return true;
  return false;
};
const wordSets = new Map<string, Set<string>>();
const wordsOf = (k: string) => {
  let w = wordSets.get(k);
  if (!w) {
    if (wordSets.size > 50_000) wordSets.clear();
    wordSets.set(k, (w = new Set(k.split(" ").filter(Boolean))));
  }
  return w;
};
const subset = (a: string, b: string) => {
  if (!a || !b) return false;
  const B = wordsOf(b);
  for (const w of wordsOf(a)) if (!B.has(w)) return false;
  return true;
};

/** Words that change what a number measures: lines differing by one of them are never the same line. */
const MODIFIERS = new Set(["change", "growth", "increase", "decrease", "yoy", "qoq", "%", "percent", "percentage", "rate", "average", "avg", "margin", "ratio", "yield", "adjusted", "non", "nongaap", "reportable", "excluding", "ex", "organic", "constant", "currency", "fx", "comparable", "same", "pro", "forma", "cumulative", "annualized", "ttm", "ltm", "daily", "monthly", "weekly", "annual", "quarterly", "share", "basis", "bp", "bps", "mix", "ending", "beginning", "opening", "closing", "net", "gross", "new", "core", "underlying", "incremental", "deferred", "unearned", "backlog", "guidance", "outlook", "estimate", "target", "prior", "previous", "next", "remaining", "count", "number"]);
const modifierGap = (a: string, b: string) => {
  if (a === b) return false;
  const A = wordsOf(a);
  const B = wordsOf(b);
  for (const w of A) if (!B.has(w) && MODIFIERS.has(w)) return true;
  for (const w of B) if (!A.has(w) && MODIFIERS.has(w)) return true;
  return false;
};

type Verdict = "same" | "clash" | "different";
/** Whether two lines of the same subject are one line: same name (after context) or the same printed numbers. */
function sameLine(a: PayloadSeries, ka: string, b: PayloadSeries, kb: string, roles: { aRoot: boolean; bRoot: boolean }): Verdict {
  if (a.unit !== b.unit || !!a.pit !== !!b.pit) return "different";
  const cmp = compare(a, b);
  if (ka === kb) {
    // Both nameless after context: only "the total" lines of two tables are the same line.
    if (!ka && !(roles.aRoot && roles.bRoot) && !(a.total && b.total)) return cmp.exact >= 2 && !cmp.conflict ? "same" : "different";
    return cmp.conflict ? "clash" : "same";
  }
  if (cmp.conflict || modifierGap(ka, kb)) return "different";
  if ((subset(ka, kb) || subset(kb, ka)) && cmp.exact >= 1) return "same";
  if (cmp.exact >= 2) return "same";
  return "different";
}

interface Ctx {
  p: IrPayload;
  byKey: Map<string, PayloadSeries>;
  alias: Map<string, string>;
  removed: Set<string>;
  /** parent key → its lines, so retiring a line re-parents its children without a full scan */
  kids: Map<string, PayloadSeries[]>;
  /** old label → merged line's label (checks list subtracted lines by label) */
  renamed: Map<string, string>;
  /** totals whose parts changed (a part merged away, or a part joined from another table) */
  touched: Set<string>;
  log?: string[];
}

/** Copy b's cells into a where a has none (a printed cell beats a calculated one), then retire b. */
function absorb(c: Ctx, a: PayloadSeries, b: PayloadSeries) {
  // The merged line takes the company's current name, unless that name says nothing on its own.
  const latest = (s: PayloadSeries) => [...periodsOf(s)].sort().at(-1) ?? "";
  const label = latest(b) > latest(a) && labelTokens(b.label).length && labelTokens(b.label).length >= Math.min(2, labelTokens(a.label).length) ? b.label : !labelTokens(a.label).length ? b.label : a.label;
  for (const [kind, cb] of allCells(b)) {
    if (!Object.keys(cb).length) continue;
    const ca = kind === "q" ? a.q : kind === "y" ? a.y : (a.mo ??= {});
    for (const [e, cell] of Object.entries(cb)) if (!ca[e] || (ca[e].f && !cell.f) || (ca[e].w && !cell.w && !cell.f)) ca[e] = cell;
  }
  if (b.total) a.total = true;
  for (const k of [a.parent, b.parent, a.k, b.k]) if (k) c.touched.add(k);
  periodCache.delete(a);
  keyCache.delete(a);
  const was = a.label;
  a.label = label;
  if (label !== was) c.renamed.set(was, label);
  if (b.label !== label) c.renamed.set(b.label, label);
  // A merged line now spans several years: a year that was only its column header goes.
  if (yearIsPeriod(a) || (YEAR_TAG.test(a.label) && YEAR_TAG.test(b.label) && yearIsPeriod(b))) a.label = a.label.replace(YEAR_TAG, "").trim() || a.label;
  c.log?.push(`${a.sc ? `[${a.sc}] ` : ""}${was}  ⇐  ${b.sc ? `[${b.sc}] ` : ""}${b.label}${a.label !== was ? `   [now “${a.label}”]` : ""}`);
  c.alias.set(b.k, a.k);
  c.removed.add(b.k);
  const moved = c.kids.get(b.k) ?? [];
  for (const s of moved) s.parent = a.k;
  if (moved.length) c.kids.set(a.k, [...(c.kids.get(a.k) ?? []), ...moved]);
  c.kids.delete(b.k);
}

const resolve = (c: Ctx, k: string) => {
  let x = k;
  for (let i = 0; i < 20 && c.alias.has(x); i++) x = c.alias.get(x)!;
  return x;
};

function subjectContext(title: string, g: PayloadGroup) {
  const ctx = new Set(labelTokens(title));
  for (const w of METRIC_CONTEXT[g.met] ?? labelTokens(METRIC_LABEL[g.met] ?? g.met)) ctx.add(w);
  return ctx;
}

/** Lines under the same parent of one table that are one line under drifting names. */
function mergeSiblings(c: Ctx, g: PayloadGroup, ctx: Set<string>) {
  const rows = g.rows.map((r) => c.byKey.get(r.k)).filter((s): s is PayloadSeries => !!s && !c.removed.has(s.k));
  const byParent = new Map<string, PayloadSeries[]>();
  for (const s of rows) {
    if (s.k === g.root) continue;
    const pk = s.parent ?? "";
    byParent.set(pk, [...(byParent.get(pk) ?? []), s]);
  }
  for (const sibs of byParent.values()) {
    // Fullest history first: the line others fold into keeps its name.
    sibs.sort((x, y) => periodsOf(y).size - periodsOf(x).size);
    for (let i = 0; i < sibs.length; i++) {
      const a = sibs[i];
      if (c.removed.has(a.k)) continue;
      const ka = memberKey(a, ctx);
      for (let j = i + 1; j < sibs.length; j++) {
        const b = sibs[j];
        if (c.removed.has(b.k)) continue;
        // Siblings both printed in one period are two lines of that table unless they carry the same numbers.
        if (sameLine(a, ka, b, memberKey(b, ctx), { aRoot: false, bRoot: false }) !== "same") continue;
        if (overlaps(periodsOf(a), periodsOf(b)) && compare(a, b).agree === 0) continue;
        absorb(c, a, b);
      }
    }
  }
}

interface Cluster {
  g: PayloadGroup;
  members: PayloadGroup[];
}

/** Words that describe how a release lays a table out, not what it measures. */
const TABLE_WORDS = new Set(["type", "types", "plan", "plans", "summary", "result", "results", "highlight", "highlights", "metric", "metrics", "kpi", "kpis", "key", "statistic", "statistics", "selected", "supplemental", "information", "data", "quarterly", "annual", "overview", "trend", "trends", "detail", "details", "schedule", "table"]);

/** Plan to fold table g into cluster m: the line pairs that are one line, or null when they disagree. */
function planMerge(c: Ctx, m: PayloadGroup, g: PayloadGroup, ctx: Set<string>): [PayloadSeries, PayloadSeries][] | null {
  const ms = m.rows.map((r) => c.byKey.get(resolve(c, r.k))).filter((s): s is PayloadSeries => !!s && !c.removed.has(s.k));
  const gs = g.rows.map((r) => c.byKey.get(resolve(c, r.k))).filter((s): s is PayloadSeries => !!s && !c.removed.has(s.k));
  const mRoot = m.root ? resolve(c, m.root) : null;
  const gRoot = g.root ? resolve(c, g.root) : null;
  const used = new Set<string>();
  const pairs: [PayloadSeries, PayloadSeries][] = [];
  for (const b of gs) {
    const kb = memberKey(b, ctx);
    let best: PayloadSeries | null = null;
    let bestScore = -1;
    for (const a of ms) {
      if (used.has(a.k)) continue;
      const v = sameLine(a, memberKey(a, ctx), b, kb, { aRoot: a.k === mRoot, bRoot: b.k === gRoot });
      if (v === "clash") return null; // same name, different numbers: a different measure (adjusted vs GAAP, restated)
      if (v !== "same") continue;
      const score = compare(a, b).agree + (a.k === mRoot && b.k === gRoot ? 100 : 0);
      if (score > bestScore) (best = a), (bestScore = score);
    }
    if (best) {
      // A table's total only folds into the other table's total, and a part never into a total.
      if ((best.k === mRoot) !== (b.k === gRoot)) return null;
      used.add(best.k);
      pairs.push([best, b]);
    }
  }
  if (mRoot && gRoot && !pairs.some(([a, b]) => a.k === mRoot && b.k === gRoot)) return null;
  const kids = pairs.filter(([a]) => a.k !== mRoot).length;
  const mPeriods = new Set(ms.flatMap((s) => [...periodsOf(s)]));
  const gPeriods = new Set(gs.flatMap((s) => [...periodsOf(s)]));
  // Two different splits of the same total in the same periods (segments vs products) stay apart.
  if (overlaps(mPeriods, gPeriods) && !kids && gs.length > 1 && ms.length > 1) return null;
  if (!pairs.length) return null;
  // In a period both tables itemize, every part g prints must be one of m's parts there: otherwise g
  // is another split of the same total (GAAP opex as R&D + SG&A vs as non-GAAP opex + adjustments).
  const matched = new Set(pairs.map(([, b]) => b.k));
  const mKids = ms.filter((s) => s.k !== mRoot);
  for (const b of gs) {
    if (b.k === gRoot || matched.has(b.k)) continue;
    for (const [kind, cells] of allCells(b))
      for (const e of Object.keys(cells))
        if (mKids.some((a) => (kind === "q" ? a.q : kind === "y" ? a.y : a.mo ?? {})[e])) return null;
  }
  return pairs;
}

/** Fold g into m: matched lines merge, g's other lines join m in g's order, next to their matched neighbours. */
function applyMerge(c: Ctx, m: PayloadGroup, g: PayloadGroup, pairs: [PayloadSeries, PayloadSeries][]) {
  for (const [a, b] of pairs) if (a.k !== b.k) absorb(c, a, b);
  const rows = m.rows.filter((r) => !c.removed.has(r.k));
  const inM = new Set(rows.map((r) => r.k));
  const gRows = g.rows.map((r) => ({ k: resolve(c, r.k), depth: r.depth })).filter((r) => !c.removed.has(r.k));
  let pending: { k: string; depth: number }[] = [];
  for (const r of gRows) {
    if (inM.has(r.k)) {
      if (pending.length) {
        const at = rows.findIndex((x) => x.k === r.k);
        rows.splice(at, 0, ...pending);
        pending.forEach((x) => inM.add(x.k));
        pending = [];
      }
      continue;
    }
    if (!pending.some((x) => x.k === r.k)) pending.push(r);
  }
  for (const r of gRows) {
    const s = c.byKey.get(r.k);
    if (s?.parent && !inM.has(r.k)) c.touched.add(s.parent);
  }
  if (pending.length) {
    // Parts before the total, which closes the table.
    const at = m.root ? rows.findIndex((x) => x.k === resolve(c, m.root!)) : -1;
    rows.splice(at >= 0 ? at : rows.length, 0, ...pending);
  }
  m.rows = rows;
}

const span = (c: Ctx, g: PayloadGroup) => {
  const ends = g.rows.flatMap((r) => {
    const s = c.byKey.get(r.k);
    return s ? [...Object.keys(s.q), ...Object.keys(s.y)] : [];
  });
  ends.sort();
  return { first: ends[0] ?? "", last: ends.at(-1) ?? "", n: new Set(ends).size };
};

/** Words of a table's total that the other tables of the same subject don't have ("Adjusted", "GAAP measure"). */
function distinguishing(label: string, others: string[]) {
  const mine = labelTokens(label, true);
  const theirs = others.map((o) => new Set(labelTokens(o, true)));
  const own = mine.filter((w) => theirs.every((t) => !t.has(w)));
  if (!own.length) return "";
  const words = label.replace(/[()]/g, " ").split(/\s+/).filter((w) => own.includes(singular(w.toLowerCase().replace(/[^a-z0-9%]/g, ""))));
  const out = words.slice(0, 4).join(" ");
  return out ? out[0].toUpperCase() + out.slice(1) : "";
}

const LABEL_SEP = /\s+[—–-]\s+|:\s+/;

/** Long lists of loose lines: lines sharing a lead-in ("Aetna — …") become their own list. */
function splitLoose(c: Ctx, groups: PayloadGroup[]): PayloadGroup[] {
  const out: PayloadGroup[] = [];
  for (const g of groups) {
    if (g.root || g.rows.length < 7) {
      out.push(g);
      continue;
    }
    const byPrefix = new Map<string, { k: string; depth: number }[]>();
    for (const r of g.rows) {
      const s = c.byKey.get(r.k);
      const parts = s?.label.split(LABEL_SEP) ?? [];
      const px = parts.length > 1 ? parts[0].trim() : "";
      if (!px || px.length < 3 || /^\d/.test(px) || labelTokens(px).length === 0) continue;
      const key = px.toLowerCase();
      byPrefix.set(key, [...(byPrefix.get(key) ?? []), r]);
    }
    const taken = new Set<string>();
    for (const [, rows] of byPrefix) {
      if (rows.length < 3 || rows.length === g.rows.length) continue;
      const px = c.byKey.get(rows[0].k)!.label.split(LABEL_SEP)[0].trim();
      rows.forEach((r) => taken.add(r.k));
      out.push({ ...g, id: `${g.id}|${px.toLowerCase()}`, rows, t: px, px });
    }
    const rest = g.rows.filter((r) => !taken.has(r.k));
    if (rest.length) out.push({ ...g, rows: rest });
  }
  return out;
}

const CAT_ADJ: Record<string, string> = { segment: "segment", product: "product", geography: "regional", customer: "customer", channel: "channel" };
const LOOSE_KPI: Record<string, string> = { other: "Other operating KPIs" };
const LOOSE_COST: Record<string, string> = { cost: "Other costs", expense: "Other expenses", margin: "Cost ratios", other: "Other cost lines" };
const LOOSE_BALANCE: Record<string, string> = { other: "Other balance sheet lines", assets: "Other assets", deposits: "Other deposits & liabilities", loans: "Other loans & borrowings" };
/** Title for a list of lines printed without a total that ties them together. */
export function looseTitle(g: PayloadGroup) {
  const metric = METRIC_LABEL[g.met] ?? g.met;
  if (g.cat === "kpi") return LOOSE_KPI[g.met] ?? metric;
  if (g.cat === "cost") return LOOSE_COST[g.met] ?? `Other ${metric.toLowerCase()}`;
  if (g.cat === "balance") return LOOSE_BALANCE[g.met] ?? metric;
  const adj = CAT_ADJ[g.cat];
  if (adj) {
    if (g.met === "other") return `Other ${adj} lines`;
    const m = metric.toLowerCase().replace(new RegExp(`^${adj}\\s+`), "");
    return `Other ${adj} ${m}${/s$/.test(m) ? "" : " lines"}`;
  }
  return g.met === "other" ? "Other lines" : `Other ${metric.toLowerCase()} lines`;
}
const UNIT_TAG: Record<string, string> = { usd: "$", count: "counts", pct: "%", bps: "bps", ratio: "ratios", usdPerShare: "per unit", other: "values" };

/** Measure words worth naming in a title, in the order they read. */
const MODIFIER_TAGS: [RegExp, string][] = [
  [/\bnon-?\s?gaap\b/i, "Non-GAAP"],
  [/\b(?<!non-?\s?)gaap\b/i, "GAAP"],
  [/\badjusted\b|\bas adjusted\b/i, "Adjusted"],
  [/\borganic\b/i, "Organic"],
  [/\bconstant[- ]currency\b/i, "Constant currency"],
  [/\bcomparable\b/i, "Comparable"],
  [/\bpro forma\b/i, "Pro forma"],
  [/\bannuali[sz]ed\b/i, "Annualized"],
  [/\baverage\b|\bavg\b/i, "Average"],
  [/\b(ltm|ttm|trailing (twelve|12) months)\b/i, "Trailing 12 months"],
  [/\b(net change|change|growth)\b/i, "Change"],
];
const GENERIC_TITLE_WORDS = new Set(["total", "totals", "consolidated", "net", "loss", "income"]);

/** The words of a label that pass `skip`, in their printed order and casing (at most five). */
function cleanPhrase(label: string, skip: (w: string) => boolean) {
  const words = label
    .replace(/[()]/g, " ")
    .split(/\s+/)
    .filter((w) => {
      const t = singular(w.toLowerCase().replace(/[^a-z0-9%]/g, ""));
      return t && !STOP.has(t) && !GENERIC_TITLE_WORDS.has(t) && !skip(t) && !/^\d$/.test(t);
    })
    .map((w) => w.replace(/^[^A-Za-z0-9%$]+|[^A-Za-z0-9%)]+$/g, ""))
    .filter(Boolean);
  if (!words.length) return "";
  const out = words.slice(0, 5).join(" ");
  return out[0].toUpperCase() + out.slice(1);
}

const KIND_WORD: Record<string, string> = { "press-release": "earnings releases", supplement: "supplements", presentation: "presentations", data: "data files", transcript: "transcripts", other: "other documents", image: "slides" };
/** The kind of document most of a table's numbers come from. */
function sourceKind(c: Ctx, g: PayloadGroup) {
  const n = new Map<string, number>();
  for (const r of g.rows) {
    const s = c.byKey.get(r.k);
    if (!s) continue;
    for (const cell of Object.values(s.q)) {
      const k = cell.d != null ? c.p.docs[cell.d]?.kind : null;
      if (k) n.set(k, (n.get(k) ?? 0) + 1);
    }
  }
  const top = [...n].sort((a, b) => b[1] - a[1])[0]?.[0];
  return top ? KIND_WORD[top] ?? null : null;
}

/** Rows in display order from the merged hierarchy: under each line its parts (largest first), then the line. */
function orderRows(c: Ctx, g: PayloadGroup): { k: string; depth: number }[] {
  if (!g.root) return g.rows;
  const inGroup = new Set(g.rows.map((r) => r.k));
  const latest = (s: PayloadSeries) => {
    const e = Object.keys(s.q).sort().at(-1) ?? Object.keys(s.y).sort().at(-1);
    return e ? Math.abs((s.q[e] ?? s.y[e]).v) : 0;
  };
  const kidsOf = new Map<string, PayloadSeries[]>();
  for (const k of inGroup) {
    const s = c.byKey.get(k);
    if (!s || k === g.root) continue;
    const parent = s.parent && inGroup.has(s.parent) && s.parent !== k ? s.parent : g.root;
    kidsOf.set(parent, [...(kidsOf.get(parent) ?? []), s]);
  }
  const out: { k: string; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (k: string, depth: number) => {
    if (seen.has(k)) return;
    seen.add(k);
    for (const kid of (kidsOf.get(k) ?? []).sort((a, b) => latest(b) - latest(a))) walk(kid.k, depth + 1);
    out.push({ k, depth });
  };
  walk(g.root, 0);
  // Lines caught in a parent loop still show, as parts of the table's total.
  for (const r of g.rows) if (!seen.has(r.k)) out.splice(out.length - 1, 0, { k: r.k, depth: 1 });
  return out;
}

/**
 * Tie-out checks against the lines the table now shows: after lines merge, a stored check can count a
 * part twice or miss one, so each check is redone from the merged parts (same tolerance as the build).
 */
function recheck(c: Ctx, groups: PayloadGroup[], checks: PayloadCheck[]): PayloadCheck[] {
  const kidsOf = new Map<string, PayloadSeries[]>();
  for (const g of groups) {
    if (!g.root) continue;
    const inGroup = new Set(g.rows.map((r) => r.k));
    for (const r of g.rows) {
      const s = c.byKey.get(r.k);
      if (s?.parent && inGroup.has(s.parent)) kidsOf.set(s.parent, [...(kidsOf.get(s.parent) ?? []), s]);
    }
  }
  const touched = new Set([...c.touched].map((k) => resolve(c, k)));
  const out: PayloadCheck[] = [];
  for (const x of checks) {
    const total = c.byKey.get(x.k);
    const kids = kidsOf.get(x.k);
    if (!touched.has(x.k) || !total || !kids?.length) {
      out.push(x);
      continue;
    }
    const cellOf = (s: PayloadSeries) => (x.kind === "fy" ? s.y : s.q)[x.e];
    const t = cellOf(total);
    const present = kids.filter((k) => cellOf(k));
    if (!t || !present.length) continue;
    const sub = new Set((x.sub ?? []).map((l) => c.renamed.get(l) ?? l));
    const sum = present.reduce((n, k) => n + (sub.has(k.label) ? -1 : 1) * cellOf(k)!.v, 0);
    const tol = total.unit === "usd" ? Math.max(Math.abs(t.v) * 0.005, 1.5e6) : Math.max(Math.abs(t.v) * 0.005, 1.5);
    if (present.length === x.n && Math.abs(sum - x.sum) <= tol) {
      out.push(x);
      continue;
    }
    const ok = Math.abs(sum - t.v) <= tol;
    // Fewer parts than the release printed (one now sits in another table): the release's own check stands.
    if (!ok && x.ok && present.length <= x.n) {
      out.push(x);
      continue;
    }
    // A selected-lines list stays one while its parts don't exceed the total.
    const partial = x.partial && !ok && Math.abs(sum) < Math.abs(t.v) ? true : undefined;
    out.push({ ...x, total: t.v, sum, ok, n: present.length, ...(partial ? { partial } : { partial: undefined }) });
  }
  return out;
}

export function tidyPayload(p: IrPayload, opts: { log?: string[] } = {}): IrPayload {
  if (p.tidy === TIDY_VERSION && !opts.log) return p;
  const series = p.series.map((s) => ({ ...s, q: { ...s.q }, y: { ...s.y }, ...(s.mo ? { mo: { ...s.mo } } : {}) }));
  const out: IrPayload = { ...p, series, groups: p.groups.map((g) => ({ ...g, t: undefined, rows: [...g.rows] })), checks: p.checks.map((x) => ({ ...x })) };
  const c: Ctx = { p: out, byKey: new Map(series.map((s) => [s.k, s])), alias: new Map(Object.entries(p.alias ?? {})), removed: new Set(), kids: new Map(), renamed: new Map(), touched: new Set(), log: opts.log };
  for (const s of series) if (s.parent) c.kids.set(s.parent, [...(c.kids.get(s.parent) ?? []), s]);
  const before = { groups: out.groups.length, series: series.length };

  // 1–3. Subjects: rooted tables by unit and subject words (the dimension a reader assigned can
  // differ between releases of one table, so it isn't part of the subject); loose lists by their own key.
  const titleOf = (g: PayloadGroup) => groupTitle(g, g.root ? c.byKey.get(g.root) : undefined);
  const subjectOf = (g: PayloadGroup) => {
    const root = g.root ? c.byKey.get(g.root) : undefined;
    const named = root?.sc ?? (g.bd && !/^(total|consolidated)/i.test(g.bd) ? g.bd : null);
    const base = g.cat === "kpi" || g.cat === "balance" ? root?.label ?? "" : METRIC_LABEL[g.met] ?? g.met;
    // A table's own wording ("Medical membership by plan type", "Membership") adds only the words that
    // name something the line itself doesn't (a segment, a region); the values decide the rest.
    const own = new Set(labelTokens(base));
    const extra = named ? labelTokens(named).filter((w) => !own.has(w) && !TABLE_WORDS.has(w)) : [];
    const words = g.cat === "kpi" || g.cat === "balance" ? [...own, ...extra] : extra.length ? extra : [...own];
    return `${g.unit}|${root?.pit ? "pit" : "flow"}|${[...new Set(words)].sort().join(" ")}`;
  };
  const subjects = new Map<string, PayloadGroup[]>();
  for (const g of out.groups) {
    if (!g.root) {
      mergeSiblings(c, g, new Set(METRIC_CONTEXT[g.met] ?? []));
      continue;
    }
    const key = subjectOf(g);
    subjects.set(key, [...(subjects.get(key) ?? []), g]);
  }
  const drop = new Set<PayloadGroup>();
  const clustersOf = new Map<string, Cluster[]>();
  for (const [key, list] of subjects) {
    const ctx = new Set<string>();
    for (const g of list) for (const w of subjectContext(titleOf(g), g)) ctx.add(w);
    for (const g of list) mergeSiblings(c, g, ctx);
    // Longest-running, most recent table first: the others fold into it.
    const ordered = [...list].sort((a, b) => span(c, b).n - span(c, a).n || span(c, b).last.localeCompare(span(c, a).last));
    const clusters: Cluster[] = [];
    for (const g of ordered) {
      let placed = false;
      for (const cl of clusters) {
        const plan = planMerge(c, cl.g, g, ctx);
        if (!plan) continue;
        applyMerge(c, cl.g, g, plan);
        cl.members.push(g);
        drop.add(g);
        placed = true;
        break;
      }
      if (!placed) clusters.push({ g, members: [g] });
    }
    for (const cl of clusters) mergeSiblings(c, cl.g, ctx);
    clustersOf.set(key, clusters);
  }

  // Rows and checks follow the merged lines.
  let groups = out.groups.filter((g) => !drop.has(g));
  for (const g of groups) {
    const seen = new Set<string>();
    g.rows = g.rows.map((r) => ({ ...r, k: resolve(c, r.k) })).filter((r) => !c.removed.has(r.k) && c.byKey.has(r.k) && !seen.has(r.k) && (seen.add(r.k), true));
    if (g.root) g.root = resolve(c, g.root);
  }
  groups = groups.filter((g) => g.rows.length);
  for (const g of groups) if (g.root && (drop.size || c.removed.size)) g.rows = orderRows(c, g);
  const have = new Set<string>();
  const checks: PayloadCheck[] = [];
  // Checks of the line that stays come first, so a moved check never replaces one already there.
  for (const pass of [0, 1])
    for (const x of out.checks) {
      const moved = c.alias.has(x.k);
      if ((pass === 0) === moved) continue;
      const k = resolve(c, x.k);
      if (c.removed.has(k)) continue;
      const id = `${k}|${x.kind}|${x.e}`;
      if (have.has(id)) continue;
      have.add(id);
      checks.push(moved ? { ...x, k } : x);
    }

  // 4. Titles that tell tables apart: the total's own name, else the unit, else the years covered.
  groups = splitLoose(c, groups);
  for (const g of groups) if (g.px && !g.t) g.t = g.px;
  for (const g of groups) if (!g.root && !g.px) g.t = looseTitle(g);
  const byTitle = new Map<string, PayloadGroup[]>();
  for (const g of groups) {
    const ti = titleOf(g).toLowerCase();
    byTitle.set(ti, [...(byTitle.get(ti) ?? []), g]);
  }
  for (const same of byTitle.values()) {
    if (same.length < 2) continue;
    const base = titleOf(same[0]);
    const baseWords = new Set(labelTokens(base));
    const used = new Set<string>([base.toLowerCase()]);
    const tagged = (g: PayloadGroup, tag: string) => {
      const t = `${base} · ${tag}`;
      if (!tag || used.has(t.toLowerCase())) return false;
      used.add(t.toLowerCase());
      g.t = t;
      return true;
    };
    const units = new Set(same.map((g) => g.unit));
    const rootLabel = (g: PayloadGroup) => (g.root ? c.byKey.get(g.root)?.label ?? "" : "");
    const tagsOf = (g: PayloadGroup) => new Set(MODIFIER_TAGS.filter(([re]) => re.test(rootLabel(g))).map(([, t]) => t));
    for (const g of [...same].sort((a, b) => span(c, b).last.localeCompare(span(c, a).last))) {
      const others = same.filter((x) => x !== g);
      // 1. A measure word the others don't have: Adjusted, Non-GAAP, Organic…
      const mine = [...tagsOf(g)].filter((t) => !base.toLowerCase().includes(t.toLowerCase()) && others.some((o) => !tagsOf(o).has(t)));
      if (mine.length && tagged(g, mine.join(", "))) continue;
      // 2. Words of its total that neither the title nor the other totals have.
      const otherWords = new Set(others.flatMap((o) => labelTokens(rootLabel(o), true)));
      const phrase = cleanPhrase(rootLabel(g), (w) => baseWords.has(w) || otherWords.has(w));
      if (phrase && tagged(g, phrase)) continue;
      if (units.size > 1 && tagged(g, UNIT_TAG[g.unit] ?? g.unit)) continue;
      // 3. The years it covers, 4. the documents it comes from, 5. a number.
      const sp = span(c, g);
      const era = sp.first && sp.last ? (sp.first.slice(0, 4) === sp.last.slice(0, 4) ? sp.first.slice(0, 4) : `${sp.first.slice(0, 4)}–${sp.last.slice(0, 4)}`) : "";
      if (tagged(g, era)) continue;
      const kind = sourceKind(c, g);
      if (kind && tagged(g, `from ${kind}`)) continue;
      for (let n = 2; !tagged(g, `table ${n}`); n++);
    }
    // The newest table keeps the plain title when the others were told apart.
    const plain = same.find((g) => !g.t || g.t === base);
    if (!plain) {
      const newest = [...same].sort((a, b) => span(c, b).last.localeCompare(span(c, a).last))[0];
      if (newest && same.filter((g) => g !== newest).every((g) => g.t !== base)) newest.t = base;
    }
  }

  // A total printed as just "Total" reads as the table's measure ("Total revenue").
  for (const g of groups) {
    const root = g.root ? c.byKey.get(g.root) : undefined;
    if (!root || !/^\s*totals?\s*:?\s*$/i.test(root.label)) continue;
    const measure = g.cat === "kpi" || g.cat === "balance" ? titleOf(g).replace(/\s+by\s+.*$/i, "") : METRIC_LABEL[g.met] ?? "";
    if (measure && !/^total$/i.test(measure)) {
      c.renamed.set(root.label, `Total ${measure.toLowerCase()}`);
      root.label = `Total ${measure.toLowerCase()}`;
    }
  }
  const kept = series.filter((s) => !c.removed.has(s.k));
  const rechecked = c.removed.size ? recheck(c, groups, checks) : checks;
  const q = rechecked.filter((x) => x.kind === "q");
  const fy = rechecked.filter((x) => x.kind === "fy");
  return {
    ...out,
    tidy: TIDY_VERSION,
    series: kept,
    groups,
    checks: rechecked,
    ...(c.alias.size ? { alias: Object.fromEntries([...c.alias].map(([k]) => [k, resolve(c, k)])) } : {}),
    stats: {
      ...out.stats,
      series: kept.length,
      groups: groups.length,
      checksQ: { ok: q.filter((x) => x.ok).length, total: q.filter((x) => !x.partial).length, partial: q.filter((x) => x.partial).length },
      checksFY: { ok: fy.filter((x) => x.ok).length, total: fy.filter((x) => !x.partial).length, partial: fy.filter((x) => x.partial).length },
      tidied: { groupsBefore: before.groups, seriesBefore: before.series },
    },
  };
}
