// Known-wrong IR sources: files stored under a covered ticker that the reviewed list in
// `source-guard-list.ts` shows to be another company's (or no company's). Pure, shared by the
// readers (scripts/lib/runner.ts, ir-docling.ts), the series build (rebuild.server.ts), the page
// (ir.functions.ts, external.ts) and the IR-site collectors.
// It removes files known to be wrong. It does not certify that any other file is the company's.
import { projectedMeasure } from "./reported-scope";
import type { IrPayload, PayloadCell, PayloadSeries } from "@/lib/ir/payload";
import { GUARDED_SOURCES, type GuardedSource } from "@/lib/ir/source-guard-list";

/** Status the readers store on a refused file, so it is never claimed again. */
export const GUARD_STATUS = "skipped:other-company";

const byTicker = new Map<string, GuardedSource[]>();
for (const g of GUARDED_SOURCES) {
  const k = g.ticker.toUpperCase();
  byTicker.set(k, [...(byTicker.get(k) ?? []), g]);
}

/** Whether any reviewed wrong source is listed for this ticker (lets callers skip extra reads). */
export const hasGuardedSources = (ticker: string): boolean => byTicker.has(ticker.toUpperCase());

function parse(url: string): { host: string; path: string } | null {
  try {
    const u = new URL(url);
    return { host: u.hostname.toLowerCase(), path: u.pathname };
  } catch {
    return null;
  }
}

/** The reviewed entry that refuses this file for this ticker, or null when none does. */
export function guardedSourceOf(ticker: string, url: string | null | undefined): GuardedSource | null {
  if (!url) return null;
  const list = byTicker.get(ticker.toUpperCase());
  if (!list) return null;
  const u = parse(url);
  if (!u) return null;
  for (const g of list) {
    const h = g.host.toLowerCase();
    if (u.host !== h && !u.host.endsWith(`.${h}`)) continue;
    if (g.path && !u.path.startsWith(g.path)) continue;
    return g;
  }
  return null;
}

/** False for a file the reviewed list shows to belong to another company. */
export const isIrFileAllowed = (ticker: string, url: string | null | undefined): boolean => !guardedSourceOf(ticker, url);

/** Documents of one company without the known-wrong ones. */
export function withoutGuardedDocs<T extends { ticker?: string | null; source_url?: string | null }>(ticker: string, docs: T[]): T[] {
  if (!hasGuardedSources(ticker)) return docs;
  return docs.filter((d) => isIrFileAllowed(d.ticker ?? ticker, d.source_url));
}

/** Ids of a company's documents that the reviewed list refuses. */
export function guardedDocIds(ticker: string, docs: { id: string; source_url?: string | null }[]): Set<string> {
  const out = new Set<string>();
  if (!hasGuardedSources(ticker)) return out;
  for (const d of docs) if (guardedSourceOf(ticker, d.source_url)) out.add(d.id);
  return out;
}

/** Stored facts without those read from refused documents (before a series build). */
export function withoutGuardedFacts<T extends { document_id?: string | null }>(facts: T[], refused: Set<string>): T[] {
  if (!refused.size) return facts;
  return facts.filter((f) => !f.document_id || !refused.has(f.document_id));
}

/**
 * A stored series payload without any figure sourced to a refused document: cells (and the
 * other-vintage `alt`, and formula cells with a refused part) are dropped, then series left with
 * no cells, their group rows, groups left empty and checks of removed lines. Payloads built
 * before the guard existed may still hold such figures; the page must not show them.
 */
export function withoutGuardedCells(payload: IrPayload, refused: Set<string>, reportedOnly = false): IrPayload {
  const excludedLines = new Set(reportedOnly ? payload.series.filter(s => projectedMeasure(s.label) || projectedMeasure(s.bd)).map(s => s.k) : []);
  if (!refused.size && !excludedLines.size) return payload;
  const bad = new Set<number>();
  payload.docs.forEach((d, i) => {
    if (refused.has(d.id)) bad.add(i);
  });
  if (!bad.size && !excludedLines.size) return payload;
  const refusedCell = (c: PayloadCell) => (c.d != null && bad.has(c.d)) || !!c.f?.parts.some((p) => p.d != null && bad.has(p.d));
  const clean = (cells: Record<string, PayloadCell> | undefined): Record<string, PayloadCell> | undefined => {
    if (!cells) return cells;
    const out: Record<string, PayloadCell> = {};
    for (const [k, c] of Object.entries(cells)) {
      if (refusedCell(c)) continue;
      if (c.alt?.d != null && bad.has(c.alt.d)) {
        const { alt: _alt, ...rest } = c;
        out[k] = rest;
      } else out[k] = c;
    }
    return out;
  };
  const count = (r: Record<string, PayloadCell> | undefined) => (r ? Object.keys(r).length : 0);
  const series: PayloadSeries[] = [];
  for (const s of payload.series) {
    if (excludedLines.has(s.k)) continue;
    const q = clean(s.q) ?? {};
    const y = clean(s.y) ?? {};
    const mo = clean(s.mo);
    const held = s.held ? { q: clean(s.held.q), y: clean(s.held.y), mo: clean(s.held.mo) } : undefined;
    const n = count(q) + count(y) + count(mo) + count(held?.q) + count(held?.y) + count(held?.mo);
    if (!n) continue;
    series.push({ ...s, q, y, ...(s.at ? { at: s.at.filter(([d]) => !bad.has(d)) } : {}), ...(mo ? { mo } : {}), ...(held ? { held } : {}) });
  }
  const keep = new Set(series.map((s) => s.k));
  const groups = payload.groups
    .map((g) => ({ ...g, rows: g.rows.filter((r) => keep.has(r.k)), root: g.root && keep.has(g.root) ? g.root : null }))
    .filter((g) => g.rows.length > 0);
  const checks = payload.checks.filter((c) => keep.has(c.k));
  const tables = payload.tables && Object.fromEntries(Object.entries(payload.tables).filter(([key]) => !bad.has(Number(key.split(":")[0]))));
  return { ...payload, series, groups, checks, ...(tables ? { tables } : {}), stats: { ...payload.stats, series: series.length, groups: groups.length } };
}

/** For the IR-site collectors: true when the site listed for a company is a reviewed wrong source. */
export const siteIsGuarded = (ticker: string, site: string | null | undefined): boolean => !!guardedSourceOf(ticker, site);
