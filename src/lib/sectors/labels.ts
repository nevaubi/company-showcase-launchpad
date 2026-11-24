// Label placement for a scatter of named points (the rotation graph): each label sits beside its point,
// to the right when there is room and to the left otherwise, and steps down or up in whole lines until
// its box clears every label already placed. Pure, so the no-overlap rule can be tested at phone width.

export interface LabelIn {
  id: string;
  /** Point centre. */
  x: number;
  y: number;
  /** Label width in px. */
  w: number;
}
export interface LabelOut {
  id: string;
  /** Text anchor position and side. */
  x: number;
  y: number;
  anchor: "start" | "end";
  /** Box of the text, for overlap checks. */
  box: { x0: number; x1: number; y0: number; y1: number };
}

const overlap = (a: LabelOut["box"], b: LabelOut["box"]) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * Place labels in the order given (put the points that matter most first). `left` and `right` are the plot's
 * horizontal limits, `top` and `bottom` its vertical ones; `gap` is the distance from point to text and
 * `line` the text height.
 */
export function placeLabels(points: readonly LabelIn[], area: { left: number; right: number; top: number; bottom: number }, gap = 7, line = 12): LabelOut[] {
  const placed: LabelOut[] = [];
  for (const p of points) {
    const sides: ("start" | "end")[] = p.x + gap + p.w <= area.right ? ["start", "end"] : ["end", "start"];
    let best: LabelOut | null = null;
    // Nearest free slot: same line first, then one line down, one up, two down, and so on, on either side.
    search: for (let step = 0; step <= 8; step++) {
      for (const dy of step === 0 ? [0] : [step * line, -step * line]) {
        for (const anchor of sides) {
          const x = anchor === "start" ? p.x + gap : p.x - gap;
          const x0 = anchor === "start" ? x : x - p.w;
          const y = p.y + 3.5 + dy;
          const box = { x0, x1: x0 + p.w, y0: y - line + 2, y1: y + 2 };
          if (box.x0 < area.left || box.x1 > area.right || box.y0 < area.top || box.y1 > area.bottom) continue;
          const cand: LabelOut = { id: p.id, x, y, anchor, box };
          if (!placed.some((q) => overlap(q.box, box))) {
            best = cand;
            break search;
          }
        }
      }
    }
    if (!best) {
      const anchor = sides[0];
      const x = anchor === "start" ? p.x + gap : p.x - gap;
      const x0 = anchor === "start" ? x : x - p.w;
      best = { id: p.id, x, y: p.y + 3.5, anchor, box: { x0, x1: x0 + p.w, y0: p.y + 3.5 - line + 2, y1: p.y + 5.5 } };
    }
    placed.push(best);
  }
  return placed;
}
