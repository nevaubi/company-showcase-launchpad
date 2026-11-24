// Fixed-height table rows windowed against the page scroll (no inner scroller), so long tables keep a
// page-level sticky head and sort or filter in a few frames. Used by the screener and the company list.
import { useEffect, useState } from "react";

/** Row height in px (28 px row + 1 px rule); rows are windowed against the page scroll, not an inner scroller. */
export const ROW_H = 29;
const OVERSCAN = 30;

/** Which of `count` fixed-height rows below `el`'s top are near the viewport. */
export function useWindowRange(el: HTMLElement | null, count: number) {
  const [range, setRange] = useState<[number, number]>([0, Math.min(count, 80)]);
  useEffect(() => {
    if (!el) return;
    let raf = 0;
    const calc = () => {
      raf = 0;
      const top = el.getBoundingClientRect().top;
      const first = Math.max(0, Math.floor(-top / ROW_H) - OVERSCAN);
      const last = Math.min(count, Math.ceil((window.innerHeight - top) / ROW_H) + OVERSCAN);
      setRange((r) => (r[0] === first && r[1] === Math.max(first, last) ? r : [first, Math.max(first, last)]));
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(calc);
    };
    calc();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [el, count]);
  return range;
}

