// "Where the money comes from and where it goes", from one filing's detail (pure).
// Sources (products or regions) → revenue → segments → each segment's costs and profit.
// Every flow is a tagged value or a remainder whose formula names its tagged parts.
import type { DetailValue, FilingDetail, SegmentMatrix } from "@/lib/xbrl/detail";

export interface FlowPart {
  label: string;
  concept: string;
  periodKey: string;
  v: number;
  id?: string;
  sign: 1 | -1;
}
export interface MoneyNode {
  id: string;
  label: string;
  col: 0 | 1 | 2 | 3;
  value: number;
  kind: "source" | "total" | "segment" | "cost" | "profit" | "other";
}
export interface MoneyLink {
  from: string;
  to: string;
  value: number;
  /** a single tagged value */
  ref?: FlowPart;
  /** a remainder or sum: formula over tagged parts */
  derived?: { formula: string; parts: FlowPart[] };
}
export interface MoneyMap {
  periodKey: string;
  source: "product" | "geography";
  sources: ("product" | "geography")[];
  total: number;
  nodes: MoneyNode[];
  links: MoneyLink[];
  notes: string[];
}

const REVENUE_CONCEPT = /Revenue|Sales/;
const near = (a: number, b: number, tol = 0.03) => Math.abs(a - b) <= Math.abs(b) * tol;
const part = (label: string, concept: string, periodKey: string, v: DetailValue, sign: 1 | -1 = 1): FlowPart => ({ label, concept, periodKey, v: v.v, ...(v.id ? { id: v.id } : {}), sign });

interface SourceRow {
  member: string;
  label: string;
  v: number;
  parts: FlowPart[];
}
/**
 * Revenue by product or region for the period. A segment × product table is summed per product
 * across segments (eliminations and all-segment columns left out), so each source names its parts.
 */
function sourceTables(d: FilingDetail, periodKey: string) {
  const out: { kind: "product" | "geography"; rows: SourceRow[]; nested: boolean }[] = [];
  for (const t of d.tables) {
    if (t.unit !== "USD" || !REVENUE_CONCEPT.test(t.concept) || !t.periods.includes(periodKey)) continue;
    const nested = t.rows.some((r) => r.sub?.length);
    if (nested && t.axis !== SEG) continue;
    const axis = nested ? t.title : t.axis;
    const kind = /ProductOrServiceAxis|product \/ service/.test(axis) ? "product" : /StatementGeographicalAxis|geography/.test(axis) ? "geography" : null;
    if (!kind) continue;
    const rows = new Map<string, SourceRow>();
    const add = (member: string, label: string, v: DetailValue | undefined, partLabel: string) => {
      if (!v) return;
      const r = rows.get(member) ?? { member, label, v: 0, parts: [] };
      r.v += v.v;
      r.parts.push(part(partLabel, t.concept, periodKey, v));
      rows.set(member, r);
    };
    if (nested) {
      for (const seg of t.rows) {
        if (AGGREGATE.test(seg.member) || AGGREGATE.test(seg.label)) continue;
        for (const x of seg.sub ?? []) add(x.member, x.label, x.values[periodKey], `${seg.label} — ${x.label}`);
      }
    } else for (const r of t.rows) add(r.member, r.label, r.values[periodKey], r.label);
    const list = [...rows.values()].sort((a, b) => b.v - a.v);
    const positive = list.filter((r) => r.v > 0);
    if (positive.length < 2 || positive.length > 16) continue;
    out.push({ kind, rows: list, nested });
  }
  return out;
}
const SEG = "us-gaap:StatementBusinessSegmentsAxis";
/** Members that stand for all segments together, or reconciling columns. */
const AGGREGATE = /OperatingSegmentsAndCorporateNonSegment|ConsolidatedEntit|Consolidat|Eliminat|Reconcil|Intersegment|Total/i;

/** The consolidated revenue for the period: the most common tagged total of revenue tables. */
function totalRevenue(d: FilingDetail, periodKey: string): { v: DetailValue; concept: string } | null {
  const seen = new Map<number, { v: DetailValue; concept: string; n: number }>();
  for (const t of d.tables) {
    const v = t.total?.[periodKey];
    if (!v || t.unit !== "USD" || !REVENUE_CONCEPT.test(t.concept) || (t.family !== "revenue" && t.family !== "geography")) continue;
    const e = seen.get(v.v) ?? { v, concept: t.concept, n: 0 };
    e.n++;
    seen.set(v.v, e);
  }
  const best = [...seen.values()].sort((a, b) => b.n - a.n || b.v.v - a.v.v)[0];
  return best ? { v: best.v, concept: best.concept } : null;
}

/** Pick the segment's cost lines that, with profit, add up to its revenue (subtotals excluded). */
function segmentCosts(m: SegmentMatrix, member: string, periodKey: string, revenue: number, profitV: number) {
  const all = m.rows.filter((r) => r.kind === "cost" && (r.values[member]?.[periodKey]?.v ?? 0) > 0);
  const val = (r: (typeof all)[number]) => r.values[member][periodKey].v;
  const sum = (rs: typeof all) => rs.reduce((n, r) => n + val(r), 0);
  const need = revenue - profitV;
  // Depreciation is disclosed per segment but already sits inside the other expense lines.
  const costs = all.filter((r) => !/Depreciation|Amortization/i.test(r.concept));
  if (!costs.length || need <= 0) return { rows: [] as typeof all, rest: Math.max(0, need) };
  if (near(sum(costs), need, 0.005)) return { rows: costs, rest: 0 };
  if (near(sum(all), need, 0.005)) return { rows: all, rest: 0 };
  // A total line among the components: drop the largest and test again, or use it alone.
  const sorted = [...costs].sort((a, b) => val(b) - val(a));
  if (near(sum(sorted.slice(1)), need, 0.005)) return { rows: sorted.slice(1), rest: 0 };
  if (near(val(sorted[0]), need, 0.005)) return { rows: [sorted[0]], rest: 0 };
  // Components that leave something untagged: show them and the remainder.
  const under = sorted.filter((r) => val(r) < need);
  let picked: typeof all = [];
  for (const r of under) if (sum(picked) + val(r) <= need * 1.001) picked.push(r);
  if (!picked.length) return { rows: [], rest: need };
  return { rows: picked, rest: need - sum(picked) };
}

export function moneyMap(d: FilingDetail, prefer?: "product" | "geography"): MoneyMap | null {
  const m = d.segments;
  const periodKey = m?.periods[m.periods.length - 1] ?? d.tables.find((t) => t.family === "revenue")?.periods.at(-1);
  if (!periodKey) return null;
  const tot = totalRevenue(d, periodKey);
  const revenueRow = m?.rows.find((r) => r.kind === "revenue");
  const segRev = (member: string) => revenueRow?.values[member]?.[periodKey]?.v ?? 0;
  const segs0 = m && revenueRow ? m.segments.filter((s) => segRev(s.member) > 0 && !AGGREGATE.test(s.member) && !AGGREGATE.test(s.label)) : [];
  // A column equal to the consolidated total alongside real segments is an aggregate, not a segment.
  const segs = segs0.length > 1 && tot ? segs0.filter((s) => !near(segRev(s.member), tot.v.v, 0.005)) : segs0;
  const segTotal = segs.reduce((n, s) => n + segRev(s.member), 0);
  const candidates = sourceTables(d, periodKey);
  const sumOf = (rows: SourceRow[]) => rows.reduce((n, r) => n + Math.max(0, r.v), 0);
  // Sources per segment add up to segment revenue (before eliminations), others to consolidated revenue.
  const gross = (c: (typeof candidates)[number]) => c.nested && segTotal > 0 && near(sumOf(c.rows), segTotal, 0.01);
  const coverage = (c: (typeof candidates)[number]) => (gross(c) ? 1 : tot ? sumOf(c.rows) / tot.v.v : 1);
  const usable = candidates.filter((c) => coverage(c) >= 0.6 && coverage(c) <= 1.05);
  const kinds = [...new Set(usable.map((c) => c.kind))];
  const pickKind = prefer && kinds.includes(prefer) ? prefer : kinds.includes("product") ? "product" : "geography";
  const src = usable.filter((c) => c.kind === pickKind).sort((a, b) => Math.abs(1 - coverage(a)) - Math.abs(1 - coverage(b)) || b.rows.length - a.rows.length)[0];
  const srcGross = !!src && gross(src);
  if (!tot && !segs.length) return null;
  // Without segments the map would only repeat the revenue mix table.
  if (segs.length < 2 && !(segs.length === 1 && m?.rows.some((r) => r.kind === "cost"))) return null;

  const total = tot?.v.v ?? segs.reduce((n, s) => n + revenueRow!.values[s.member][periodKey].v, 0);
  const totalPart = tot ? part("Revenue", tot.concept, periodKey, tot.v) : null;
  const nodes: MoneyNode[] = [{ id: "rev", label: "Revenue", col: 1, value: total, kind: "total" }];
  const links: MoneyLink[] = [];
  const notes: string[] = [];
  let leftSum = 0;

  // ---- sources → revenue
  if (src) {
    for (const r of src.rows) {
      if (r.v <= 0) continue;
      nodes.push({ id: `src:${r.member}`, label: r.label, col: 0, value: r.v, kind: "source" });
      links.push({ from: `src:${r.member}`, to: "rev", value: r.v, ...(r.parts.length === 1 ? { ref: r.parts[0] } : { derived: { formula: `Sum of ${r.label.toLowerCase()} across segments`, parts: r.parts } }) });
      leftSum += r.v;
    }
    const neg = src.rows.filter((r) => r.v < 0);
    if (neg.length) notes.push(`${neg.map((r) => r.label).join(", ")} reported negative and not drawn.`);
    if (srcGross && tot && segTotal > total * 1.003) notes.push(`Products and segments are shown before eliminating ${fmtB(segTotal - total)} of sales between segments; consolidated revenue is ${fmtB(total)}.`);
    if (!srcGross && totalPart && leftSum < total * 0.995) {
      const rest = total - leftSum;
      nodes.push({ id: "src:other", label: `Not broken out`, col: 0, value: rest, kind: "other" });
      links.push({ from: "src:other", to: "rev", value: rest, derived: { formula: `Revenue − listed ${pickKind === "product" ? "products" : "regions"}`, parts: [totalPart, ...links.flatMap((l) => (l.ref ? [l.ref] : (l.derived?.parts ?? []))).map((x) => ({ ...x, sign: -1 as const }))] } });
    }
  }

  // ---- revenue → segments → costs / profit
  if (segs.length >= 1 && m && revenueRow) {
    const segSum = segs.reduce((n, s) => n + revenueRow.values[s.member][periodKey].v, 0);
    if (srcGross) {
      nodes[0].value = Math.max(segSum, leftSum);
      if (leftSum < segSum * 0.997) {
        const rest = segSum - leftSum;
        nodes.push({ id: "src:other", label: "Not broken out", col: 0, value: rest, kind: "other" });
        links.push({ from: "src:other", to: "rev", value: rest, derived: { formula: "Segment revenue − listed products", parts: [...segs.map((s) => part(s.label, revenueRow.concept, periodKey, revenueRow.values[s.member][periodKey])), ...links.flatMap((l) => (l.ref ? [l.ref] : (l.derived?.parts ?? []))).map((x) => ({ ...x, sign: -1 as const }))] } });
      }
    }
    else if (segSum > total * 1.003) {
      notes.push(`Segment revenue adds up to more than consolidated revenue — it includes sales between segments, eliminated in the total.`);
      const extra = segSum - total;
      nodes.push({ id: "src:interseg", label: "Sales between segments", col: 0, value: extra, kind: "other" });
      links.push({ from: "src:interseg", to: "rev", value: extra, derived: { formula: "Segment revenue − consolidated revenue", parts: [...segs.map((s) => part(s.label, revenueRow.concept, periodKey, revenueRow.values[s.member][periodKey])), ...(totalPart ? [{ ...totalPart, sign: -1 as const }] : [])] } });
      nodes[0].value = segSum;
      if (!src && totalPart) {
        nodes.push({ id: "src:total", label: "Consolidated revenue", col: 0, value: total, kind: "source" });
        links.push({ from: "src:total", to: "rev", value: total, ref: totalPart });
      }
    }
    const profits = m.rows.filter((r) => r.kind === "profit");
    const profit = profits.find((r) => /OperatingIncomeLoss$/.test(r.concept)) ?? profits.find((r) => /SegmentProfit|OperatingProfit|Ebitda/i.test(r.concept)) ?? profits[0];
    const costNodes = new Map<string, MoneyNode>();
    const node3 = (id: string, label: string, kind: MoneyNode["kind"], v: number) => {
      const n = costNodes.get(id) ?? { id, label, col: 3 as const, value: 0, kind };
      n.value += v;
      costNodes.set(id, n);
    };
    for (const s of segs) {
      const rv = revenueRow.values[s.member][periodKey];
      nodes.push({ id: `seg:${s.member}`, label: s.label, col: 2, value: rv.v, kind: "segment" });
      links.push({ from: "rev", to: `seg:${s.member}`, value: rv.v, ref: part(s.label, revenueRow.concept, periodKey, rv) });
      const pv = profit?.values[s.member]?.[periodKey];
      const revPart = part(`${s.label} revenue`, revenueRow.concept, periodKey, rv);
      if (!pv) continue;
      if (pv.v <= 0) {
        notes.push(`${s.label} reported a loss of ${fmtB(-pv.v)}; its costs exceed its revenue.`);
        node3("cost:all", "Costs", "cost", rv.v);
        links.push({ from: `seg:${s.member}`, to: "cost:all", value: rv.v, ref: revPart });
        continue;
      }
      const { rows, rest } = segmentCosts(m, s.member, periodKey, rv.v, pv.v);
      for (const r of rows) {
        const v = r.values[s.member][periodKey];
        node3(`cost:${r.concept}`, r.label, "cost", v.v);
        links.push({ from: `seg:${s.member}`, to: `cost:${r.concept}`, value: v.v, ref: part(`${s.label} — ${r.label}`, r.concept, periodKey, v) });
      }
      if (rest > rv.v * 0.002) {
        const id = rows.length ? "cost:other" : "cost:all";
        node3(id, rows.length ? "Other costs (not itemised)" : "Costs", rows.length ? "other" : "cost", rest);
        links.push({
          from: `seg:${s.member}`,
          to: id,
          value: rest,
          derived: { formula: `${s.label} revenue − ${profit!.label.toLowerCase()}${rows.length ? " − itemised costs" : ""}`, parts: [revPart, part(`${s.label} — ${profit!.label}`, profit!.concept, periodKey, pv, -1), ...rows.map((r) => part(`${s.label} — ${r.label}`, r.concept, periodKey, r.values[s.member][periodKey], -1))] },
        });
      }
      node3("profit", profit!.label, "profit", pv.v);
      links.push({ from: `seg:${s.member}`, to: "profit", value: pv.v, ref: part(`${s.label} — ${profit!.label}`, profit!.concept, periodKey, pv) });
    }
    if (segSum < total * 0.997) {
      const rest = total - segSum;
      nodes.push({ id: "seg:other", label: "Other / unallocated", col: 2, value: rest, kind: "other" });
      links.push({ from: "rev", to: "seg:other", value: rest, derived: { formula: "Revenue − segment revenue", parts: [...(totalPart ? [totalPart] : []), ...segs.map((s) => part(s.label, revenueRow.concept, periodKey, revenueRow.values[s.member][periodKey], -1))] } });
    }
    nodes.push(...[...costNodes.values()].sort((a, b) => (a.kind === "profit" ? 1 : 0) - (b.kind === "profit" ? 1 : 0) || (a.kind === "other" ? 1 : 0) - (b.kind === "other" ? 1 : 0) || b.value - a.value));
  }
  if (nodes.filter((n) => n.col !== 1).length < 2) return null;
  return { periodKey, source: pickKind, sources: kinds, total: nodes[0].value, nodes, links, notes };
}

const fmtB = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${(v / 1e6).toFixed(0)}M`);

export interface LaidNode extends MoneyNode {
  x: number;
  y: number;
  h: number;
}
export interface LaidLink extends MoneyLink {
  /** band at the source and target edges */
  sy: number;
  ty: number;
  w: number;
  x0: number;
  x1: number;
}

/** Column layout: nodes stacked per column in order, link bands stacked in target/source order. */
export function layoutMoneyMap(map: MoneyMap, width: number, height: number, nodeW = 10, gap = 10) {
  const cols = [0, 1, 2, 3].filter((c) => map.nodes.some((n) => n.col === c));
  const xOf = (c: number) => (cols.indexOf(c) / Math.max(1, cols.length - 1)) * (width - nodeW);
  const scaleBy = Math.min(
    ...cols.map((c) => {
      const ns = map.nodes.filter((n) => n.col === c);
      return (height - gap * (ns.length - 1)) / ns.reduce((s, n) => s + n.value, 0);
    }),
  );
  const laid = new Map<string, LaidNode>();
  for (const c of cols) {
    const ns = map.nodes.filter((n) => n.col === c);
    const used = ns.reduce((s, n) => s + n.value * scaleBy, 0) + gap * (ns.length - 1);
    let y = (height - used) / 2;
    for (const n of ns) {
      const h = Math.max(1, n.value * scaleBy);
      laid.set(n.id, { ...n, x: xOf(c), y, h });
      y += h + gap;
    }
  }
  const order = (id: string) => map.nodes.findIndex((n) => n.id === id);
  const outY = new Map<string, number>();
  const inY = new Map<string, number>();
  const links: LaidLink[] = [];
  const sorted = [...map.links].sort((a, b) => order(a.from) - order(b.from) || order(a.to) - order(b.to));
  for (const l of sorted) {
    const s = laid.get(l.from);
    const t = laid.get(l.to);
    if (!s || !t) continue;
    const w = Math.max(0.5, l.value * scaleBy);
    links.push({ ...l, w, sy: 0, ty: 0, x0: s.x + nodeW, x1: t.x });
  }
  // Source side in target order, target side in source order, so bands don't cross at the nodes.
  for (const l of [...links].sort((a, b) => order(a.to) - order(b.to))) {
    const s = laid.get(l.from)!;
    const y = outY.get(l.from) ?? s.y;
    l.sy = y + l.w / 2;
    outY.set(l.from, y + l.w);
  }
  for (const l of [...links].sort((a, b) => order(a.from) - order(b.from))) {
    const t = laid.get(l.to)!;
    const y = inY.get(l.to) ?? t.y;
    l.ty = y + l.w / 2;
    inY.set(l.to, y + l.w);
  }
  return { nodes: [...laid.values()], links, nodeW };
}
