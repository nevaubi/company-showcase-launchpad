// The only file of the supply-chain page that touches the window's scroll position (page-nav.test.ts checks).
// Two things live here, and neither is a side effect of a selection, a tab, a view, a flag or an isolation:
//   scrollToId   goes to a region when the reader presses a section link or the button of a cue;
//   holdInPlace  keeps what the reader pressed where it is on screen when a company change makes the page above it
//                taller or shorter. It moves the window by exactly the amount the content shifted, before the next
//                paint, so nothing appears to move: the opposite of scrolling somewhere.

/** Smoothly brings a region to the top of the visible area (its `scroll-margin-top` keeps it clear of the sticky bars). */
export function scrollToId(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  const calm = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
}

const INPUTS = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

/**
 * Holds `pressed` at the place on screen it has now, for `ms` or until the reader scrolls, taps or types. When the
 * change re-creates the pressed control, the nearest enclosing region that survives (an element with an id or a
 * `data-section`) is held instead. It ends at once when the window moves and this hold did not move it (the scrollbar,
 * a section link), so it never works against the reader. Returns a function that ends the hold early.
 */
export function holdInPlace(pressed: Element | null, ms = 4000): () => void {
  if (!pressed || typeof window === "undefined" || typeof requestAnimationFrame !== "function") return () => {};
  const marks: { el: Element; top: number }[] = [];
  for (let el: Element | null = pressed; el && el !== document.body; el = el.parentElement) {
    if (el === pressed || el.id || el.hasAttribute("data-section")) marks.push({ el, top: el.getBoundingClientRect().top });
  }
  /* The browser's own scroll anchoring would correct the same shift a second time, or keep another element in place. */
  const root = document.documentElement, anchoring = root.style.overflowAnchor;
  root.style.overflowAnchor = "none";
  const until = performance.now() + ms;
  let frame = 0, over = false, y = window.scrollY;
  const stop = () => {
    if (over) return;
    over = true;
    cancelAnimationFrame(frame);
    root.style.overflowAnchor = anchoring;
    for (const e of INPUTS) window.removeEventListener(e, stop, true);
  };
  const tick = () => {
    if (over) return;
    if (Math.abs(window.scrollY - y) > 1) return stop();
    const mark = marks.find((m) => m.el.isConnected);
    if (mark) {
      const shift = mark.el.getBoundingClientRect().top - mark.top;
      if (Math.abs(shift) >= 1) {
        window.scrollBy({ top: shift, behavior: "instant" });
        y = window.scrollY;
      }
    }
    if (mark && performance.now() < until) frame = requestAnimationFrame(tick);
    else stop();
  };
  for (const e of INPUTS) window.addEventListener(e, stop, { capture: true, passive: true });
  frame = requestAnimationFrame(tick);
  return stop;
}
