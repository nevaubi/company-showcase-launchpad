// The column beside the supply-chain map. Its panel follows the reader down the page so the evidence for a pick is
// always next to it, and it never jumps: when its content grows (another tab, a longer list) the column makes room
// and the panel stays where it is. A panel taller than the window is released into the flow while the reader scrolls
// through it. Once the reader is past the column it is left alone (`columnBehind`). The decisions are pure (`nextFollow`, `followRoom` in page-nav.ts); this file measures and applies them.
// It only positions the panel: the window's scroll position is never touched.
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { columnBehind, FOLLOW_START, followRoom, nextFollow, PANEL_TOP, type FollowState } from "@/lib/supply/page-nav";
import { cn } from "@/lib/utils";

const MARGIN = 16;
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function FollowPanel({ id, resetKey, minWidth, className, children }: {
  id: string;
  /** changes when the reader picks something new: the panel then shows its head under the sticky bars */
  resetKey: string;
  /** width of the enclosing grid from which the panel sits beside the map (the same number as its container query) */
  minWidth: number;
  className?: string;
  children: ReactNode;
}) {
  const cell = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const state = useRef<FollowState>(FOLLOW_START);
  const lastY = useRef(0);
  const run = useRef<(dir: -1 | 0 | 1, reset?: boolean) => void>(() => {});

  useEffect(() => {
    const c = cell.current, p = panel.current;
    if (!c || !p) return;
    /* styles are written only when they change, so a measurement never causes another one */
    const put = (el: HTMLElement, prop: "position" | "top" | "marginTop" | "minHeight", value: string) => { if (el.style[prop] !== value) el.style[prop] = value; };
    const apply = (dir: -1 | 0 | 1, reset = false) => {
      const beside = (c.parentElement?.clientWidth ?? 0) >= minWidth;
      if (!beside) {
        /* under the map (narrow): plain flow */
        state.current = FOLLOW_START;
        put(p, "position", ""); put(p, "top", ""); put(p, "marginTop", ""); put(c, "minHeight", "");
        return;
      }
      const cellRect = c.getBoundingClientRect();
      /* the reader is past the column (a company picked from a list further down): leave it exactly as it is */
      if (columnBehind(cellRect.bottom, PANEL_TOP)) return;
      const cellTop = cellRect.top, rect = p.getBoundingClientRect(), vh = window.innerHeight;
      const prev = state.current;
      const next = reset ? FOLLOW_START : nextFollow(prev, { cellTop, panelTop: rect.top, panelHeight: rect.height, viewportHeight: vh, dir }, PANEL_TOP, MARGIN);
      state.current = next;
      if (next.mode === "free") {
        put(p, "position", "relative"); put(p, "top", "auto"); put(p, "marginTop", `${next.offset}px`); put(c, "minHeight", "");
      } else if (next.mode === "bottom") {
        put(p, "position", "sticky"); put(p, "top", `${Math.round(vh - MARGIN - rect.height)}px`); put(p, "marginTop", `${next.offset}px`); put(c, "minHeight", "");
      } else {
        put(p, "position", "sticky"); put(p, "top", `${PANEL_TOP}px`); put(p, "marginTop", "0px");
        /* Room for the panel to stay where it is (see followRoom). It is set when the panel is put at the top or its
           content changes. While the reader scrolls it never grows (the page would lengthen under them without end),
           and it shrinks back only as far as keeps the end of the column out of sight, so nothing visible moves. */
        const room = Math.ceil(followRoom(cellTop, rect.height, PANEL_TOP));
        const had = parseFloat(c.style.minHeight) || 0;
        if (reset || dir === 0 || next !== prev) put(c, "minHeight", `${room}px`);
        else if (room < had) put(c, "minHeight", `${Math.max(room, Math.min(had, Math.round(vh - cellTop + 64)))}px`);
      }
    };
    run.current = apply;
    lastY.current = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY, dir = y > lastY.current ? 1 : y < lastY.current ? -1 : 0;
      lastY.current = y;
      if (dir) apply(dir);
    };
    const onResize = () => apply(0);
    /* the panel's own size is all that needs watching: its width changes when it moves beside or under the map */
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => apply(0));
    ro?.observe(p);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    apply(0, true);
    return () => { ro?.disconnect(); window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onResize); run.current = () => {}; };
  }, [minWidth]);

  /* a new pick: show the head of the panel where the reader is, before the browser paints */
  useIsoLayoutEffect(() => { run.current(0, true); }, [resetKey]);

  return (
    <div ref={cell} className={cn("min-w-0 self-stretch", className)}>
      <div ref={panel} id={id} className="scroll-mt-[calc(var(--sticky-top,3.5rem)+3rem)]">{children}</div>
    </div>
  );
}
