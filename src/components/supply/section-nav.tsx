// Section links for the supply-chain page: a slim row that stays under the app header. A link scrolls to its region when
// pressed and changes nothing in the address; the region in view is marked.
import { useEffect, useState } from "react";
import { APP_HEADER, currentSection, SECTION_NAV } from "@/lib/supply/page-nav";
import { cn } from "@/lib/utils";
import { scrollToId } from "./scroll-to";

/** A region counts as reached when its top is this far under the sticky bars. */
const LINE = APP_HEADER + SECTION_NAV + 64;

export function SectionNav({ sections }: { sections: readonly { id: string; label: string }[] }) {
  const [active, setActive] = useState<string>(sections[0]?.id ?? "");
  /* read on scroll, once a frame: positions only, nothing here moves the page */
  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      const els = sections.map((s) => document.getElementById(s.id));
      const i = currentSection(els.map((el) => (el ? el.getBoundingClientRect().top : Infinity)), LINE);
      setActive(sections[i]?.id ?? "");
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(read); };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); };
  }, [sections]);
  return (
    <nav aria-label="Sections of this page" data-agent-controls className="sticky top-[var(--sticky-top,3.5rem)] z-10 mb-3 border-b bg-background">
      <ul className="flex h-10 items-center gap-0.5 text-xs">
        {sections.map((s) => (
          <li key={s.id} className="min-w-0">
            <button type="button" aria-current={active === s.id ? "true" : undefined} onClick={() => scrollToId(s.id)}
              className={cn("inline-flex h-7 max-w-full items-center truncate rounded px-2 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none sm:px-2.5",
                active === s.id ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}>
              {s.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
