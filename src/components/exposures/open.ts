import type { SourceTarget } from "@/components/source/source-context";
import type { DerivedPart } from "@/lib/financials/types";
import type { ExpRef, ExpVal } from "@/lib/xbrl/exposure";

const ref = (p: ExpRef, sign: 1 | -1 = p.sign ?? 1): DerivedPart => ({ accn: p.accn, doc: p.doc, concept: p.concept, start: p.start, end: p.end, value: p.value, label: p.label ?? p.concept.split(":")[1], sign });

/** One tag opens that tag; a sum (or gross − recoveries) opens its parts. */
export function valTarget(ticker: string, label: string, periodLabel: string, val: ExpVal): SourceTarget {
  if (val.parts.length === 1) {
    const p = val.parts[0];
    return { ticker, label, periodLabel, unit: "usd", value: val.v, src: { accn: p.accn, doc: p.doc, concept: p.concept, start: p.start, end: p.end, value: p.value }, elementId: p.id };
  }
  const parts = val.parts.map((p) => ref(p));
  return { ticker, label, periodLabel, unit: "usd", value: val.v, derived: { formula: parts.map((p, i) => `${i ? (p.sign < 0 ? " − " : " + ") : ""}${p.label}`).join(""), parts } };
}

/** A ratio of two sourced figures, every part of both listed. */
export function ratioTarget(ticker: string, label: string, periodLabel: string, num: ExpVal, den: ExpVal, formula: string, value: number): SourceTarget {
  return { ticker, label, periodLabel, unit: "pct", value, derived: { formula, parts: [...num.parts.map((p) => ref(p)), ...den.parts.map((p) => ref(p, 1))] } };
}

export const fy = (end: string) => `FY${end.slice(0, 4)}`;

export function median(xs: number[]): number | null {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
