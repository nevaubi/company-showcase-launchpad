import { useCallback, useRef, useState, type KeyboardEvent } from "react";

/**
 * One tab stop for a row of marks: the arrow keys move between them (Home and End to the ends), Enter or Space
 * activates the focused one. Focus moves without scrolling the page.
 */
export function useRoving(count: number, onActivate: (index: number) => void) {
  const [active, setActive] = useState(0);
  const nodes = useRef(new Map<number, HTMLElement>());
  const current = Math.min(active, Math.max(0, count - 1));
  const focus = useCallback((i: number) => {
    setActive(i);
    nodes.current.get(i)?.focus({ preventScroll: true });
  }, []);
  const onKeyDown = (e: KeyboardEvent, i: number) => {
    const next =
      e.key === "ArrowRight" || e.key === "ArrowDown" ? Math.min(count - 1, i + 1)
      : e.key === "ArrowLeft" || e.key === "ArrowUp" ? Math.max(0, i - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? count - 1
      : null;
    if (next !== null) {
      e.preventDefault();
      focus(next);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onActivate(i);
    }
  };
  const bind = (i: number) => ({
    ref: (el: HTMLElement | null) => {
      if (el) nodes.current.set(i, el);
      else nodes.current.delete(i);
    },
    tabIndex: i === current ? 0 : -1,
    onKeyDown: (e: KeyboardEvent) => onKeyDown(e, i),
    onFocus: () => setActive(i),
  });
  return { active: current, bind };
}
