/**
 * Where the names of a ranked bar chart go. A left column of names keeps every bar on one baseline beside its
 * name, but only when the widest name fits whole in at most 40% of the chart's width and the bars keep at
 * least half of it. Otherwise each name goes on its own line above its bar (cut with an ellipsis when it is
 * wider than the chart; the whole name stays in the mark's title and in the table view) and the bar spans
 * the whole width, its value on the name's line.
 */

/** The widest name may take at most this share of the width in a left column. */
export const RANK_LABEL_SHARE = 0.4;
/** The bars must keep at least this share of the width beside a left column. */
export const RANK_TRACK_SHARE = 0.5;
/** Space between the name column and the bars, and between a bar's tip and its value. */
export const RANK_LABEL_GAP = 8;
export const RANK_VALUE_GAP = 6;
/** A stacked row: a 12px name line, 1px, a 4px bar, then air before the next name. */
export const RANK_STACKED_ROW = 20;
const RANK_STACKED_ROW_MAX = 28;

export type RankLayout =
  | {
      kind: "column";
      /** Width of the name column: the widest name, whole. */
      labelWidth: number;
      /** Longest bar. */
      track: number;
      rowHeight: number;
      height: number;
    }
  | {
      kind: "stacked";
      /** Longest bar: the whole width. */
      track: number;
      rowHeight: number;
      /** Height of the list, at least the chart height. */
      height: number;
    };

export type RankLayoutInput = {
  /** Width of the chart. */
  width: number;
  /** Width of the widest name, as rendered. */
  labelWidth: number;
  /** Width of the widest value, as rendered. */
  valueWidth: number;
  /** Number of bars. */
  count: number;
  /** Height the chart is given. */
  height: number;
};

export function rankLayout({ width, labelWidth, valueWidth, count, height }: RankLayoutInput): RankLayout {
  const rows = Math.max(1, count);
  const labelColumn = Math.ceil(labelWidth);
  const track = width - labelColumn - RANK_LABEL_GAP - RANK_VALUE_GAP - Math.ceil(valueWidth);
  if (labelColumn <= width * RANK_LABEL_SHARE && track >= width * RANK_TRACK_SHARE)
    return { kind: "column", labelWidth: labelColumn, track, rowHeight: height / rows, height };
  const rowHeight = Math.min(RANK_STACKED_ROW_MAX, Math.max(RANK_STACKED_ROW, height / rows));
  return { kind: "stacked", track: Math.max(0, width), rowHeight, height: Math.max(height, rowHeight * rows) };
}

/**
 * A rendered text width when nothing can measure it (no canvas, as in tests): about 0.66 em for a capital or a
 * digit, 0.53 em for a small letter, 0.28 em for a space and 0.33 em for punctuation in the app's sans.
 */
export function estimateTextWidth(text: string, fontSize: number): number {
  let em = 0;
  for (const ch of text) {
    if (ch === " ") em += 0.28;
    else if (/[A-Z0-9]/.test(ch)) em += 0.66;
    else if (/[a-z]/.test(ch)) em += 0.53;
    else em += 0.33;
  }
  return Math.ceil(em * fontSize);
}
