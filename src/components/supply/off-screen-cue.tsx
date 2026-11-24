// A slim bar at the bottom of the window that says what a click just produced when that is out of view, with a button
// that goes there. The page never scrolls by itself: on a phone this is how the reader gets from a tapped name to its
// evidence, and from a company picked far down the page back to the map.
import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { APP_HEADER, offscreen, SECTION_NAV } from "@/lib/supply/page-nav";
import { scrollToId } from "./scroll-to";

export interface Cue {
  /** id of the region the cue leads to */
  target: string;
  /** what happened, in a few words: "Fabrinet, supplier" */
  label: string;
  /** the button's word: "Evidence", "Map" */
  action: string;
  /** changes with every click that raises a cue, so the same name twice still measures again */
  n: number;
}

export function OffscreenCue({ cue, onDone }: { cue: Cue | null; onDone: () => void }) {
  const [where, setWhere] = useState<"above" | "below" | null>(null);
  const target = cue?.target;
  const measure = useCallback(() => {
    const el = target ? document.getElementById(target) : null;
    return el ? offscreen(el.getBoundingClientRect(), window.innerHeight, APP_HEADER + SECTION_NAV) : null;
  }, [target]);
  const n = cue?.n;
  useEffect(() => {
    if (n == null) { setWhere(null); return; }
    /* after the click has rendered: the region may have just grown or moved */
    const frame = requestAnimationFrame(() => setWhere(measure()));
    return () => cancelAnimationFrame(frame);
  }, [n, measure]);
  useEffect(() => {
    if (!where) return;
    const check = () => { if (!measure()) onDone(); };
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    const quiet = window.setTimeout(onDone, 12_000);
    return () => { window.removeEventListener("scroll", check); window.removeEventListener("resize", check); window.clearTimeout(quiet); };
  }, [where, measure, onDone]);
  if (!cue || !where) return null;
  const Arrow = where === "above" ? ArrowUp : ArrowDown;
  return (
    /* above the assistant's launcher, which sits in the bottom right corner */
    <div className="pointer-events-none fixed inset-x-0 bottom-14 z-30 flex justify-center px-3 sm:bottom-4" data-agent-ignore>
      <div role="status" data-supply-cue="" className="panel-in pointer-events-auto flex max-w-[min(100%,26rem)] items-center gap-2 rounded-md border bg-popover py-1 pl-3 pr-1 text-xs text-popover-foreground shadow-lift">
        <span className="min-w-0 truncate">{cue.label}</span>
        <button type="button" onClick={() => { scrollToId(cue.target); onDone(); }}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded bg-ink px-2.5 font-medium text-ink-foreground transition-opacity duration-150 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 motion-reduce:transition-none">
          {cue.action}<Arrow className="size-3.5" aria-hidden="true" />
        </button>
        <button type="button" aria-label="Dismiss" onClick={onDone}
          className="grid size-7 shrink-0 place-items-center rounded text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none">
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
