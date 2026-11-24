// Fixed-height table rows windowed against the page scroll (no inner scroller), so long tables keep a
// page-level sticky head and sort or filter in a few frames. Used by the screener and the company list.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

/** Row height in px (28 px row + 1 px rule); rows are windowed against the page scroll, not an inner scroller. */
export const ROW_H = 29;
const OVERSCAN = 30;

/** Which of `count` fixed-height rows (`rowH` px each) below `el`'s top are near the viewport. */
export function useWindowRange(el: HTMLElement | null, count: number, rowH = ROW_H) {
  const [range, setRange] = useState<[number, number]>([0, Math.min(count, 80)]);
  useEffect(() => {
    if (!el) return;
    let raf = 0;
    const calc = () => {
      raf = 0;
      const top = el.getBoundingClientRect().top;
      const first = Math.max(0, Math.floor(-top / rowH) - OVERSCAN);
      const last = Math.min(count, Math.ceil((window.innerHeight - top) / rowH) + OVERSCAN);
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
  }, [el, count, rowH]);
  return range;
}


/** The row index a navigation key moves to, or null for keys the list does not handle. Pure. */
export function stepIndex(key: string, cur: number, count: number, pageRows: number): number | null {
  if (!count) return null;
  const at = Math.min(Math.max(cur, 0), count - 1);
  const to =
    key === "ArrowDown" ? at + 1 : key === "ArrowUp" ? at - 1 : key === "PageDown" ? at + pageRows : key === "PageUp" ? at - pageRows : key === "Home" ? 0 : key === "End" ? count - 1 : null;
  return to == null ? null : Math.min(Math.max(to, 0), count - 1);
}

/**
 * The page scroll that brings a row fully into view below the sticky head, or null when it already is.
 * `rowTop` is the row's top in page coordinates; `covered` is the height of the sticky app header plus table head.
 */
export function scrollFor(rowTop: number, rowH: number, scrollY: number, viewH: number, covered: number): number | null {
  if (rowTop < scrollY + covered) return Math.max(0, rowTop - covered);
  if (rowTop + rowH > scrollY + viewH) return rowTop + rowH - viewH;
  return null;
}

/**
 * Keyboard focus for windowed rows: one tab stop (roving tabindex), arrow / Page / Home / End keys move by
 * index in the row model (not by DOM sibling, which may not be rendered yet), the page scrolls just enough
 * to show the target, and focus comes back to the remembered row when it renders again (after a far
 * scroll or Back from the company page). `keys` are the row keys in display order; `pos` gives each
 * key's item index for its pixel offset (group heads take a row too).
 */
export function useRowFocus(body: HTMLElement | null, keys: string[], pos: (key: string) => number, storeKey: string) {
  const [active, setActive] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(storeKey);
    } catch {
      return null;
    }
  });
  const want = useRef(active != null);
  const had = useRef(false);

  // After each render: focus the active row when it is wanted and rendered.
  useLayoutEffect(() => {
    if (!body || active == null || !(want.current || had.current)) return;
    if (!want.current && document.activeElement !== document.body) return;
    const el = body.querySelector<HTMLElement>(`[data-key="${CSS.escape(active)}"]`);
    if (!el) return;
    if (document.activeElement !== el) el.focus({ preventScroll: true });
    want.current = false;
    had.current = true;
    try {
      sessionStorage.removeItem(storeKey);
    } catch {
      /* Storage unavailable. */
    }
  });

  const tabIndex = (key: string, firstRendered: string | undefined) =>
    key === active || ((active == null || !keys.includes(active)) && key === firstRendered) ? 0 : -1;

  // Handlers are stable (they read the latest values from a ref), so memoised rows do not re-render for them.
  const live = useRef({ body, keys, pos, storeKey });
  live.current = { body, keys, pos, storeKey };
  const handlers = useMemo(
    () => ({
      onFocus: (key: string) => {
        had.current = true;
        setActive((a) => (a === key ? a : key));
      },
      onBlur: (e: React.FocusEvent<HTMLElement>) => {
        const t = e.currentTarget;
        // A row removed by the window keeps its claim on focus; focus moved elsewhere gives it up.
        setTimeout(() => {
          // Moving to the next row blurs this one first: keep the claim while focus is still on a row of this list.
          const inList = !!live.current.body?.contains(document.activeElement);
          if (t.isConnected && !inList) had.current = false;
        }, 0);
      },
      onKey: (e: React.KeyboardEvent<HTMLElement>, key: string, open: () => void) => {
        if (e.target !== e.currentTarget) return;
        const { body, keys, pos, storeKey } = live.current;
        if (e.key === "Enter") {
          try {
            sessionStorage.setItem(storeKey, key);
          } catch {
            /* Storage unavailable. */
          }
          return open();
        }
        const head = body?.parentElement?.querySelector("thead");
        const th = head?.querySelector("th");
        const stickTop = th && getComputedStyle(th).position === "sticky" ? parseFloat(getComputedStyle(th).top) || 0 : 0;
        const covered = Math.max(56, stickTop + (stickTop ? (head?.getBoundingClientRect().height ?? 0) : 0));
        const page = Math.max(1, Math.floor((window.innerHeight - covered) / ROW_H) - 1);
        const to = stepIndex(e.key, keys.indexOf(key), keys.length, page);
        if (to == null || !body) return;
        e.preventDefault();
        const next = keys[to];
        const top = body.getBoundingClientRect().top + window.scrollY + pos(next) * ROW_H;
        const y = scrollFor(top, ROW_H, window.scrollY, window.innerHeight, covered);
        if (y != null) window.scrollTo({ top: y });
        want.current = true;
        setActive(next);
      },
    }),
    [],
  );

  return { tabIndex, ...handlers };
}
