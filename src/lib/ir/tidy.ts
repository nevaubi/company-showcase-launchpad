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
import { FLOW_FORMULAS, stockKind } from "@/lib/ir/stock";

export const TIDY_VERSION = 5;

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
/** Rounding step of a printed figure with at most two significant digits ($1.3 billion → 100 million), else 0. */
function roundStep(v: number) {
  const a = Math.abs(v);
  if (!a || !Number.isFinite(a)) return 0;
  const lead = 10 ** Math.floor(Math.log10(a));
  for (const step of [lead, lead / 10]) if (step >= 1 && Math.abs(a / step - Math.round(a / step)) < 1e-9) return step;
  return 0;
}
/** "$1.3 billion" on a slide and "$1,308 million" in the release are one figure. */
function roundedAlike(x: number, y: number) {
  if (Math.sign(x) !== Math.sign(y)) return false;
  const step = Math.max(roundStep(x), roundStep(y));
  return step > 0 && Math.abs(x - y) <= step / 2 && Math.abs(x - y) <= Math.max(Math.abs(x), Math.abs(y)) * 0.05;
}
/** x is the same figure as y printed with more digits ($1,489 million vs $1.5 billion). */
const finer = (x: number, y: number) => roundedAlike(x, y) && roundStep(y) > 0 && roundStep(x) < roundStep(y);
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
      if (Math.abs(x.v - y.v) <= tol || roundedAlike(x.v, y.v)) {
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
  /** fiscal year-ends of the payload, built on first use */
  yearEnds?: Set<string>;
}

/** Copy b's cells into a where a has none (a printed cell beats a calculated one), then retire b. */
function absorb(c: Ctx, a: PayloadSeries, b: PayloadSeries) {
  // The merged line takes the company's current name, unless that name says nothing on its own.
  const latest = (s: PayloadSeries) => [...periodsOf(s)].sort().at(-1) ?? "";
  const label = latest(b) > latest(a) && labelTokens(b.label).length && labelTokens(b.label).length >= Math.min(2, labelTokens(a.label).length) ? b.label : !labelTokens(a.label).length ? b.label : a.label;
  for (const [kind, cb] of allCells(b)) {
    if (!Object.keys(cb).length) continue;
    const ca = kind === "q" ? a.q : kind === "y" ? a.y : (a.mo ??= {});
    for (const [e, cell] of Object.entries(cb))
      if (!ca[e] || (ca[e].f && !cell.f) || (ca[e].w && !cell.w && !cell.f) || (!cell.f && !cell.w && finer(cell.v, ca[e].v))) ca[e] = cell;
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

/** Two labels name one line: same words, or each word a short form of the other's ("Auto" / "Automotive"). */
export function alikeLabels(a: string, b: string) {
  const x = labelTokens(a);
  const y = labelTokens(b);
  if (!x.length || x.length !== y.length) return false;
  return x.every((w, i) => w === y[i] || (Math.min(w.length, y[i].length) >= 3 && (w.startsWith(y[i]) || y[i].startsWith(w))));
}

/**
 * After an old table ("Total = Data Center + Gaming + … + Auto") folds into a newer, deeper one
 * ("Revenue = Data Center + Edge Computing", "Edge Computing = Gaming + … + Automotive"), a line the
 * old table printed directly under the total can repeat a line the new table nests one level down
 * under another name. Both then count toward the total and its check fails. Such a line folds into
 * its nested twin when their names agree, their printed numbers never conflict and agree at least
 * once, and the twin's own total is printed in every period the line covers.
 */
function mergeCousins(c: Ctx, g: PayloadGroup) {
  if (!g.root) return;
  const root = resolve(c, g.root);
  const rows = g.rows.map((r) => c.byKey.get(resolve(c, r.k))).filter((s): s is PayloadSeries => !!s && !c.removed.has(s.k));
  const inGroup = new Set(rows.map((s) => s.k));
  const direct = rows.filter((s) => s.parent === root && s.k !== root);
  const nested = rows.filter((s) => s.parent && s.parent !== root && inGroup.has(s.parent) && c.byKey.get(s.parent)?.parent === root);
  for (const a of direct) {
    if (c.removed.has(a.k)) continue;
    for (const b of nested) {
      if (c.removed.has(b.k) || b.unit !== a.unit || !!b.pit !== !!a.pit || !alikeLabels(a.label, b.label)) continue;
      const cmp = compare(a, b);
      if (cmp.conflict || cmp.agree < 1) continue;
      const parent = c.byKey.get(b.parent!)!;
      const covered = periodsOf(parent);
      if ([...periodsOf(a)].some((e) => !covered.has(e))) continue;
      absorb(c, b, a);
      break;
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

// ---------- 0. Balances and averages ----------
/**
 * Older builds added four quarter-end balances (or averages) into a "year" and subtracted quarters
 * from a year-end balance to get a fourth quarter. Those cells go; a balance's year is its year-end
 * quarter and its fourth quarter the year-end figure printed in an annual column.
 */
function stocks(c: Ctx) {
  for (const s of c.byKey.values()) {
    const kind = stockKind({ pit: s.pit, category: s.cat, metric: s.met, label: s.label, parent: s.parent ? c.byKey.get(s.parent)?.label : null, breakdown: s.bd ?? s.sc });
    if (!kind) continue;
    for (const cells of [s.q, s.y])
      for (const [e, cell] of Object.entries(cells))
        if (cell.f && FLOW_FORMULAS.test(cell.f.formula)) {
          delete cells[e];
          c.log?.push(`STOCK ${s.label} ${e}: dropped ${cell.f.formula}`);
        }
    if (kind !== "point") continue;
    const near = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) <= 7 * 86_400_000;
    for (const [e, cell] of Object.entries(s.y)) {
      const q = Object.keys(s.q).find((x) => near(x, e));
      if (!q && !cell.f) s.q[e] = cell;
    }
    for (const [e, cell] of Object.entries(s.q)) {
      const y = Object.keys(s.y).find((x) => near(x, e));
      if (!y && isYearEnd(c, e)) s.y[e] = cell;
    }
  }
}
/** A quarter-end that closes a fiscal year somewhere in this company's payload. */
function isYearEnd(c: Ctx, e: string) {
  const years = (c.yearEnds ??= new Set(c.p.years ?? []));
  for (const y of years) if (Math.abs(Date.parse(y) - Date.parse(e)) <= 7 * 86_400_000) return true;
  return false;
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

/**
 * A total can only be tested when every part the table prints elsewhere is printed for that period
 * too: a period missing one of its lines is left unchecked rather than flagged as not adding up.
 */
function checkable(c: Ctx, groups: PayloadGroup[], checks: PayloadCheck[]): PayloadCheck[] {
  const partsOf = new Map<string, PayloadSeries[]>();
  for (const g of groups) {
    if (!g.root) continue;
    const parts = g.rows.map((r) => c.byKey.get(r.k)).filter((s): s is PayloadSeries => !!s && s.parent === g.root);
    if (parts.length) partsOf.set(g.root, parts);
  }
  const most = new Map<string, number>();
  const present = (x: PayloadCheck) => (partsOf.get(x.k) ?? []).filter((s) => (x.kind === "fy" ? s.y : s.q)[x.e]).length;
  for (const x of checks) most.set(`${x.k}|${x.kind}`, Math.max(most.get(`${x.k}|${x.kind}`) ?? 0, present(x)));
  return checks.filter((x) => x.ok || x.partial || !partsOf.has(x.k) || present(x) >= (most.get(`${x.k}|${x.kind}`) ?? 0));
}

// ---------- 5. Segment matrices ----------
// Releases print one measure per segment in many shapes: a "by segment" table, a results table per
// segment ("Health Services: adjusted operating income …"), loose lines scoped to a segment. Lines that
// name the same segment and the same measure become one row of one "<measure> by segment" table, whose
// total is the consolidated line of that measure, so each segment reads as one continuous history.

/** Words that say what is measured, not which segment. */
const MEASURE_WORDS = new Set(["revenue", "sale", "income", "operating", "profit", "loss", "adjusted", "ebitda", "ebit", "margin", "gaap", "nongaap", "non", "earning", "contribution", "total", "net", "gross", "expense", "cost", "result", "performance", "profitability", "financial"]);
const STOCK_WORDS = /\b(average|avg|balances?|ending|end of|outstanding|assets?|liabilit|deposits?|loans?|borrowings?|backlog|headcount|employees|rate|ratio|margin|yield|per share|change|%)/i;
const SCOPED_FILLER = new Set(["measure", "reported", "segment", "segments", "before", "after", "loss"]);
const ELIMINATION = /\b(eliminations?|intersegment|inter-segment|corporate|unallocated|reconciling|other)\b/i;

interface Member {
  key: string;
  tokens: string[];
  name: string;
  /** printed in the most recent period */
  last: string;
  /** "Corporate/Other", "Eliminations": only a line printed as exactly that belongs to it */
  generic: boolean;
}
const memberTokens = (piece: string) => labelTokens(piece).filter((w) => !MEASURE_WORDS.has(w) && !TABLE_WORDS.has(w));
/** The words of a printed name that name the segment: "Health Care Benefits adjusted operating income" → "Health Care Benefits". */
const cleanMember = (piece: string) => {
  const words = piece.replace(/\((\d+|[a-z])\)/gi, " ").split(/\s+/).filter(Boolean);
  const own = new Set(memberTokens(piece));
  const isOwn = (w: string) => labelTokens(w).some((t) => own.has(t));
  const first = words.findIndex(isOwn);
  let last = -1;
  for (let i = words.length - 1; i >= 0; i--) if (isOwn(words[i])) (last = i), (i = -1);
  if (first < 0) return "";
  return words
    .slice(first, last + 1)
    .join(" ")
    .replace(/^[\s—–:,(-]+|[\s—–:,)-]+$/g, "")
    .trim();
};

/** Names that only say "the rest" (Corporate/Other, eliminations): assigned only to a line printed as exactly that. */
const GENERIC_MEMBER = new Set(["other", "corporate", "elimination", "intersegment", "unallocated", "reconciling", "item", "adjustment", "all"]);

/**
 * Segment names: the parts of the company's segment tables whose total is a consolidated line (not
 * itself one segment's line) and whose parts add up to it in at least one period, so product lines
 * inside one segment ("Pharmacy", "Front Store") never count as segments.
 */
function segmentMembers(c: Ctx, groups: PayloadGroup[], checks: PayloadCheck[]): Member[] {
  const okRoots = new Set(checks.filter((x) => x.ok && !x.partial).map((x) => x.k));
  const fromGroups = (list: PayloadGroup[]) => {
    const found = new Map<string, Member>();
    for (const g of list) {
      for (const r of g.rows) {
        const s = c.byKey.get(r.k);
        if (!s || s.k === g.root || s.parent !== g.root) continue;
        const last = [...periodsOf(s)].sort().at(-1) ?? "";
        for (const piece of s.label.split(LABEL_SEP)) {
          const tokens = memberTokens(piece);
          if (!tokens.length || tokens.length > 5) continue;
          const key = [...tokens].sort().join(" ");
          const name = cleanMember(piece);
          if (!name) continue;
          const had = found.get(key);
          if (!had || last > had.last) found.set(key, { key, tokens, name, last, generic: tokens.every((w) => GENERIC_MEMBER.has(w)) });
        }
      }
    }
    return [...found.values()];
  };
  const tables = groups.filter((g) => g.cat === "segment" && g.root && g.rows.filter((r) => c.byKey.get(r.k)?.parent === g.root).length >= 2);
  const first = fromGroups(tables).filter((m) => !m.generic);
  const consolidated = tables.filter((g) => {
    const root = c.byKey.get(g.root!);
    return !!root && okRoots.has(root.k) && !memberOf(root, first);
  });
  return fromGroups(consolidated);
}

/** The segment a line is about (from its label or its table), or null when it names none or two. */
function memberOf(s: PayloadSeries, members: Member[]): { m: Member; inLabel: boolean } | null {
  const hit = (text: string, own: boolean) => {
    const words = new Set(labelTokens(text));
    const rest = memberTokens(text);
    const ms = members.filter((m) => m.tokens.every((w) => words.has(w)) && (!m.generic || (own && rest.length === m.tokens.length)));
    // The longest name wins when one contains another ("Health Care Benefits" over "Health").
    const top = ms.filter((m) => !ms.some((o) => o !== m && o.tokens.length > m.tokens.length && m.tokens.every((w) => o.tokens.includes(w))));
    return top.length === 1 ? top[0] : top.length ? undefined : null;
  };
  const own = hit(s.label, true);
  if (own) return { m: own, inLabel: true };
  if (own === undefined) return null;
  const scoped = s.sc ? hit(s.sc, false) : null;
  return scoped ? { m: scoped, inLabel: false } : null;
}

/** What a line measures, as words: its own name without the segment, else its total's. */
function measureOf(c: Ctx, s: PayloadSeries, m: Member | null, rootOf: Map<string, string>): string | null {
  const words = (label: string) => {
    let w = labelTokens(label).filter((x) => !TABLE_WORDS.has(x) && !(m && m.tokens.includes(x)));
    for (const x of labelTokens(label, true)) if (MODIFIERS.has(x) && !w.includes(x)) w.push(x);
    if (w.includes("income") || w.includes("profit")) w = w.filter((x) => x !== "loss");
    return w;
  };
  let w = words(s.label);
  if (m && !w.some((x) => MEASURE_WORDS.has(x))) {
    // "Health Services" in a revenue table measures what the table's total measures.
    const up = s.parent ? c.byKey.get(s.parent) : rootOf.get(s.k) ? c.byKey.get(rootOf.get(s.k)!) : undefined;
    if (!up || up === s) return null;
    w = [...new Set([...w, ...words(up.label).filter((x) => !(m && m.tokens.includes(x)))])];
  }
  if (!w.some((x) => MEASURE_WORDS.has(x))) return null;
  // "Net revenues", "Revenues" and "Net sales" are one measure; companies rename it between eras.
  if (w.includes("revenue") || w.includes("sale")) w = [...w.filter((x) => x !== "net" && x !== "sale"), "revenue"];
  return [...new Set(w)].sort().join(" ");
}

/** "Operating income (loss) (GAAP measure) - Consolidated Totals" → "Operating income (GAAP)". */
const measureTitle = (label: string, members: Member[] = []) => {
  const gaap = /\bnon-?\s?gaap\b/i.test(label) ? " (non-GAAP)" : /\bgaap\b/i.test(label) ? " (GAAP)" : "";
  const pieces = label
    .replace(/\([^)]*\)/g, " ")
    .split(LABEL_SEP)
    .map((x) => x.replace(/^\s*(total|consolidated)\s+/i, "").replace(/\s+/g, " ").trim())
    .filter((x) => x && !/^(consolidated|total|totals|consolidated totals?)$/i.test(x) && !members.some((m) => memberTokens(x).length && memberTokens(x).every((w) => m.tokens.includes(w))));
  const base = (pieces[0] ?? "").replace(/\s+([,;:])/g, "$1").replace(/[,;:\s]+$/, "");
  return base ? `${base[0].toUpperCase()}${base.slice(1)}${gaap}` : "";
};

/**
 * Two lines that disagree only on full-year figures, where one side's year is the sum of the four
 * quarters both print and the other's isn't: the year that adds up wins. Returns those cells, or
 * null when any disagreement can't be settled that way.
 */
function settle(a: PayloadSeries, b: PayloadSeries): [string, PayloadCell][] | null {
  // Only flows add up over a year; balances, averages and rates don't.
  if (a.pit || b.pit || a.unit !== "usd" || [a, b].some((s) => STOCK_WORDS.test(`${s.label} ${s.sc ?? ""}`))) return null;
  const q = { ...b.q, ...a.q };
  const out: [string, PayloadCell][] = [];
  for (const [kind, ca] of allCells(a)) {
    const cb = (kind === "q" ? b.q : kind === "y" ? b.y : b.mo ?? {}) as Record<string, PayloadCell>;
    for (const e of Object.keys(ca)) {
      const x = ca[e];
      const y = cb[e];
      if (!y || x.f || y.f || x.w || y.w) continue;
      const tol = Math.max(Math.abs(x.v), Math.abs(y.v)) * 0.005 + 0.5;
      if (Math.abs(x.v - y.v) <= tol || roundedAlike(x.v, y.v)) continue;
      if (kind !== "y") return null;
      const end = Date.parse(e);
      const quarters = Object.keys(q).filter((k) => {
        const d = (end - Date.parse(k)) / 86_400_000;
        return d >= 0 && d < 355;
      });
      if (quarters.length !== 4) return null;
      const sum = quarters.reduce((n, k) => n + q[k].v, 0);
      const t = Math.max(Math.abs(sum) * 0.005, 1.5e6);
      const aOk = Math.abs(x.v - sum) <= t;
      const bOk = Math.abs(y.v - sum) <= t;
      if (aOk === bOk) return null;
      if (bOk) out.push([e, y]);
    }
  }
  return out;
}

function segmentMatrices(c: Ctx, groups: PayloadGroup[], checks: PayloadCheck[]): { groups: PayloadGroup[]; checks: PayloadCheck[] } {
  const members = segmentMembers(c, groups, checks);
  if (members.filter((m) => !m.generic).length < 2) return { groups, checks };
  const groupOf = new Map<string, PayloadGroup>();
  const rootOf = new Map<string, string>();
  for (const g of groups)
    for (const r of g.rows) {
      groupOf.set(r.k, g);
      if (g.root && r.k !== g.root) rootOf.set(r.k, g.root);
    }
  const isRoot = (s: PayloadSeries) => groupOf.get(s.k)?.root === s.k;
  const okTotals = new Set(checks.filter((x) => x.ok && !x.partial).map((x) => x.k));
  /** The total of its own breakdown that ties out (a segment's revenue by product): that table keeps it. */
  const anchored = (s: PayloadSeries) => isRoot(s) && okTotals.has(s.k) && (groupOf.get(s.k)?.rows.length ?? 0) > 1;
  /** A line can fold into another unless it closes a breakdown of its own. */
  const foldable = (s: PayloadSeries) => !anchored(s);
  /** A line that must stay in its table joins a segment table as a copy of the same printed cells. */
  const copyOf = (s: PayloadSeries, tag: string): PayloadSeries => {
    const copy: PayloadSeries = { ...s, k: `${s.k}~${tag}`, q: { ...s.q }, y: { ...s.y }, ...(s.mo ? { mo: { ...s.mo } } : {}) };
    c.byKey.set(copy.k, copy);
    c.p.series.push(copy);
    return copy;
  };
  // measure key → member key → lines; measure key → consolidated lines
  const parts = new Map<string, Map<string, PayloadSeries[]>>();
  const totals = new Map<string, PayloadSeries[]>();
  const memberByKey = new Map(members.map((m) => [m.key, m]));
  for (const s of c.byKey.values()) {
    if (c.removed.has(s.k) || !groupOf.has(s.k) || s.unit !== "usd" || s.pit) continue;
    if (!["segment", "product", "kpi", "cost"].includes(s.cat) && !["revenue", "operating_income", "segment_profit", "gross_profit", "net_income"].includes(s.met)) continue;
    let who = memberOf(s, members);
    // "Other" or "Corporate" in a regional or product table is not the segment table's "Other".
    if (who?.m.generic && s.cat !== "segment") who = null;
    // In a segment's own results table, a line naming anything beyond the measure ("Net revenues:
    // Other", "Premium revenues") is an item inside that segment, not the segment's figure.
    if (who && !who.inLabel && labelTokens(s.label).some((w) => !MEASURE_WORDS.has(w) && !MODIFIERS.has(w) && !TABLE_WORDS.has(w) && !SCOPED_FILLER.has(w))) continue;
    const measure = measureOf(c, s, who?.m ?? null, rootOf);
    if (!measure) continue;
    const key = `${s.unit}|${measure}`;
    if (who) {
      const byM = parts.get(key) ?? new Map<string, PayloadSeries[]>();
      byM.set(who.m.key, [...(byM.get(who.m.key) ?? []), s]);
      parts.set(key, byM);
    } else if (s.total || isRoot(s) || /\bconsolidated\b/i.test(`${s.sc ?? ""} ${s.label}`)) totals.set(key, [...(totals.get(key) ?? []), s]);
  }

  const taken = new Set<string>();
  const made: PayloadGroup[] = [];
  const newChecks: PayloadCheck[] = [];
  for (const [key, byM] of parts) {
    if (byM.size < 2) continue;
    // One line per segment: lines that never disagree fold into the fullest one.
    const lists = [...byM.values()].map((list) => list.filter((s) => !taken.has(s.k) && !c.removed.has(s.k)).sort((a, b) => periodsOf(b).size - periodsOf(a).size)).filter((l) => l.length);
    if (lists.length < 2) continue;
    const heads = lists.map((l) => l[0]);
    const tolOf = (v: number) => Math.max(Math.abs(v) * 0.005, 1.5e6);
    // Where the fullest lines already add up to a printed consolidated line, a period is complete:
    // another line's cell there would count something twice, so it doesn't fold in.
    const complete = new Set<string>();
    for (const t of totals.get(key) ?? [])
      for (const [kind, cells] of [["q", t.q], ["y", t.y]] as const)
        for (const [e, cell] of Object.entries(cells)) {
          const present = heads.filter((h) => (kind === "q" ? h.q : h.y)[e]);
          if (present.length >= 2 && Math.abs(present.reduce((x, h) => x + (kind === "q" ? h.q : h.y)[e].v, 0) - cell.v) <= tolOf(cell.v)) complete.add(`${kind}${e}`);
        }
    const rows: PayloadSeries[] = [];
    for (const sorted of lists) {
      const head = anchored(sorted[0]) ? copyOf(sorted[0], "seg") : sorted[0];
      for (const b of sorted.slice(1)) {
        if (c.removed.has(b.k)) continue;
        let fix: [string, PayloadCell][] = [];
        if (compare(head, b).conflict) {
          const r = settle(head, b);
          if (!r) continue;
          fix = r;
        }
        const adds = [...Object.keys(b.q).filter((e) => !head.q[e]).map((e) => `q${e}`), ...Object.keys(b.y).filter((e) => !head.y[e]).map((e) => `y${e}`)];
        const sharper = Object.keys(b.q).some((e) => head.q[e] && finer(b.q[e].v, head.q[e].v)) || Object.keys(b.y).some((e) => head.y[e] && finer(b.y[e].v, head.y[e].v));
        if ((!adds.length && !fix.length && !sharper) || adds.some((x) => complete.has(x))) continue;
        // A year whose printed figure is not the sum of its four printed quarters was misread on one side.
        for (const [e, cell] of fix) {
          c.log?.push(`FY ${head.label} ${e}: ${head.y[e]?.v} → ${cell.v} (sum of quarters)`);
          head.y[e] = cell;
        }
        // A line that closes its own breakdown stays there; the segment row gets its printed cells.
        absorb(c, head, foldable(b) ? b : copyOf(b, "x"));
      }
      rows.push(head);
    }
    const orig = new Map(rows.map((x) => [x.k, { label: x.label, parent: x.parent }]));
    const ends = new Map<string, number>();
    for (const s of rows) for (const e of Object.keys(s.q)) ends.set(e, (ends.get(e) ?? 0) + 1);
    for (const s of rows) for (const e of Object.keys(s.y)) ends.set(`y${e}`, (ends.get(`y${e}`) ?? 0) + 1);
    // Worth a table only when two segments are printed for the same period.
    if (![...ends.values()].some((n) => n >= 2)) continue;
    const sumOf = (list: PayloadSeries[], kind: "q" | "y", e: string) => {
      const present = list.filter((s) => (kind === "q" ? s.q : s.y)[e]);
      // Eliminations printed as positive numbers are taken away from the segments.
      const elim = present.filter((s) => ELIMINATION.test(s.label) && (kind === "q" ? s.q : s.y)[e].v > 0);
      return { n: present.length, sum: present.reduce((x, s) => x + (kind === "q" ? s.q : s.y)[e].v, 0), elim: elim.reduce((x, s) => x + (kind === "q" ? s.q : s.y)[e].v, 0), sub: elim.map((s) => s.label) };
    };
    const sumAt = (kind: "q" | "y", e: string) => sumOf(rows, kind, e);
    // The consolidated line: the candidate whose numbers are the sum of the segments most often.
    const tol = (v: number) => Math.max(Math.abs(v) * 0.005, 1.5e6);
    /** The parts' sum that matches the total: as printed, or with positive eliminations taken away. */
    const tie = (r: ReturnType<typeof sumOf>, v: number) =>
      Math.abs(r.sum - v) <= tol(v) ? { ok: true, sum: r.sum, sub: [] as string[] } : r.elim && Math.abs(r.sum - 2 * r.elim - v) <= tol(v) ? { ok: true, sum: r.sum - 2 * r.elim, sub: r.sub } : { ok: false, sum: r.sum, sub: [] as string[] };
    const score = (t: PayloadSeries, list = rows) => {
      // Periods where every segment that is ever printed alongside the others is there.
      const most = { q: 0, y: 0 };
      for (const kind of ["q", "y"] as const)
        for (const e of new Set(list.flatMap((x) => Object.keys(kind === "q" ? x.q : x.y)))) most[kind] = Math.max(most[kind], sumOf(list, kind, e).n);
      let n = 0;
      for (const [kind, cells] of [["q", t.q], ["y", t.y]] as const)
        for (const [e, cell] of Object.entries(cells)) {
          const r = sumOf(list, kind, e);
          const k = r.n;
          if (k < 2) continue;
          // A "total" that is one segment's own number was read from the wrong row.
          if (list.some((x) => (kind === "q" ? x.q : x.y)[e]?.v === cell.v)) n -= 2;
          else if (tie(r, cell.v).ok) n += 2;
          else if (k >= most[kind]) n -= 1;
        }
      return n;
    };
    const cands = (totals.get(key) ?? []).filter((t) => !taken.has(t.k) && !c.removed.has(t.k)).map((t) => ({ t, n: score(t) })).sort((a, b) => b.n - a.n || periodsOf(b.t).size - periodsOf(a.t).size);
    let root: PayloadSeries | null = cands[0] && cands[0].n > 0 ? cands[0].t : null;
    if (root) {
      for (const { t } of cands.slice(1)) if (!c.removed.has(t.k) && foldable(t) && !compare(root, t).conflict && score(t) >= 0) absorb(c, root, t);
      // A line whose numbers make the segments stop adding up to the total isn't one of them
      // (an expense line a reader filed under revenue): it stays in its own table.
      for (let changed = true; changed && rows.length > 2; ) {
        changed = false;
        const base = score(root);
        for (const m of [...rows]) {
          const without = rows.filter((x) => x !== m);
          if (score(root, without) > base) {
            rows.splice(rows.indexOf(m), 1);
            changed = true;
            break;
          }
        }
      }
    }
    const named = [...rows].sort((a, b) => periodsOf(b).size - periodsOf(a).size).map((x) => orig.get(x.k)!);
    const measure =
      (root && measureTitle(root.label, members)) ||
      named.map((o) => measureTitle(o.label, members)).find(Boolean) ||
      named.map((o) => (o.parent ? measureTitle(c.byKey.get(resolve(c, o.parent))?.label ?? "", members) : "")).find(Boolean) ||
      "";
    // A measure needs a word of its own: "Net" or "Total" alone names nothing.
    if (!measure || labelTokens(measure).every((w) => ["net", "gross"].includes(w))) continue;
    const title = `${measure} by segment`;
    ends.clear();
    for (const x of rows) for (const e of Object.keys(x.q)) ends.set(e, (ends.get(e) ?? 0) + 1);
    for (const x of rows) for (const e of Object.keys(x.y)) ends.set(`y${e}`, (ends.get(`y${e}`) ?? 0) + 1);
    // The consolidated line also closes another breakdown (revenue by product): that table keeps it,
    // and the segment table closes on a copy of the same printed cells.
    if (root && isRoot(root)) {
      const own = groupOf.get(root.k)!;
      const inRows = new Set(rows.map((x) => x.k));
      const others = own.rows.some((r) => r.k !== root!.k && c.byKey.get(r.k)?.parent === root!.k && !inRows.has(r.k));
      if (others) root = { ...copyOf(root, "seg"), parent: null, total: true };
      if (others) c.byKey.set(root.k, root), (c.p.series[c.p.series.length - 1] = root);
    }
    // Periods the consolidated line misses: another printed total that the segments add up to fills them.
    if (root)
      for (const { t } of cands) {
        if (t === root || c.removed.has(t.k)) continue;
        for (const [kind, cells] of [["q", t.q], ["y", t.y]] as const) {
          const mine = kind === "q" ? root.q : root.y;
          for (const [e, cell] of Object.entries(cells)) {
            if (mine[e] || cell.f) continue;
            const r = sumAt(kind, e);
            if (r.n >= 2 && tie(r, cell.v).ok) mine[e] = cell;
          }
        }
      }
    // Only the segment lines move: what a release printed under them (a sub-breakdown, or another
    // measure a reader nested there) stays in its own table.
    const moving = new Map<string, number>();
    for (const s of rows) moving.set(s.k, 1);
    if (root) moving.set(root.k, 0);
    for (const k of moving.keys()) {
      taken.add(k);
      const s = c.byKey.get(k)!;
      if (s.parent) c.touched.add(s.parent);
    }
    // Rows read as the segment's name as that line printed it; the table title carries the measure.
    for (const s of rows) {
      const m = memberByKey.get([...byM].find(([, l]) => l.some((x) => resolve(c, x.k) === s.k))?.[0] ?? "");
      const piece = m ? s.label.split(LABEL_SEP).find((x) => { const t = memberTokens(x); return t.length > 0 && t.every((w) => m.tokens.includes(w)) && m.tokens.every((w) => t.includes(w)); }) : undefined;
      const name = piece ? cleanMember(piece) || m!.name : m?.name;
      if (name && s.label !== name) {
        c.renamed.set(s.label, name);
        s.label = name;
      }
      s.parent = root?.k ?? null;
      s.sc = undefined;
    }
    if (root) root.parent = null;
    const latest = (s: PayloadSeries) => {
      const e = Object.keys(s.q).sort().at(-1) ?? Object.keys(s.y).sort().at(-1);
      return e ? (s.q[e] ?? s.y[e]).v : 0;
    };
    rows.sort((a, b) => Number(ELIMINATION.test(a.label)) - Number(ELIMINATION.test(b.label)) || latest(b) - latest(a));
    const order: { k: string; depth: number }[] = rows.map((s) => ({ k: s.k, depth: 1 }));
    if (root) order.push({ k: root.k, depth: 0 });
    const label = root?.label ?? rows[0].label;
    const met = rows.map((s) => s.met).sort((a, b) => rows.filter((s) => s.met === b).length - rows.filter((s) => s.met === a).length)[0];

    made.push({ id: `segment|${met}|matrix:${key.split("|")[1]}|usd|`, cat: "segment", met, unit: "usd", label, bd: title, root: root?.k ?? null, rows: order, t: title });
    c.log?.push(`MATRIX [${key}] ${title}: ${rows.map((s) => s.label).join(", ")}${root ? ` = ${root.label}` : ""}`);
    if (root) {
      // Tie-out from the segments as they now read; the old checks counted another table's parts.
      for (const [kind, cells] of [["q", root.q], ["y", root.y]] as const)
        for (const [e, cell] of Object.entries(cells)) {
          const r = sumAt(kind, e);
          const n = r.n;
          if (n < 2) continue;
          const { ok, sum, sub } = tie(r, cell.v);
          const most = Math.max(...[...ends].filter(([x]) => (kind === "y") === x.startsWith("y")).map(([, v]) => v));
          // A segment not printed for that period: nothing to check against.
          if (!ok && n < most) continue;
          newChecks.push({ k: root.k, e, kind: kind === "q" ? "q" : "fy", total: cell.v, sum, ok, n, ...(sub.length ? { sub } : {}) });
        }
    }
  }
  // Lines folded together above may sit in other tables: every table follows the merged lines.
  const left: PayloadGroup[] = [];
  for (const g of groups) {
    const seen = new Set<string>();
    const rows = g.rows.map((r) => ({ ...r, k: resolve(c, r.k) })).filter((r) => !taken.has(r.k) && !c.removed.has(r.k) && !seen.has(r.k) && (seen.add(r.k), true));
    if (!rows.length) continue;
    if (rows.length === g.rows.length) {
      left.push(g);
      continue;
    }
    // Lines whose total moved away no longer add up to anything here.
    for (const r of rows) {
      const x = c.byKey.get(r.k);
      if (x?.parent && taken.has(x.parent)) x.parent = null;
    }
    // A total left without parts (or a table whose total moved) is a list of loose lines.
    const rootGone = !!g.root && (taken.has(g.root) || !rows.some((r) => c.byKey.get(r.k)?.parent === g.root));
    left.push({ ...g, rows: rootGone ? rows.map((r) => ({ ...r, depth: 1 })) : rows, root: rootGone ? null : g.root, ...(rootGone ? { t: undefined } : {}) });
  }
  const roots = new Set(made.map((g) => g.root).filter(Boolean));
  const have = new Set<string>();
  const kept: PayloadCheck[] = [];
  for (const x of checks) {
    const k = resolve(c, x.k);
    const id = `${k}|${x.kind}|${x.e}`;
    if (roots.has(k) || c.removed.has(k) || have.has(id)) continue;
    have.add(id);
    kept.push(k === x.k ? x : { ...x, k });
  }
  return { groups: [...made, ...left], checks: [...kept, ...newChecks] };
}

export function tidyPayload(p: IrPayload, opts: { log?: string[] } = {}): IrPayload {
  if (p.tidy === TIDY_VERSION && !opts.log) return p;
  const series = p.series.map((s) => ({ ...s, q: { ...s.q }, y: { ...s.y }, ...(s.mo ? { mo: { ...s.mo } } : {}) }));
  const out: IrPayload = { ...p, series, groups: p.groups.map((g) => ({ ...g, t: undefined, rows: [...g.rows] })), checks: p.checks.map((x) => ({ ...x })) };
  const c: Ctx = { p: out, byKey: new Map(series.map((s) => [s.k, s])), alias: new Map(Object.entries(p.alias ?? {})), removed: new Set(), kids: new Map(), renamed: new Map(), touched: new Set(), log: opts.log };
  for (const s of series) if (s.parent) c.kids.set(s.parent, [...(c.kids.get(s.parent) ?? []), s]);
  const before = { groups: out.groups.length, series: series.length };
  stocks(c);

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

  for (const clusters of clustersOf.values()) for (const cl of clusters) mergeCousins(c, cl.g);

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

  // 5. One table per measure by segment.
  const mx = segmentMatrices(c, groups, checks);
  groups = mx.groups;
  checks.splice(0, checks.length, ...mx.checks);

  // 4. Titles that tell tables apart: the total's own name, else the unit, else the years covered.
  groups = splitLoose(c, groups);
  for (const g of groups) if (g.px && !g.t) g.t = g.px;
  for (const g of groups) if (!g.root && !g.px && !g.id.includes("|matrix:")) g.t = looseTitle(g);
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
  const rechecked = checkable(c, groups, c.removed.size ? recheck(c, groups, checks) : checks);
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
