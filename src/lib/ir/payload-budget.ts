// Pure: the payload is bounded by what the IR page shows, not by how many documents are stored. After the build:
// 1. sections are laid out only from tables of documents filed in the newest 37 months; a series is kept only
//    when a kept section's row uses it (its history from older documents stays, inside those rows) or it carries
//    a standard key (`sc`, read by the standardized KPIs); groups, checks, aliases, table layouts and fill
//    conflicts follow the kept series and sections;
// 2. over the cap (8 MB serialized), sections of the "more" group are dropped from the oldest documents first;
// 3. still over, periods older than 40 quarters before the newest are dropped;
// 4. still over: not ok (the rebuild does not upload it and reports the sizes).
// Each step is recorded in `stats.quality.budget`.
import type { IrPayload, PayloadSeries } from "@/lib/ir/payload";
import { assembleStatements, type Statement } from "@/lib/ir/statements";

export const BUDGET_BYTES = 8e6;
export const BUDGET_MONTHS = 37;
export const BUDGET_QUARTERS = 40;

export interface BudgetStep {
  step: "recent" | "more" | "periods";
  /** serialized bytes after the step */
  bytes: number;
  /** sections or periods dropped */
  dropped: number;
}

export interface PayloadBudget {
  /** serialized bytes of the payload as built */
  before: number;
  after: number;
  cap: number;
  ok: boolean;
  steps: BudgetStep[];
  sections: { built: number; kept: number };
  series: { built: number; kept: number };
}

const monthsBack = (d: string, n: number) => {
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 - n, Math.min(day, 28))).toISOString().slice(0, 10);
};

const size = (p: IrPayload) => JSON.stringify(p).length;

/** The payload reduced to the given sections' series (and every series with a standard key). */
function keepSections(p: IrPayload, kept: Statement[]): IrPayload {
  const keys = new Set<string>();
  for (const s of kept) {
    for (const k of s.keys) keys.add(k);
    for (const r of s.rows) if (r.kind === "line") for (const k of r.ks) keys.add(k);
  }
  for (const s of p.series) if (s.sc) keys.add(s.k);
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
  const tables = p.tables
    ? Object.fromEntries(Object.entries(p.tables).filter(([id]) => ids.has(id)))
    : undefined;
  const docsKept = new Set(kept.map((s) => s.doc));
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

/** Bound a built payload (see the module comment). */
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
  let kept = recent;
  let out = keepSections(p, kept);
  let bytes = size(out);
  steps.push({ step: "recent", bytes, dropped: all.length - recent.length });
  if (bytes > cap) {
    // "More" sections from the oldest documents first, one document at a time.
    const more = [...new Set(kept.filter((s) => s.group === "more").map((s) => s.doc))].sort(
      (a, b) => (p.docs[a]?.filed ?? "").localeCompare(p.docs[b]?.filed ?? "") || a - b,
    );
    let dropped = 0;
    for (const d of more) {
      if (bytes <= cap) break;
      const n = kept.length;
      kept = kept.filter((s) => !(s.group === "more" && s.doc === d));
      dropped += n - kept.length;
      out = keepSections(p, kept);
      bytes = size(out);
    }
    steps.push({ step: "more", bytes, dropped });
  }
  if (bytes > cap) {
    const qs = [...out.quarters].sort();
    const keepQ = qs.slice(-(opts.quarters ?? BUDGET_QUARTERS));
    const cutFrom = keepQ[0] ?? "";
    const series = out.series.map((s) => cutSeries(s, cutFrom));
    const dropped = qs.length - keepQ.length;
    out = {
      ...out,
      series,
      quarters: out.quarters.filter((e) => e >= cutFrom),
      years: out.years.filter((e) => e >= cutFrom),
      ...(out.months ? { months: out.months.filter((e) => e >= cutFrom) } : {}),
      checks: out.checks.filter((c) => c.e >= cutFrom),
    };
    bytes = size(out);
    steps.push({ step: "periods", bytes, dropped });
  }
  return {
    payload: out,
    budget: {
      before,
      after: bytes,
      cap,
      ok: bytes <= cap,
      steps,
      sections: { built: all.length, kept: kept.length },
      series: { built: p.series.length, kept: out.series.length },
    },
  };
}
