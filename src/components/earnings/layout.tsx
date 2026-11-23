// Page scaffolding shared by the Results & promises and Earnings calls tabs: a compact in-page
// section nav that sticks under the app header (and the company bar, via --sticky-top), and a
// section wrapper that carries the assistant's data-section name and the nav's anchor.
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Scroll offset for anchored sections: the sticky app header (and company bar) plus this nav. */
export const SECTION_SCROLL_MARGIN = "scroll-mt-[calc(var(--sticky-top,3.5rem)+3rem)]";

const smooth = (): ScrollBehavior =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

/** Scroll an element to the top of the reading area. Only for explicit jumps (nav links, "go to" buttons). */
export function jumpTo(id: string) {
  const el = document.getElementById(id);
  el?.scrollIntoView({ behavior: smooth(), block: "start" });
  return el;
}

export function PageNav({ sections, label = "On this page" }: { sections: { id: string; label: string }[]; label?: string }) {
  const [active, setActive] = useState(sections[0]?.id);
  const ids = sections.map((s) => s.id).join(",");
  useEffect(() => {
    const els = ids
      .split(",")
      .map((id) => document.getElementById(id))
      .filter((e): e is HTMLElement => !!e);
    if (!els.length || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive(vis[0].target.id);
      },
      { rootMargin: "-120px 0px -55% 0px" },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [ids]);
  if (sections.length < 2) return null;
  return (
    <nav
      aria-label={label}
      data-section="Page sections"
      className="no-scrollbar sticky top-[var(--sticky-top,3.5rem)] z-20 -mx-4 flex gap-1 overflow-x-auto border-b bg-background/95 px-4 py-1.5 backdrop-blur lg:-mx-6 lg:px-6"
    >
      {sections.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          aria-current={active === s.id ? "true" : undefined}
          onClick={(e) => {
            e.preventDefault();
            jumpTo(s.id);
            setActive(s.id);
          }}
          className={cn(
            "inline-flex h-7 shrink-0 items-center rounded-md border px-2.5 text-[12px] whitespace-nowrap transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            active === s.id ? "border-foreground/25 bg-secondary text-foreground" : "border-transparent text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
          )}
        >
          {s.label}
        </a>
      ))}
    </nav>
  );
}

/** One region of the page: anchor id, assistant name, a 14 px title with an 11 px caption, optional actions. */
export function Section({
  id,
  name,
  title,
  caption,
  actions,
  children,
  className,
  bodyClassName,
}: {
  id: string;
  /** data-section name the in-app assistant targets */
  name: string;
  title: ReactNode;
  caption?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section id={id} data-section={name} className={cn("min-w-0 border-y bg-card/40", SECTION_SCROLL_MARGIN, className)}>
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold tracking-tight">{title}</h2>
          {caption && <p className="text-[11px] text-muted-foreground">{caption}</p>}
        </div>
        {actions && <div className="ml-auto flex items-center gap-1.5">{actions}</div>}
      </header>
      <div className={cn("min-w-0", bodyClassName)}>{children}</div>
    </section>
  );
}

/** Quiet one-line state for a part of a section with nothing to show. */
export function Quiet({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("px-4 py-3 text-[13px] text-muted-foreground", className)}>{children}</p>;
}
