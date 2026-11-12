import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** Sticky chip row that jumps to the page's sections and marks the one in view. Shown at every width: long pages need it on desktop too. */
export function SectionNav({ sections }: { sections: { id: string; label: string }[] }) {
  const [active, setActive] = useState(sections[0]?.id);
  useEffect(() => {
    const els = sections
      .map((s) => document.getElementById(s.id))
      .filter((e): e is HTMLElement => !!e);
    if (!els.length || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive(vis[0].target.id);
      },
      { rootMargin: "-96px 0px -60% 0px" },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [sections]);
  return (
    <nav
      aria-label="On this page"
      className="no-scrollbar sticky top-12 z-10 -mx-4 flex gap-1 overflow-x-auto border-b bg-background/95 px-4 py-1.5 backdrop-blur"
    >
      {sections.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          onClick={(e) => {
            e.preventDefault();
            document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
            setActive(s.id);
          }}
          className={cn(
            "shrink-0 rounded-full border px-2.5 py-0.5 text-[12px] whitespace-nowrap",
            active === s.id
              ? "border-foreground/30 bg-secondary text-foreground"
              : "text-muted-foreground",
          )}
        >
          {s.label}
        </a>
      ))}
    </nav>
  );
}
