/**
 * One sideways position for the whole statements grid: the column head row and every section's figure
 * columns scroll together, as one spreadsheet does, so a column stays under its head from the first table to
 * the last. Each member is registered by its element; a scroll of any member moves the others to the same
 * position. Until the reader scrolls, every member opens at its newest columns (far right).
 * Only `scrollLeft` is set here: no box changes size when the grid scrolls.
 */
import { createContext, useContext } from "react";

export interface ScrollGroup {
  /** add a member; returns its removal */
  add: (el: HTMLElement) => () => void;
  /** a member scrolled: move the others with it */
  follow: (el: HTMLElement) => void;
  /** back to the newest columns (a period chip or the period type changed) */
  reset: () => void;
}

/** Marks the host while the grid is scrolled sideways (the label column then casts a soft edge). */
export const SCROLLED_ATTR = "data-scrolled";

export function scrollGroup(host?: () => HTMLElement | null): ScrollGroup {
  const els = new Set<HTMLElement>();
  /** the shared position; null until the reader scrolls: newest columns */
  let pos: number | null = null;
  let moving = false;
  const place = (el: HTMLElement) => {
    const x = pos ?? el.scrollWidth;
    if (Math.abs(el.scrollLeft - x) > 0.5) el.scrollLeft = x;
  };
  const mark = (x: number) => host?.()?.toggleAttribute(SCROLLED_ATTR, x > 1);
  return {
    add(el) {
      els.add(el);
      place(el);
      mark(el.scrollLeft);
      return () => void els.delete(el);
    },
    follow(el) {
      if (moving) return;
      // At the far right the position stays "newest", so a member mounted later opens there too.
      pos = el.scrollLeft >= el.scrollWidth - el.clientWidth - 0.5 ? null : el.scrollLeft;
      moving = true;
      for (const o of els) if (o !== el) place(o);
      moving = false;
      mark(el.scrollLeft);
    },
    reset() {
      pos = null;
      for (const o of els) place(o);
      const first = els.values().next().value;
      mark(first ? first.scrollLeft : 0);
    },
  };
}

const none: ScrollGroup = { add: () => () => undefined, follow: () => undefined, reset: () => undefined };
export const ScrollGroupContext = createContext<ScrollGroup>(none);
export const useScrollGroup = () => useContext(ScrollGroupContext);
