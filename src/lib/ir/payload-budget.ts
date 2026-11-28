// Pure: the payload is bounded by what the IR page shows, not by how many documents are stored. After the build:
// 1. "recent": sections are laid out only from tables of documents filed in the newest 37 months; a series is
//    kept only when a kept section's row uses it (its history from older documents stays, inside those rows) or
//    it carries a table scope (`sc`, retained while there is room); groups, checks, aliases, table layouts and
//    fill conflicts follow the kept series and sections.
// Over the cap (8 MB serialized), in this order, each step only as far as needed:
// 2. "more": sections of the "more" group are dropped, from the oldest documents first;
// 3. "displayed": lines no kept section shows (unplaced table scopes) are dropped;
// 4. "periods": periods older than 40 quarters before the newest are dropped;
// 5. "old": lines only earlier documents print (listed under a table as "Printed only in earlier periods") are
//    dropped, from the "more" group first, then the other tables, then the main document's;
// 6. "periods" again: shorter history (32, 24, 20, 16, 12, 8 quarters), the last resort.
// What the page shows of the rows a table prints now is given up last: a bank's statements keep ten years
// before its retired lines and its history are cut. Before this order the history went first, and JPMorgan's
// page fell to 20 quarters to keep lines the page hid by default. Whatever a step drops stays in the full
// history the build stores beside the page file. Each step is recorded in `stats.quality.budget`.
import type { IrPayload, PayloadSeries } from "@/lib/ir/payload";
import { assembleStatements, ytdCols, type Statement } from "@/lib/ir/statements";

export const BUDGET_BYTES = 8e6;
export const BUDGET_MONTHS = 37;
export const BUDGET_QUARTERS = 40;

/** Quarters of history tried, in order, once 40 quarters and the retired lines are not enough. */
export const BUDGET_SHORTER = [32, 24, 20, 16, 12, 8];

export interface BudgetStep {
  step: "recent" | "more" | "periods" | "displayed" | "old";
  /** serialized bytes after the step */
  bytes: number;
  /** sections, lines or periods dropped */
  dropped: number;
  /** "periods": quarters of history kept */
  quarters?: number;
}

export interface PayloadBudget {
  /** serialized bytes of the payload as built */
  before: number;
  after: number;
  cap: number;
  ok: boolean;
  steps: BudgetStep[];
  /** a step past "more" dropped something: the page file holds less than the build, which the archive keeps */
  cut: boolean;
  sections: { built: number; kept: number };
  series: { built: number; kept: number };
}

const monthsBack = (d: string, n: number) => {
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 - n, Math.min(day, 28))).toISOString().slice(0, 10);
};

const size = (p: IrPayload) => new Blob([JSON.stringify(p)]).size;

/**
 * The payload reduced to the given sections' series (and unplaced scoped series when there is room). `noOld`:
 * groups whose lines only earlier documents print are left out (a line another kept row shows stays).
 */
function keepSections(
  p: IrPayload,
  kept: Statement[],
  keepUnplaced = true,
  noOld: ReadonlySet<Statement["group"]> = new Set(),
): IrPayload {
  const keys = new Set<string>();
  for (const s of kept) {
    const retired = new Set<string>();
    if (noOld.has(s.group))
      for (const r of s.rows) if (r.kind === "line" && r.old) for (const k of r.ks) retired.add(k);
    for (const r of s.rows) if (r.kind === "line" && !(r.old && noOld.has(s.group))) for (const k of r.ks) keys.add(k);
    for (const k of s.keys) if (!retired.has(k)) keys.add(k);
  }
  if (keepUnplaced) for (const s of p.series) if (s.sc) keys.add(s.k);
  // A kept line's parent chain stays (hierarchy and checks read it).
  const byKey = new Map(p.series.map((s) => [s.k, s]));
  for (const k of [...keys]) {
    let cur = byKey.get(k)?.parent;
    while (cur && !keys.has(cur)) {
      keys.add(cur);
      cur = byKey.get(cur)?.parent;
    }
  }
  const series = p.series.filter((s) => keys.has(s.k));
  const ids = new Set(kept.map((s) => s.id));
  const docsKept = new Set(kept.map((s) => s.doc));
  // A year-to-date table of a kept document keeps its entry although it is no section (`assembleStatements`
  // leaves it out as a repeat of the quarter's statement): without its columns it would read as a section again.
  const tables = p.tables
    ? Object.fromEntries(
        Object.entries(p.tables).filter(
          ([id, cap]) => ids.has(id) || (ytdCols(cap) === true && docsKept.has(Number(id.split(":")[0]))),
        ),
      )
    : undefined;
  const groups = p.groups
    .map((g) => ({ ...g, rows: g.rows.filter((r) => keys.has(r.k)) }))
    .filter((g) => g.rows.length);
  const alias = p.alias
    ? Object.fromEntries(Object.entries(p.alias).filter(([, v]) => keys.has(v)))
    : undefined;
  const fill = p.fill
    ? (() => {
        const conflicts = p.fill!.conflicts.filter((c) => docsKept.has(c.d));
        return conflicts.length ? { conflicts, n: conflicts.length } : undefined;
      })()
    : undefined;
  const out: IrPayload = {
    ...p,
    series,
    groups,
    checks: p.checks.filter((c) => keys.has(c.k)),
    stats: { ...p.stats, series: series.length },
  };
  if (tables) out.tables = tables;
  else delete out.tables;
  if (alias) out.alias = alias;
  else delete out.alias;
  if (fill) out.fill = fill;
  else delete out.fill;
  return out;
}

/** Cells of a series older than `from` (period end) dropped. */
function cutSeries(s: PayloadSeries, from: string): PayloadSeries {
  const cut = <T>(m: Record<string, T> | undefined) =>
    m ? Object.fromEntries(Object.entries(m).filter(([e]) => e >= from)) : m;
  return {
    ...s,
    q: cut(s.q)!,
    y: cut(s.y)!,
    ...(s.mo ? { mo: cut(s.mo) } : {}),
    ...(s.held
      ? {
          held: {
            q: cut(s.held.q),
            y: cut(s.held.y),
            ...(s.held.mo ? { mo: cut(s.held.mo) } : {}),
          },
        }
      : {}),
  };
}

/** The payload with only its newest `n` quarters (years, months, cells and checks from the oldest kept quarter on). */
function cutPeriods(p: IrPayload, n: number): IrPayload {
  const qs = [...p.quarters].sort();
  if (qs.length <= n) return p;
  const cutFrom = qs.slice(-n)[0] ?? "";
  return {
    ...p,
    series: p.series.map((s) => cutSeries(s, cutFrom)),
    quarters: p.quarters.filter((e) => e >= cutFrom),
    years: p.years.filter((e) => e >= cutFrom),
    ...(p.months ? { months: p.months.filter((e) => e >= cutFrom) } : {}),
    checks: p.checks.filter((c) => c.e >= cutFrom),
  };
}

/** Bound a built payload (see the module comment). `quarters`: the first history cut (40). */
export function budgetPayload(
  p: IrPayload,
  opts: { cap?: number; months?: number; quarters?: number } = {},
): { payload: IrPayload; budget: PayloadBudget } {
  const cap = opts.cap ?? BUDGET_BYTES;
  const before = size(p);
  const steps: BudgetStep[] = [];
  const newest = p.docs.reduce((m, d) => (d.filed && d.filed > m ? d.filed : m), "");
  const from = newest ? monthsBack(newest, opts.months ?? BUDGET_MONTHS) : "";
  const all = assembleStatements(p);
  // A document without a filing date stays (it may be the release, `arrange`).
  const recent = all.filter((s) => {
    const f = p.docs[s.doc]?.filed;
    return !f || f >= from;
  });
  // What is kept, and the payload it gives.
  let kept = recent;
  let unplaced = true;
  const noOld = new Set<Statement["group"]>();
  let quarters: number | null = null;
  const make = (sections = kept) => {
    const base = keepSections(p, sections, unplaced, noOld);
    return quarters == null ? base : cutPeriods(base, quarters);
  };
  let out = make();
  let bytes = size(out);
  steps.push({ step: "recent", bytes, dropped: all.length - recent.length });
  if (bytes > cap) {
    // "More" sections from the oldest documents first, a document at a time: the fewest documents that fit,
    // found by halving (a bank's 500 older tables took a serialization each).
    const more = [...new Set(kept.filter((s) => s.group === "more").map((s) => s.doc))].sort(
      (a, b) => (p.docs[a]?.filed ?? "").localeCompare(p.docs[b]?.filed ?? "") || a - b,
    );
    const without = (n: number) => {
      const gone = new Set(more.slice(0, n));
      return kept.filter((s) => !(s.group === "more" && gone.has(s.doc)));
    };
    let lo = 0;
    let hi = more.length;
    if (more.length && size(make(without(more.length))) > cap) lo = more.length;
    else
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (size(make(without(mid))) <= cap) hi = mid;
        else lo = mid + 1;
      }
    const n = kept.length;
    kept = without(lo);
    out = make();
    bytes = size(out);
    steps.push({ step: "more", bytes, dropped: n - kept.length });
  }
  // `sc` is a table scope, not a standardized measure ID: lines no kept section shows go before any history.
  if (bytes > cap) {
    const previous = out.series.length;
    unplaced = false;
    out = make();
    bytes = size(out);
    steps.push({ step: "displayed", bytes, dropped: previous - out.series.length });
  }
  const cut = (n: number) => {
    const had = (quarters == null ? p.quarters.length : Math.min(quarters, p.quarters.length));
    quarters = n;
    out = make();
    bytes = size(out);
    steps.push({ step: "periods", bytes, dropped: Math.max(0, had - out.quarters.length), quarters: out.quarters.length });
  };
  if (bytes > cap) cut(opts.quarters ?? BUDGET_QUARTERS);
  // Lines only earlier documents print, before the rows the tables print now lose more history.
  if (bytes > cap) {
    const previous = out.series.length;
    for (const g of ["more", "other", "main"] as const) {
      if (bytes <= cap) break;
      noOld.add(g);
      out = make();
      bytes = size(out);
    }
    steps.push({ step: "old", bytes, dropped: previous - out.series.length });
  }
  for (const n of BUDGET_SHORTER) {
    if (bytes <= cap) break;
    if (n >= (quarters ?? Infinity)) continue;
    cut(n);
  }
  return {
    payload: out,
    budget: {
      before,
      after: bytes,
      cap,
      ok: bytes <= cap,
      steps,
      cut: steps.some((x) => x.step !== "recent" && x.step !== "more" && x.dropped > 0),
      sections: { built: all.length, kept: kept.length },
      series: { built: p.series.length, kept: out.series.length },
    },
  };
}
