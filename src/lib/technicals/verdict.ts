// The verdict of the read: two separate lines of evidence for the conditions in force today, and what the bar
// can see. (1) The stock's own history (evidence.ts). (2) The same condition across every covered company,
// from the pipeline's pooled forward returns (tech/signals.json, judged in pooled.ts); those exist for chart
// events only. Three outcomes: reliable on the stock's own history; not detectable on the stock alone but
// reliable across companies (an average across companies, not a forecast for this one); neither.
import { EVIDENCE, isTested, reliableToday, type Evidence, type EvidenceCell, type EvidenceRow, type Horizon } from "./evidence";
import type { PooledRow } from "./pooled";

export type Outcome = "own" | "pooled" | "neither";

export interface PooledHit {
  row: EvidenceRow;
  p: PooledRow;
  /** The stock's own cell at the same horizon, when it has one */
  own: EvidenceCell | null;
}

export interface VerdictSummary {
  outcome: Outcome;
  /** Reliable on the stock's own history and in force, smallest q first */
  own: ReturnType<typeof reliableToday>;
  /** In force and reliable across covered companies, smallest q first */
  pooled: PooledHit[];
  /** Conditions in force with at least one test in the stock's family */
  tested: EvidenceRow[];
  /** Conditions in force with too few independent cases to enter the family at any horizon */
  untested: EvidenceRow[];
  /** Whether the cross-company file was available at all */
  pooledAvailable: boolean;
  /** Events in force with a cross-company record, and the conditions in force without one */
  pooledChecked: EvidenceRow[];
  pooledMissing: EvidenceRow[];
}

/** The cross-company row of one condition at one horizon, or null when none is published. */
export function pooledFor(P: PooledRow[] | null | undefined, key: string, h: Horizon): PooledRow | null {
  return P?.find((r) => r.type === key && r.h === h) ?? null;
}

export function verdictSummary(E: Evidence, P: PooledRow[] | null | undefined): VerdictSummary {
  const active = E.rows.filter((r) => r.active);
  const own = reliableToday(E);
  const pooled: PooledHit[] = [];
  const checked: EvidenceRow[] = [];
  const missing: EvidenceRow[] = [];
  for (const row of active) {
    const rs = EVIDENCE.horizons.map((h) => pooledFor(P, row.key, h)).filter((x): x is PooledRow => !!x);
    if (rs.length) checked.push(row);
    else missing.push(row);
    for (const p of rs) if (p.verdict === "reliable") pooled.push({ row, p, own: row.cells[p.h] ?? null });
  }
  pooled.sort((a, b) => (a.p.q ?? 1) - (b.p.q ?? 1));
  return {
    outcome: own.length ? "own" : pooled.length ? "pooled" : "neither",
    own,
    pooled,
    tested: active.filter(isTested),
    untested: active.filter((r) => !isTested(r)),
    pooledAvailable: !!P,
    pooledChecked: checked,
    pooledMissing: missing,
  };
}

const pct1 = (v: number) => `${(Math.abs(v) * 100).toFixed(1)}%`;

/** "ten years", "3.5 years", "8 months": the length of the tested sample in words. */
export function sampleLength(bars: number): string {
  const y = bars / 252;
  if (y < 1) return `${Math.max(1, Math.round(bars / 21))} months`;
  return y >= 3 ? `${Math.round(y)} years` : `${y.toFixed(1)} years`;
}

/**
 * What the bar can see, in plain words: "With 9 years of AAPL's history, only a condition after which the
 * average return differs from days without it by about 2.0% over 5 days, 5.1% over 20 days or 9.0% over 60
 * days would have an even chance of showing up as reliable; smaller differences show as no clear difference."
 * null when no horizon has enough tested cells.
 */
export function detectableText(E: Evidence, sym: string): string | null {
  const parts = EVIDENCE.horizons
    .map((h) => (E.detectable[h] != null ? `${pct1(E.detectable[h]!)} over ${h} days` : null))
    .filter((x): x is string => !!x);
  if (!parts.length) return null;
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} or ${parts[parts.length - 1]}` : parts[0];
  return (
    `With ${sampleLength(E.sample.bars)} of ${sym}'s history, only a condition after which the average return differs ` +
    `from days without it by about ${list} would have an even chance of showing up as reliable; smaller differences show as no clear difference.`
  );
}

/** "A", "A and B", "A, B and C" */
export function nameList(names: string[]): string {
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : (names[0] ?? "");
}
