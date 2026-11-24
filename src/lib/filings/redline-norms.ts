// What is normal for a filing comparison, so the Filing changes verdict can grade one against its peers
// instead of against a fixed threshold. A 10-K or 10-Q rewrites a large share of its paragraphs every
// time (a fixed 25% bar called 98% of stored comparisons "major"), so the share of changed paragraphs
// only means something next to the shares of other comparisons of the same form.
//
// Source: production `filing_redlines` (version 2), queried 23 Nov 2026. Share per comparison =
// (added + removed + rewritten paragraphs) / (all compared paragraphs, figure-only updates and moved
// ones included), summed over sections found in both filings; this is exactly `redlineVerdict().share`.
// 10-K: 234 comparisons. 10-Q: 1,728 comparisons (one with no language change, share 0).
// Re-derive with the query in the Fix pass notes of reports/filings.md when the stored set grows a lot.

export interface FormNorm {
  /** Form as stored on the comparison. */
  form: string;
  /** Plural noun for the copy: "annual reports". */
  noun: string;
  /** Comparisons the cut points were taken from. */
  sample: number;
  /** Day the cut points were measured. */
  asOf: string;
  /** [percentile 0..1, share at that percentile], ascending. */
  cuts: readonly (readonly [number, number])[];
}

const P = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 0.97, 0.99, 1] as const;
const zip = (v: number[]) => P.map((p, i) => [p, v[i]] as const);

export const NORMS: Record<string, FormNorm> = {
  "10-K": {
    form: "10-K",
    noun: "annual reports",
    sample: 234,
    asOf: "2026-11-23",
    cuts: zip([0.2026, 0.2589, 0.31, 0.3437, 0.3571, 0.3749, 0.3887, 0.4002, 0.4093, 0.4239, 0.4311, 0.4427, 0.4576, 0.4713, 0.4882, 0.5069, 0.5185, 0.5477, 0.5807, 0.6353, 0.6798, 0.7476, 0.7939]),
  },
  "10-Q": {
    form: "10-Q",
    noun: "quarterly reports",
    sample: 1728,
    asOf: "2026-11-23",
    cuts: zip([0, 0.3208, 0.3585, 0.3961, 0.4225, 0.4435, 0.4651, 0.4825, 0.5017, 0.5173, 0.5328, 0.5477, 0.5639, 0.5794, 0.5999, 0.6194, 0.6457, 0.6779, 0.7262, 0.7834, 0.8231, 0.8976, 1]),
  },
};

/** Norm for a form; amendments are graded with their original form. Null when nothing is stored to compare with. */
export function normFor(form: string): FormNorm | null {
  const f = form.trim().toUpperCase().replace(/\/A$/, "");
  return NORMS[f] ?? null;
}

/** Share of stored comparisons of the same form with less change than `share` (0..1), interpolated between cut points. */
export function percentileOf(norm: FormNorm, share: number): number {
  const c = norm.cuts;
  if (share <= c[0][1]) return 0;
  if (share >= c[c.length - 1][1]) return 1;
  for (let i = 1; i < c.length; i++) {
    const [p1, v1] = c[i];
    if (share <= v1) {
      const [p0, v0] = c[i - 1];
      return v1 === v0 ? p1 : p0 + ((share - v0) / (v1 - v0)) * (p1 - p0);
    }
  }
  return 1;
}

export type NormLevel = "unusual" | "high" | "typical" | "low";

/** Rank cut points for the levels. Red ("unusual") is kept for the top 5%. */
export const LEVEL_CUTS = { unusual: 0.95, high: 0.75, low: 0.25 } as const;

export function normLevel(rank: number): NormLevel {
  if (rank >= LEVEL_CUTS.unusual) return "unusual";
  if (rank >= LEVEL_CUTS.high) return "high";
  if (rank < LEVEL_CUTS.low) return "low";
  return "typical";
}

/** "More change than 8 in 10 annual reports"; past nine in ten it counts in hundreds. */
export function rankPhrase(rank: number, noun: string): string {
  const more = rank >= 0.5;
  const x = more ? rank : 1 - rank;
  const of = x >= 0.9 ? `${Math.min(99, Math.floor(x * 100))} in 100` : `${Math.floor(x * 10)} in 10`;
  return `${more ? "More" : "Less"} change than ${of} ${noun}`;
}
