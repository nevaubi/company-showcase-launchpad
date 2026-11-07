// Pure geometry for keeping the assistant's scroll targets and highlight callouts out from under its
// own panel (docked, floating or expanded canvas).

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Viewport {
  w: number;
  h: number;
}

export const rect = (left: number, top: number, right: number, bottom: number): Rect => ({ left, top, right, bottom });
export const width = (r: Rect) => Math.max(0, r.right - r.left);
export const height = (r: Rect) => Math.max(0, r.bottom - r.top);

export function intersect(a: Rect, b: Rect): Rect | null {
  const r = rect(Math.max(a.left, b.left), Math.max(a.top, b.top), Math.min(a.right, b.right), Math.min(a.bottom, b.bottom));
  return width(r) > 0 && height(r) > 0 ? r : null;
}

/** Share of `a`'s area covered by `b` (0..1). */
export function coverage(a: Rect, b: Rect | null) {
  if (!b) return 0;
  const i = intersect(a, b);
  const area = width(a) * height(a);
  return i && area ? (width(i) * height(i)) / area : 0;
}

/**
 * The part of the viewport the panel does not cover: the wider of the strips left and right of the
 * panel (full height). With no panel, the whole viewport.
 */
export function freeRegion(vp: Viewport, panel: Rect | null, margin = 12): Rect {
  const full = rect(0, 0, vp.w, vp.h);
  if (!panel || !intersect(panel, full)) return full;
  const leftStrip = rect(0, 0, Math.max(0, panel.left - margin), vp.h);
  const rightStrip = rect(Math.min(vp.w, panel.right + margin), 0, vp.w, vp.h);
  // A panel shorter than the viewport also leaves strips above/below; use them only if both sides are tiny.
  const best = width(leftStrip) >= width(rightStrip) ? leftStrip : rightStrip;
  if (width(best) >= 200) return best;
  const above = rect(0, 0, vp.w, Math.max(0, panel.top - margin));
  const below = rect(0, Math.min(vp.h, panel.bottom + margin), vp.w, vp.h);
  const vBest = height(above) >= height(below) ? above : below;
  return height(vBest) >= 120 && width(vBest) * height(vBest) > width(best) * height(best) ? vBest : best;
}

/** Vertical scroll (dy, to add to window.scrollY) that centres the target in the free region. */
export function scrollOffset(target: Rect, free: Rect, margin = 24): number {
  const room = height(free) - 2 * margin;
  const th = height(target);
  const desiredTop = th >= room ? free.top + margin : free.top + margin + (room - th) / 2;
  return Math.round(target.top - desiredTop);
}

/** Does the target sit horizontally outside the free region enough that a reader can't see it? */
export function horizontallyCovered(target: Rect, free: Rect, minVisible = 0.6) {
  const w = width(target);
  if (!w) return false;
  const visible = Math.max(0, Math.min(target.right, free.right) - Math.max(target.left, free.left));
  return visible / w < minVisible;
}

export type Avoid = "none" | "collapse-canvas" | "move-panel" | "label-only";

/**
 * What to do when the target can't be shown beside the panel: collapse an expanded canvas, move a
 * floating panel to the other side, or (docked chat width, nothing to move) keep the callout on the
 * uncovered side.
 */
export function avoidance(target: Rect, free: Rect, panel: { wide: boolean; docked: boolean } | null): Avoid {
  if (!panel || !horizontallyCovered(target, free)) return "none";
  if (panel.wide) return "collapse-canvas";
  if (!panel.docked) return "move-panel";
  return "label-only";
}

/** Where a floating panel should go to clear the target: the side away from it. */
export function panelSideAwayFrom(target: Rect, vp: Viewport): "left" | "right" {
  return (target.left + target.right) / 2 > vp.w / 2 ? "left" : "right";
}

export interface LabelPlacement {
  left: number;
  top: number;
  side: "top" | "bottom" | "inside";
}

/**
 * Callout position for a highlight: above the target if there's room, else below, else inside its top
 * edge; horizontally clamped into the free region and the viewport so it never sits under the panel.
 */
export function placeLabel(target: Rect, free: Rect, label: { w: number; h: number }, vp: Viewport, gap = 6): LabelPlacement {
  const minL = Math.max(4, free.left + 4);
  const maxL = Math.min(vp.w - 4, free.right - 4) - label.w;
  const left = Math.round(maxL < minL ? minL : Math.min(Math.max(target.left, minL), maxL));
  const topRoom = target.top - gap - label.h;
  if (topRoom >= Math.max(4, free.top)) return { left, top: Math.round(topRoom), side: "top" };
  const below = target.bottom + gap;
  if (below + label.h <= Math.min(vp.h - 4, free.bottom)) return { left, top: Math.round(below), side: "bottom" };
  return { left, top: Math.round(Math.min(Math.max(target.top + gap, 4), vp.h - label.h - 4)), side: "inside" };
}
