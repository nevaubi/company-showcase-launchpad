import { useEffect, useRef, useState } from "react";
import { currentSection, markedSection, type NavPin } from "@/lib/company/section-nav";
import { cn } from "@/lib/utils";

/**
 * The page's one section nav: a sticky row of links that jump to the sections and mark the one in view. Shown at
 * every width. A section that has nothing to show for this company (no stored data) takes no space on the page and
 * gets no chip. The section "in view" is the last one whose top has passed under the sticky rows, so the first chip
 * is marked at the top of the page and the last one at the bottom.
 */
/** The line just under the sticky rows above the page (app header, any company bar) and this nav, in px. */
function stickyLine(nav: HTMLElement | null): number {
  if (!nav) return 112;
  const top = parseFloat(getComputedStyle(nav).top);
  return (Number.isFinite(top) ? top : 56) + nav.offsetHeight + 8;
}

export function SectionNav({ sections }: { sections: { id: string; label: string }[] }) {
  const [active, setActive] = useState<string | undefined>(sections[0]?.id);
  const [present, setPresent] = useState<string>(() => sections.map((s) => s.id).join(" "));
  const [nav, setNav] = useState<HTMLElement | null>(null);
  // the chip the reader clicked, held while the smooth scroll runs and while the page stays where it landed
  const pin = useRef<NavPin | null>(null);
  const settle = useRef<{ timer: number; done: () => void } | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const line = stickyLine(nav);
      const shown = sections.filter((s) => (document.getElementById(s.id)?.offsetHeight ?? 0) > 0);
      const tops = shown.map((s) => ({ id: s.id, top: document.getElementById(s.id)!.getBoundingClientRect().top }));
      const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      const marked = markedSection(pin.current, window.scrollY, currentSection(tops, line, { end: atEnd, scrolled: window.scrollY > 0 }));
      pin.current = marked.pin;
      setActive(marked.id);
      setPresent(shown.map((s) => s.id).join(" "));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    // sections fill in as their data arrives: look again when the page under the nav changes
    const page = nav?.parentElement;
    const seen = page && typeof MutationObserver !== "undefined" ? new MutationObserver(onScroll) : null;
    if (page && seen) seen.observe(page, { childList: true, subtree: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      seen?.disconnect();
      if (frame) cancelAnimationFrame(frame);
      if (settle.current) {
        window.clearTimeout(settle.current.timer);
        window.removeEventListener("scrollend", settle.current.done);
        settle.current = null;
      }
    };
  }, [sections, nav]);
  const shown = new Set(present.split(" "));
  return (
    <nav ref={setNav} aria-label="On this page" data-section="Section nav" className="no-scrollbar sticky top-[var(--sticky-top,3.5rem)] z-10 -mx-4 flex gap-1 overflow-x-auto border-b bg-background/95 px-4 py-1.5 backdrop-blur">
      {sections.filter((s) => shown.has(s.id)).map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          aria-current={active === s.id ? "location" : undefined}
          onClick={(e) => {
            const el = document.getElementById(s.id);
            if (!el) return;
            e.preventDefault();
            const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
            // an explicit jump the reader asked for: move the page to the section, under the sticky rows
            if (settle.current) {
              window.clearTimeout(settle.current.timer);
              window.removeEventListener("scrollend", settle.current.done);
            }
            pin.current = { id: s.id, y: null };
            // the jump has ended at `scrollend` (or, where the browser has no such event, after a smooth scroll's
            // length); from then on the pin holds only while the page stays at that position
            const done = () => {
              if (settle.current?.done !== done) return;
              window.clearTimeout(settle.current.timer);
              window.removeEventListener("scrollend", done);
              settle.current = null;
              if (pin.current?.id === s.id) pin.current = { id: s.id, y: window.scrollY };
            };
            settle.current = { timer: window.setTimeout(done, 1200), done };
            window.addEventListener("scrollend", done);
            setActive(s.id);
            window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - stickyLine(nav), behavior: reduce ? "auto" : "smooth" });
          }}
          className={cn(
            "inline-flex min-h-7 shrink-0 items-center rounded-full border px-2.5 text-[13px] whitespace-nowrap transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
            active === s.id ? "border-foreground/30 bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {s.label}
        </a>
      ))}
    </nav>
  );
}
