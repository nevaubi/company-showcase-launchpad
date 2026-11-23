// Section links for the supply-chain page: a slim row that stays under the app header. A link scrolls to its region when
// pressed and changes nothing in the address; the region in view is marked.
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { scrollToId } from "./scroll-to";

export function SectionNav({ sections }: { sections: readonly { id: string; label: string }[] }) {
  const [active, setActive] = useState<string>(sections[0]?.id ?? "");
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) seen.set(e.target.id, e.isIntersecting);
      const first = sections.find((s) => seen.get(s.id));
      if (first) setActive(first.id);
    }, { rootMargin: "-100px 0px -55% 0px" });
    for (const s of sections) { const el = document.getElementById(s.id); if (el) io.observe(el); }
    return () => io.disconnect();
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
