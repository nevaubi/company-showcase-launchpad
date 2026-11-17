// Multi-year filing detail: the latest 10-K's breakdown tables extended back with the columns of
// earlier 10-Ks. Each period column comes entirely from the newest filing that reports it, so a
// restated or re-segmented year is never mixed with its original presentation; values taken from
// an older filing carry that filing's accession and document so click-to-source opens the right
// document. Pure: shared by the Financials tab and the research assistant.
import type { ConcentrationRow, DetailPeriod, DetailRow, DetailTable, DetailValue, FilingDetail, SegmentMatrix, StoredDetail } from "@/lib/xbrl/detail";

/** Families whose columns are fiscal years or year-end balances; maturity ladders ("Year 1"…) stay as filed. */
const HISTORY_FAMILIES = new Set(["revenue", "costs", "geography", "inventory", "other", "concentration"]);

const norm = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
/** A fiscal year or a balance date; quarter and maturity-bucket columns never travel. */
const annualLike = (p: DetailPeriod | undefined) => !!p && !p.label && (p.months === 12 || p.months === 0);
const fromFiling = (v: DetailValue, f: FilingDetail): DetailValue => ({ ...v, accn: f.accn, doc: f.doc });
const byEnd = (periods: Record<string, DetailPeriod>) => (a: string, b: string) =>
  (periods[a]?.end ?? "").localeCompare(periods[b]?.end ?? "") || (periods[a]?.months ?? 0) - (periods[b]?.months ?? 0);

function cloneRow(r: DetailRow): DetailRow {
  return { ...r, values: { ...r.values }, ...(r.sub ? { sub: r.sub.map(cloneRow) } : {}) };
}

/** Label without parenthetical notes ("China (including Hong Kong)" → "china"). */
const core = (s: string) => norm(s.replace(/\([^)]*\)/g, ""));

/**
 * Find the matching row: same member first, then the same label (members get renamed between
 * filings), then the one row whose label differs only by a parenthetical note.
 */
function findRow(rows: DetailRow[], r: DetailRow): DetailRow | undefined {
  const exact = rows.find((x) => x.member === r.member) ?? rows.find((x) => norm(x.label) === norm(r.label));
  if (exact) return exact;
  const c = core(r.label);
  const loose = c ? rows.filter((x) => core(x.label) === c) : [];
  return loose.length === 1 ? loose[0] : undefined;
}

/** Copy one older row's values for `keys` (periods no newer filing reported) into `rows`. */
function mergeRow(rows: DetailRow[], r: DetailRow, keys: Set<string>, f: FilingDetail): boolean {
  const vals = Object.entries(r.values).filter(([k]) => keys.has(k));
  const subs = (r.sub ?? []).filter((s) => Object.keys(s.values).some((k) => keys.has(k)));
  if (!vals.length && !subs.length) return false;
  let t = findRow(rows, r);
  if (!t) {
    t = { member: r.member, label: r.label, values: {}, former: true };
    rows.push(t);
  }
  for (const [k, v] of vals) t.values[k] ??= fromFiling(v, f);
  if (subs.length) {
    t.sub ??= [];
    for (const s of subs) mergeRow(t.sub, s, keys, f);
  }
  return true;
}

/** Same table in another filing: identical id, else same family/axis/unit and concept label. */
function matchTable(tables: DetailTable[], t: DetailTable): DetailTable | undefined {
  return (
    tables.find((x) => x.id === t.id) ??
    tables.find((x) => x.family === t.family && x.axis === t.axis && x.unit === t.unit && x.id.split("|").length === t.id.split("|").length && norm(x.conceptLabel) === norm(t.conceptLabel))
  );
}

function mergeTable(out: DetailTable, m: DetailTable, f: FilingDetail, periods: Record<string, DetailPeriod>) {
  const keys = new Set(m.periods.filter((k) => !out.periods.includes(k) && annualLike(f.periods[k])));
  if (!keys.size) return;
  let used = false;
  for (const r of m.rows) used = mergeRow(out.rows, r, keys, f) || used;
  // Totals travel only into a table whose latest filing also passed the add-up check for its total.
  if (m.total && out.total) for (const [k, v] of Object.entries(m.total)) if (keys.has(k)) out.total[k] ??= fromFiling(v, f);
  if (!used) return;
  for (const k of keys) {
    periods[k] ??= f.periods[k];
    out.periods.push(k);
  }
}

function mergeSegments(out: SegmentMatrix, m: SegmentMatrix, f: FilingDetail, periods: Record<string, DetailPeriod>) {
  const keys = new Set(m.periods.filter((k) => !out.periods.includes(k) && annualLike(f.periods[k])));
  if (!keys.size) return;
  // Segment columns: same member, else same label; segments that no longer exist are appended.
  const segOf = new Map<string, string>();
  for (const s of m.segments) {
    const t = out.segments.find((x) => x.member === s.member) ?? out.segments.find((x) => norm(x.label) === norm(s.label));
    if (t) segOf.set(s.member, t.member);
    else {
      out.segments.push({ ...s });
      segOf.set(s.member, s.member);
    }
  }
  let used = false;
  for (const r of m.rows) {
    let t = out.rows.find((x) => x.concept === r.concept) ?? out.rows.find((x) => norm(x.label) === norm(r.label));
    const add = Object.entries(r.values).flatMap(([seg, byP]) => Object.entries(byP).filter(([k]) => keys.has(k)).map(([k, v]) => [segOf.get(seg) ?? seg, k, v] as const));
    if (!add.length) continue;
    if (!t) {
      t = { ...r, values: {} };
      out.rows.push(t);
    }
    for (const [seg, k, v] of add) (t.values[seg] ??= {})[k] ??= fromFiling(v, f);
    used = true;
  }
  if (!used) return;
  for (const k of keys) {
    periods[k] ??= f.periods[k];
    out.periods.push(k);
  }
}

function mergeConcentration(out: ConcentrationRow[], rows: ConcentrationRow[], f: FilingDetail, periods: Record<string, DetailPeriod>) {
  for (const r of rows) {
    const group = (x: ConcentrationRow) => x.kind === r.kind && x.benchmark === r.benchmark;
    const covered = new Set(out.filter(group).flatMap((x) => Object.keys(x.values)));
    const vals = Object.entries(r.values).filter(([k]) => !covered.has(k) && annualLike(f.periods[k]));
    if (!vals.length) continue;
    let t = out.find((x) => group(x) && x.member === r.member) ?? out.find((x) => group(x) && norm(x.label) === norm(r.label));
    if (!t) {
      t = { ...r, values: {} };
      out.push(t);
    }
    for (const [k, v] of vals) {
      t.values[k] ??= fromFiling(v, f);
      periods[k] ??= f.periods[k];
    }
  }
}

/**
 * The latest 10-K with every breakdown extended back through `older` 10-Ks. Tables, the segment P&L
 * and concentration gain earlier fiscal-year columns; commitment ladders and the counts stay as filed.
 */
export function mergeHistory(latest: FilingDetail, older: FilingDetail[]): FilingDetail {
  const olds = older.filter((o) => o.accn !== latest.accn && o.reportDate < latest.reportDate).sort((a, b) => b.reportDate.localeCompare(a.reportDate));
  if (!olds.length) return latest;
  const periods = { ...latest.periods };
  const tables = latest.tables.map((t) => {
    if (!HISTORY_FAMILIES.has(t.family)) return t;
    const out: DetailTable = { ...t, periods: [...t.periods], rows: t.rows.map(cloneRow), ...(t.total ? { total: { ...t.total } } : {}) };
    for (const o of olds) {
      const m = matchTable(o.tables, t);
      if (m) mergeTable(out, m, o, periods);
    }
    out.periods.sort(byEnd(periods));
    return out;
  });
  let segments = latest.segments;
  if (segments) {
    const out: SegmentMatrix = { periods: [...segments.periods], segments: segments.segments.map((s) => ({ ...s })), rows: segments.rows.map((r) => ({ ...r, values: Object.fromEntries(Object.entries(r.values).map(([k, v]) => [k, { ...v }])) })) };
    for (const o of olds) if (o.segments) mergeSegments(out, o.segments, o, periods);
    out.periods.sort(byEnd(periods));
    segments = out;
  }
  const concentration = latest.concentration.map((r) => ({ ...r, values: { ...r.values } }));
  for (const o of olds) mergeConcentration(concentration, o.concentration, o, periods);
  return { ...latest, periods, tables, segments, concentration };
}

/** Annual detail extended with the stored earlier 10-Ks, or null when there is no annual filing. */
export function annualWithHistory(stored: StoredDetail): FilingDetail | null {
  if (!stored.annual) return null;
  return stored.history?.length ? mergeHistory(stored.annual, stored.history) : stored.annual;
}

/** Fiscal-year span of a merged detail ("FY2019–FY2025"), from its annual columns. */
export function historySpan(d: FilingDetail): string | null {
  const years = [...new Set(Object.values(d.periods).filter((p) => p.months === 12).map((p) => p.end.slice(0, 4)))].sort();
  return years.length >= 2 ? `FY${years[0]}–FY${years[years.length - 1]}` : null;
}

/** Which filing each period column comes from, newest first, for citations. */
export function periodSources(d: FilingDetail): { accn: string; doc: string; keys: string[] }[] {
  const by = new Map<string, { accn: string; doc: string; keys: Set<string> }>();
  const note = (k: string, v: DetailValue) => {
    const accn = v.accn ?? d.accn;
    const e = by.get(accn) ?? { accn, doc: v.doc ?? d.doc, keys: new Set<string>() };
    e.keys.add(k);
    by.set(accn, e);
  };
  const walk = (r: DetailRow) => {
    for (const [k, v] of Object.entries(r.values)) note(k, v);
    r.sub?.forEach(walk);
  };
  for (const t of d.tables) t.rows.forEach(walk);
  for (const r of d.segments?.rows ?? []) for (const byP of Object.values(r.values)) for (const [k, v] of Object.entries(byP)) note(k, v);
  const end = (keys: Set<string>) => [...keys].map((k) => d.periods[k]?.end ?? "").sort().pop() ?? "";
  return [...by.values()].sort((a, b) => end(b.keys).localeCompare(end(a.keys))).map((e) => ({ accn: e.accn, doc: e.doc, keys: [...e.keys] }));
}
