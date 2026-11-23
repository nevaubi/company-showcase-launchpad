import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The page's one section nav: a sticky row of links that jump to the sections and mark the one in view. Shown at
 * every width. The section that counts as "in view" is the last one whose top has passed under the sticky header, so
 * the first chip is marked at the top of the page and the last one at the bottom.
 */
export function SectionNav({ sections }: { sections: { id: string; label: string }[] }) {
  const [active, setActive] = useState(sections[0]?.id);
  useEffect(() => {
    if (typeof window === "undefined") return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      // the line just under the sticky header and this nav
      const line = 112;
      let current = sections[0]?.id;
      for (const s of sections) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top - line <= 0) current = s.id;
      }
      const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      if (atEnd) {
        const lastPresent = [...sections].reverse().find((s) => document.getElementById(s.id));
        if (lastPresent) current = lastPresent.id;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [sections]);
  return (
    <nav aria-label="On this page" data-section="Section nav" className="no-scrollbar sticky top-[var(--sticky-top,3.5rem)] z-10 -mx-4 flex gap-1 overflow-x-auto border-b bg-background/95 px-4 py-1.5 backdrop-blur">
      {sections.map((s) => (
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
            window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 104, behavior: reduce ? "auto" : "smooth" });
            setActive(s.id);
          }}
          className={cn(
            "shrink-0 rounded-full border px-2.5 py-0.5 text-[12px] whitespace-nowrap transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
            active === s.id ? "border-foreground/30 bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {s.label}
        </a>
      ))}
    </nav>
  );
}
