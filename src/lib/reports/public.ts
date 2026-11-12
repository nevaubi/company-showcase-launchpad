// The public (no sign-in) cut of a stored standard report: the cover facts and the first sections in
// full, the rest by title only. Pure, so the server function, the page and tests share it.
// The cut happens on the server: sections, tables, charts and facts behind the gate never reach the browser.
import { citationOrder } from "./vet";
import type { Fact, ReportChart, ReportContent } from "./types";

/** Sections shown in full on the public page. */
export const PUBLIC_FREE_SECTIONS = 2;

export interface PublicReport {
  /** The report trimmed to its free sections and only the facts, tables and charts they use. */
  content: ReportContent;
  /** Sections kept behind sign-in, in order. */
  locked: { id: string; title: string }[];
  /** Counts across the whole report, for the trust line and the gate. */
  totals: { sections: number; sources: number; charts: number; tables: number };
}

/** Every fact id a chart points at (plotted values, medians, fits, marks). */
function chartFactIds(c: ReportChart): string[] {
  const ids: (string | undefined)[] = [];
  switch (c.type) {
    case "combo":
    case "stacked":
      for (const s of c.series) for (const p of s.points) ids.push(p.f);
      break;
    case "peers":
      for (const m of c.metrics) ids.push(m.medianF);
      for (const r of c.rows) for (const p of r.cells) ids.push(p.f);
      break;
    case "scatter":
      for (const p of c.points) ids.push(p.fx, p.fy);
      ids.push(c.fit?.f);
      break;
    case "band":
      ids.push(c.f);
      break;
    case "range":
      for (const r of c.rows) {
        ids.push(r.f);
        for (const k of r.marks) ids.push(k.f);
      }
      ids.push(c.current?.f);
      break;
    case "hbar":
      for (const r of c.rows) ids.push(r.f);
      break;
  }
  return ids.filter((x): x is string => !!x);
}

export function publicSlice(full: ReportContent, free = PUBLIC_FREE_SECTIONS): PublicReport {
  const sections = full.sections.slice(0, Math.max(1, free));
  const locked = full.sections.slice(sections.length).map((s) => ({ id: s.id, title: s.title }));

  const tableIds = new Set(sections.flatMap((s) => s.tables));
  const chartIds = new Set(sections.flatMap((s) => s.charts ?? []));
  const tables = full.tables.filter((t) => tableIds.has(t.id));
  const charts = (full.charts ?? []).filter((c) => chartIds.has(c.id));

  // Facts the free part can open: cited by its claims, shown in the headline tiles, plotted in its
  // charts, plus the members behind any composite among them (peer medians, fits).
  const byId = new Map(full.facts.map((f) => [f.id, f]));
  const keep = new Set<string>();
  const add = (id: string | undefined) => {
    if (!id || keep.has(id)) return;
    const f = byId.get(id);
    if (!f) return;
    keep.add(id);
    if (f.ref.kind === "composite") for (const m of f.ref.members) add(m);
  };
  for (const s of sections)
    for (const c of [...s.paragraphs, ...s.bullets]) for (const id of c.factIds) add(id);
  for (const g of full.glance ?? []) add(g.f);
  for (const c of charts) for (const id of chartFactIds(c)) add(id);
  const facts: Fact[] = full.facts.filter((f) => keep.has(f.id));

  return {
    content: { ...full, sections, tables, charts, facts },
    locked,
    totals: {
      sections: full.sections.length,
      sources: citationOrder(full.sections).size,
      charts: (full.charts ?? []).length,
      tables: full.tables.length,
    },
  };
}

/** One-sentence description for search results and link previews, from the subtitle and the trust line. */
export function publicDescription(
  c: Pick<ReportContent, "name" | "ticker" | "subtitle" | "qa">,
  sources: number,
): string {
  const checked = c.qa.numbers
    ? `${c.qa.verifiedNumbers} of ${c.qa.numbers} figures matched to SEC filings`
    : "every statement cited to SEC filings";
  const lead = c.subtitle?.trim() ? `${c.subtitle.trim().replace(/\.$/, "")}. ` : "";
  return `${lead}${c.name} (${c.ticker}) primer: ${checked}, ${sources} sources cited.`.slice(
    0,
    300,
  );
}
