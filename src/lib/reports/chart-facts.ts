// Which facts a finished report must keep: cited ones, every plotted value, the glance tiles, and
// the members behind composite (cross-company / comparison) facts. Pure.
import type { Fact, GlanceItem, ReportChart, ReportSection } from "./types";

export function chartFactIds(c: ReportChart): string[] {
  const out: (string | undefined)[] = [];
  switch (c.type) {
    case "combo":
    case "stacked":
      for (const s of c.series) for (const p of s.points) out.push(p.f);
      break;
    case "peers":
      for (const m of c.metrics) out.push(m.medianF);
      for (const r of c.rows) for (const p of r.cells) out.push(p.f);
      break;
    case "scatter":
      for (const p of c.points) out.push(p.fx, p.fy);
      out.push(c.fit?.f);
      break;
    case "band":
      out.push(c.f);
      break;
    case "range":
      for (const r of c.rows) { out.push(r.f); for (const m of r.marks) out.push(m.f); }
      out.push(c.current?.f);
      break;
    case "hbar":
      for (const r of c.rows) out.push(r.f);
      break;
  }
  return out.filter((x): x is string => !!x);
}

export function keptFactIds(sections: ReportSection[], charts: ReportChart[], glance: GlanceItem[], facts: Fact[]): Set<string> {
  const keep = new Set<string>();
  for (const s of sections) for (const c of [...s.paragraphs, ...s.bullets]) for (const id of c.factIds) keep.add(id);
  for (const c of charts) for (const id of chartFactIds(c)) keep.add(id);
  for (const g of glance) if (g.f) keep.add(g.f);
  const byId = new Map(facts.map((f) => [f.id, f]));
  for (const id of [...keep]) {
    const f = byId.get(id);
    if (f?.ref.kind === "composite") for (const m of f.ref.members) keep.add(m);
  }
  return keep;
}
