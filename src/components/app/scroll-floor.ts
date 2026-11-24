import { useEffect, type RefObject } from "react";

/**
 * The least height a region that starts `top` px down the document needs so that the page still reaches the
 * bottom of the window where the reader is. Pure.
 */
export function floorHeight(top: number, scrollY: number, viewportHeight: number): number {
  if (![top, scrollY, viewportHeight].every(Number.isFinite)) return 0;
  return Math.max(0, Math.ceil(scrollY + viewportHeight - top));
}

/**
 * Keeps the page from getting shorter than where the reader already is.
 *
 * When a control swaps what it shows for something shorter (a tab, a filter, a drill-down) while the reader is
 * near the end of the page, the document would end above the bottom of the window and the browser pulls the
 * page up to fit: the control just pressed jumps away from the pointer. The region therefore always carries a
 * minimum height that reaches the bottom of the window at the reader's position. It only ever equals where the
 * reader already is, so it adds no empty space until content shrinks, and it falls again as the reader scrolls
 * up. It is set when scrolling stops and again on every press and key, which come before the change they
 * cause, so the floor is exact when a control acts and costs nothing while the page is scrolling.
 */
export function useScrollFloor(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window === "undefined") return;
    let timer = 0;
    const set = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      const next = `${floorHeight(top, window.scrollY, window.innerHeight)}px`;
      if (el.style.minHeight !== next) el.style.minHeight = next;
    };
    const later = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(set, 120);
    };
    set();
    window.addEventListener("scroll", later, { passive: true });
    window.addEventListener("resize", later);
    window.addEventListener("pointerdown", set, { capture: true, passive: true });
    window.addEventListener("keydown", set, { capture: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("scroll", later);
      window.removeEventListener("resize", later);
      window.removeEventListener("pointerdown", set, { capture: true });
      window.removeEventListener("keydown", set, { capture: true });
      el.style.minHeight = "";
    };
  }, [ref]);
}
