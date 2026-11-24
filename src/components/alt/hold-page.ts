import { useCallback, useEffect, useRef } from "react";
import { holdFloor } from "@/lib/alt/hub";

/**
 * Keeps a page from getting shorter under the reader when one of its controls removes content (a theme that
 * filters rows away, a dataset closed). Call `hold()` in the control's handler, before the state changes: the
 * page keeps its height as a minimum, and as the reader scrolls up the minimum shrinks to what the window needs
 * (`holdFloor`), so the browser never clamps the scroll position and nothing is padded for long.
 */
export function useHoldPage<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const held = useRef(0);

  const apply = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    held.current = holdFloor(held.current, window.scrollY, window.innerHeight, top);
    el.style.minHeight = held.current ? `${held.current}px` : "";
    if (!held.current) window.removeEventListener("scroll", apply);
  }, []);

  const hold = useCallback(() => {
    const el = ref.current;
    if (!el || typeof window === "undefined") return;
    held.current = Math.max(held.current, Math.ceil(el.getBoundingClientRect().height));
    el.style.minHeight = `${held.current}px`;
    window.removeEventListener("scroll", apply);
    window.addEventListener("scroll", apply, { passive: true });
    // once the change is painted, keep only what the reader's position needs (nothing, when they are near the top)
    requestAnimationFrame(() => requestAnimationFrame(apply));
  }, [apply]);

  useEffect(() => () => window.removeEventListener("scroll", apply), [apply]);
  return { ref, hold };
}
