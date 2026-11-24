import { useIsFetching } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * Keeps a region at least as tall as it was when `hold` changes, until the new content has loaded,
 * so a view switch never shrinks the page under the reader (the browser would clamp the scroll
 * position to the top and not give it back). Released once no query has been fetching for a moment;
 * if the new content is really shorter the page shortens then, as it must.
 */
export function HoldHeight({ hold, children, className }: { hold: string; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef(0);
  const [key, setKey] = useState(hold);
  const [min, setMin] = useState<number | undefined>(undefined);
  if (key !== hold) {
    setKey(hold);
    setMin(last.current || undefined);
  }
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      // Only the natural height counts, never the held one.
      if (!el.style.minHeight) last.current = el.offsetHeight;
    });
    ro.observe(el);
    last.current = el.offsetHeight;
    return () => ro.disconnect();
  }, []);
  const fetching = useIsFetching();
  const saw = useRef(false);
  useEffect(() => {
    if (min == null) {
      saw.current = false;
      return;
    }
    if (fetching > 0) saw.current = true;
    const t = setTimeout(() => setMin(undefined), fetching > 0 ? 10_000 : saw.current ? 50 : 400);
    return () => clearTimeout(t);
  }, [min, fetching]);
  useEffect(() => {
    if (min == null && ref.current) last.current = ref.current.offsetHeight;
  }, [min]);
  return (
    <div ref={ref} className={className} style={min ? { minHeight: min } : undefined}>
      {children}
    </div>
  );
}
