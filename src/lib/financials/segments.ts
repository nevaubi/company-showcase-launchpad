// Aligns dimensional segment facts to the company's fiscal periods. Missing
// quarters are derived the same way as the statements (full year − nine-month
// YTD, six-month YTD − Q1 …) and keep every component as a SourceRef.
import { durationDays, toTime } from "./build";
import type { DerivedPart, Period, SegmentFact, SegmentMetric, SourceRef } from "./types";

export interface SegCell {
  v: number;
  fact?: SegmentFact;
  derived?: { formula: string; parts: DerivedPart[] };
}

export interface SegGroup {
  id: string;
  axis: string;
  axisLabel: string;
  metric: SegmentMetric;
  count: number;
}

export interface SegMember {
  member: string;
  label: string;
  latest: number;
}

export const METRIC_LABEL: Record<SegmentMetric, string> = {
  revenue: "Revenue",
  operatingIncome: "Operating income",
  grossProfit: "Gross profit",
  netIncome: "Net income",
  assets: "Assets",
  capex: "Capex",
  dna: "D&A",
};

const AXIS_ORDER = ["Business segment", "Product / service", "Geography"];
const METRIC_ORDER: SegmentMetric[] = ["revenue", "operatingIncome", "grossProfit", "netIncome", "capex", "dna", "assets"];
const DAY = 86_400_000;
const near = (a: string | undefined, b: string | undefined, tol = 5) => !!a && !!b && Math.abs(toTime(a) - toTime(b)) <= tol * DAY;

export function segmentGroups(segments: SegmentFact[]): SegGroup[] {
  const m = new Map<string, SegGroup>();
  for (const s of segments) {
    const id = `${s.axis}|${s.metric}`;
    const g = m.get(id) ?? { id, axis: s.axis, axisLabel: s.axisLabel, metric: s.metric, count: 0 };
    g.count++;
    m.set(id, g);
  }
  return [...m.values()].sort(
    (a, b) =>
      METRIC_ORDER.indexOf(a.metric) - METRIC_ORDER.indexOf(b.metric) || AXIS_ORDER.indexOf(a.axisLabel) - AXIS_ORDER.indexOf(b.axisLabel),
  );
}

export const segRef = (s: SegmentFact): SourceRef => ({ accn: s.accn, concept: s.concept, ...(s.start ? { start: s.start } : {}), end: s.end, value: s.value });

const partOf = (c: SegCell, label: string, sign: 1 | -1): DerivedPart[] =>
  c.fact ? [{ ...segRef(c.fact), label, sign }] : (c.derived?.parts ?? []).map((p) => ({ ...p, sign: (p.sign * sign) as 1 | -1, label: `${label} · ${p.label}` }));

/**
 * Value of each member in each period. `annual` supplies fiscal-year boundaries so quarterly
 * gaps can be filled from year-to-date facts.
 */
export function segmentMatrix(
  segments: SegmentFact[],
  group: Pick<SegGroup, "axis" | "metric">,
  periods: Period[],
  annual: Period[],
  freq: "annual" | "quarterly",
): { members: SegMember[]; cells: Map<string, (SegCell | null)[]> } {
  const facts = segments.filter((s) => s.axis === group.axis && s.metric === group.metric);
  const instant = group.metric === "assets";
  const byMember = new Map<string, SegmentFact[]>();
  for (const f of facts) byMember.set(f.member, [...(byMember.get(f.member) ?? []), f]);
  const cells = new Map<string, (SegCell | null)[]>();
  const labels = new Map<string, string>();

  for (const [member, fs] of byMember) {
    labels.set(member, fs.at(-1)!.label);
    const find = (start: string | undefined, end: string, lo: number, hi: number) =>
      fs.find((f) => near(f.end, end, 4) && (instant ? !f.start : !!f.start && near(f.start, start, 4) && inRange(durationDays(f.start, f.end), lo, hi)));
    const row: (SegCell | null)[] = [];
    periods.forEach((p) => {
      if (instant) {
        const f = fs.find((x) => !x.start && near(x.end, p.end, 4));
        row.push(f ? { v: f.value, fact: f } : null);
        return;
      }
      if (freq === "annual") {
        const f = find(p.start, p.end, 350, 380);
        row.push(f ? { v: f.value, fact: f } : null);
        return;
      }
      const direct = find(p.start, p.end, 80, 100);
      if (direct) {
        row.push({ v: direct.value, fact: direct });
        return;
      }
      const fy = annual.find((a) => a.fy === p.fy);
      const fyStart = fy?.start ?? periods.find((q) => q.fy === p.fy && q.fq === 1)?.start;
      if (!fyStart || !p.fq || p.fq === 1) {
        row.push(null);
        return;
      }
      const cumLo = p.fq === 4 ? 350 : p.fq === 3 ? 260 : 170;
      const cumHi = p.fq === 4 ? 380 : p.fq === 3 ? 285 : 195;
      const cum = find(fyStart, p.end, cumLo, cumHi);
      if (!cum) {
        row.push(null);
        return;
      }
      const prevQ = periods.find((q) => q.fy === p.fy && q.fq === p.fq! - 1);
      const cumLabel = p.fq === 4 ? `FY${p.fy} total` : `${p.fq === 3 ? "9M" : "6M"} YTD`;
      // Prefer the previous year-to-date fact; otherwise the earlier discrete quarters.
      const prevCum =
        prevQ && (p.fq === 2 ? find(fyStart, prevQ.end, 80, 100) : find(fyStart, prevQ.end, p.fq === 4 ? 260 : 170, p.fq === 4 ? 285 : 195));
      if (prevCum) {
        const prevLabel = p.fq === 2 ? "Q1" : p.fq === 3 ? "6M YTD" : "9M YTD";
        row.push({
          v: cum.value - prevCum.value,
          derived: {
            formula: `${cumLabel} − ${prevLabel}`,
            parts: [
              { ...segRef(cum), label: cumLabel, sign: 1 },
              { ...segRef(prevCum), label: prevLabel, sign: -1 },
            ],
          },
        });
        return;
      }
      const earlier = periods
        .map((q, i) => ({ q, i }))
        .filter(({ q }) => q.fy === p.fy && (q.fq ?? 0) < p.fq!)
        .map(({ i }) => row[i]);
      if (earlier.length === p.fq - 1 && earlier.every(Boolean)) {
        row.push({
          v: cum.value - earlier.reduce((s, c) => s + c!.v, 0),
          derived: {
            formula: `${cumLabel} − ${earlier.map((_, i) => `Q${i + 1}`).join(" − ")}`,
            parts: [{ ...segRef(cum), label: cumLabel, sign: 1 }, ...earlier.flatMap((c, i) => partOf(c!, `Q${i + 1}`, -1))],
          },
        });
        return;
      }
      row.push(null);
    });
    if (row.some(Boolean)) cells.set(member, row);
  }

  const members: SegMember[] = [...cells.entries()]
    .map(([member, row]) => {
      const last = [...row].reverse().find(Boolean);
      return { member, label: labels.get(member)!, latest: last?.v ?? 0 };
    })
    .sort((a, b) => {
      // Members still reported in the latest period first, by size.
      const la = cells.get(a.member)!.at(-1) ? 1 : 0;
      const lb = cells.get(b.member)!.at(-1) ? 1 : 0;
      return lb - la || b.latest - a.latest;
    });
  return { members, cells };
}

function inRange(n: number, lo: number, hi: number) {
  return n >= lo && n <= hi;
}

/** How much of the consolidated total the members add up to, per period (1 = exact). */
export function memberCoverage(cells: Map<string, (SegCell | null)[]>, totals: (number | null | undefined)[]): (number | null)[] {
  return totals.map((t, i) => {
    if (!t) return null;
    let sum = 0;
    let any = false;
    for (const row of cells.values()) {
      const c = row[i];
      if (c) {
        sum += c.v;
        any = true;
      }
    }
    return any ? sum / t : null;
  });
}
