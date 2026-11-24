// The words for one evidence cell, shared by the page (Evidence table, its sheet, the read) and the assistant's
// get_quant_profile tool, so both say the same thing about the same cell: what failed first, in the fewest words
// that stay true. Also the layout of the Evidence table: what the reader meets first.
import { EVIDENCE, REASON_TEXT, type Evidence, type EvidenceCell, type EvidenceRow, type Horizon } from "./evidence";

export interface CellLabel {
  /** Few words, lower case: "no clear difference", "small sample (18)", "reliable: higher after" */
  text: string;
  /** The longer reason, for a title or a sheet */
  title: string;
  reliable: boolean;
  /** "quiet" cells (no clear difference, or too few cases) are summarised in one sentence below the table */
  quiet: "base" | "few" | null;
}

const SHORT: Record<string, string> = {
  base: "no clear difference",
  interval: "interval includes zero",
  cost: "smaller than costs",
  unstable: "not stable over time",
  pooled: "not seen across companies",
};

export function cellLabel(c: EvidenceCell | undefined): CellLabel {
  if (!c) return { text: "too few cases", title: `Fewer than ${EVIDENCE.minReport} non-overlapping cases: no statistics`, reliable: false, quiet: "few" };
  if (c.verdict === "reliable")
    return { text: c.test.excess > 0 ? "reliable: higher after" : "reliable: lower after", title: REASON_TEXT.ok, reliable: true, quiet: null };
  if (c.reason === "small" || c.reason === "few" || c.q == null)
    return {
      text: `small sample (${c.test.nEff})`,
      title: `${c.test.nEff} non-overlapping cases, fewer than the ${EVIDENCE.minIndependent} needed to test`,
      reliable: false,
      quiet: "few",
    };
  return { text: SHORT[c.reason] ?? c.reason, title: REASON_TEXT[c.reason], reliable: false, quiet: c.reason === "base" ? "base" : null };
}

export interface EvidenceLayout {
  /** In force on the last bar: always listed */
  active: EvidenceRow[];
  /** Not in force, with a verdict other than no clear difference or too few cases at this horizon */
  notable: EvidenceRow[];
  /** Not in force and quiet at this horizon */
  quietBase: number;
  quietFew: number;
  /** One sentence for the quiet rows, built from the counts; null when there are none */
  summary: string | null;
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

export function evidenceLayout(E: Evidence, h: Horizon): EvidenceLayout {
  const active = E.rows.filter((r) => r.active);
  const notable: EvidenceRow[] = [];
  let quietBase = 0;
  let quietFew = 0;
  for (const r of E.rows) {
    if (r.active) continue;
    const q = cellLabel(r.cells[h]).quiet;
    if (q === "base") quietBase++;
    else if (q === "few") quietFew++;
    else notable.push(r);
  }
  const quiet = quietBase + quietFew;
  // "41 other conditions at 20 days: 32 with no clear difference from the base rate, 9 with too few cases to test."
  const lead = `${plural(quiet, "other condition", "other conditions")} at ${h} days`;
  const summary = !quiet
    ? null
    : quietBase && quietFew
      ? `${lead}: ${quietBase.toLocaleString("en-US")} with no clear difference from the base rate, ${quietFew.toLocaleString("en-US")} with too few cases to test.`
      : quietBase
        ? `${lead}: ${quiet === 1 ? "not distinguishable" : "none distinguishable"} from the base rate.`
        : `${lead}: too few cases to test.`;
  return { active, notable, quietBase, quietFew, summary };
}

/** One convention for q everywhere on the page and in the tool: three decimals under 0.1, two above. */
export function fmtQ(q: number | null | undefined): string {
  if (q == null || !Number.isFinite(q)) return "–";
  return q < 0.1 ? q.toFixed(3) : q.toFixed(2);
}
