// Shared pieces of the three sector pages: section frame, in-page section nav, sortable header cell,
// breadcrumb, breadth meter and the return shading. One set of sizes: 14/600 section titles, 11 px
// captions, 13 px rows of 28 px, 11 px column heads, `.eyebrow` for quiet group heads.
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Share } from "@/lib/sectors/stats";
import { overviewState } from "@/lib/sectors/overview-state";

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
  /** Anchor id for the section nav. */
  id?: string;
  /** `data-section` name for the assistant. */
  name: string;
  title: ReactNode;
  caption?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      id={id}
      data-section={name}
      className={cn("min-w-0 scroll-mt-[calc(var(--sticky-top,3.5rem)+3rem)] border-y bg-card/40", className)}
    >
      <header className="flex flex-wrap items-start gap-x-3 gap-y-1.5 border-b px-3.5 py-2">
        <div className="min-w-[min(100%,16rem)] flex-1">
          <h2 className="text-[14px] font-semibold leading-5 tracking-tight">{title}</h2>
          {caption && <p className="text-[11px] leading-4 text-muted-foreground">{caption}</p>}
        </div>
        {actions && <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-1.5">{actions}</div>}
      </header>
      <div className={cn("min-w-0", bodyClassName)}>{children}</div>
    </section>
  );
}

/** Sticky row of anchor links to the page's sections; marks the one in view. Scrolls only when clicked. */
export function SectionNav({ sections }: { sections: { id: string; label: string }[] }) {
  const [active, setActive] = useState(sections[0]?.id);
  const key = sections.map((s) => s.id).join();
  useEffect(() => {
    const els = sections.map((s) => document.getElementById(s.id)).filter((e): e is HTMLElement => !!e);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (
    <nav
      aria-label="On this page"
      data-section="Section nav"
      className="no-scrollbar sticky top-[var(--sticky-top,3.5rem)] z-20 -mx-4 flex gap-1 overflow-x-auto border-b bg-background/95 px-4 py-1.5 backdrop-blur"
    >
      {sections.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          onClick={(e) => {
            e.preventDefault();
            const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
            document.getElementById(s.id)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
            setActive(s.id);
          }}
          aria-current={active === s.id ? "true" : undefined}
          className={cn(
            "inline-flex h-7 shrink-0 items-center rounded-md px-2.5 text-[12px] whitespace-nowrap transition-colors duration-150 hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            active === s.id ? "bg-secondary font-medium text-foreground" : "text-muted-foreground",
          )}
        >
          {s.label}
        </a>
      ))}
    </nav>
  );
}

/** A column head that sorts: first click sorts the column's natural way, the next reverses it. */
export function SortTh({
  k,
  label,
  title,
  sort,
  dir,
  onSort,
  align = "right",
  className,
  first = "desc",
}: {
  k: string;
  label: ReactNode;
  title?: string;
  sort: string;
  dir: "asc" | "desc";
  onSort: (k: string, dir: "asc" | "desc") => void;
  align?: "left" | "right";
  className?: string;
  first?: "asc" | "desc";
}) {
  const on = sort === k;
  return (
    <th
      scope="col"
      aria-sort={on ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn("h-8 px-2 font-medium", align === "right" ? "text-right" : "text-left", className)}
    >
      <button
        type="button"
        title={title}
        data-agent-click
        onClick={() => onSort(k, on ? (dir === "asc" ? "desc" : "asc") : first)}
        className={cn(
          "inline-flex h-7 items-center gap-0.5 whitespace-nowrap rounded px-1 transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          align === "right" ? "-mr-1 flex-row-reverse" : "-ml-1",
          on && "text-foreground",
        )}
      >
        {on ? dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : <span className="size-3" />}
        <span>{label}</span>
      </button>
    </th>
  );
}

export interface Crumb {
  label: string;
  to?: "/app/sectors" | "/app/sectors/$sector" | "/app/sectors/g/$slug";
  params?: Record<string, string>;
}
export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" data-section="Breadcrumb" className="mb-1 flex flex-wrap items-center gap-1 text-[12px] text-muted-foreground">
      {items.map((c, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {i > 0 && <ChevronRight className="size-3 opacity-60" aria-hidden />}
          {c.to ? (
            <Link
              to={c.to}
              params={c.params as never}
              search={c.to === "/app/sectors" ? (overviewState() as never) : undefined}
              className="rounded-sm transition-colors duration-150 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {c.label}
            </Link>
          ) : (
            <span aria-current="page" className="text-foreground">
              {c.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}

/** Link target of a group: sectors open their sector page, industries their group page. */
export function groupLink(kind: "sector" | "industry", name: string, slug: string): Crumb {
  return kind === "sector" ? { label: name, to: "/app/sectors/$sector", params: { sector: name } } : { label: name, to: "/app/sectors/g/$slug", params: { slug } };
}

/** What a breadth share rests on, for a tooltip: members with a reading, and those without a breadth row. */
export function shareTitle(share: Share | null | undefined, noRow?: number | null) {
  if (!share) return undefined;
  const none = noRow ? `; ${noRow} ${noRow === 1 ? "has" : "have"} no breadth row` : "";
  return `${share.hits} of ${share.known} members with a reading${none}`;
}

/** Breadth as a short meter plus the share; a thin group shows its count instead of a percentage. */
export function ShareMeter({ value, share, noRow, className }: { value: number | null; share?: Share | null; noRow?: number | null; className?: string }) {
  if (share?.thin && share.known > 0)
    return (
      <span className={cn("num text-muted-foreground", className)} title={shareTitle(share, noRow)}>
        {share.hits} of {share.known}
      </span>
    );
  if (value == null)
    return (
      <span className="text-muted-foreground" title={share && noRow ? `No member has a breadth row (${noRow})` : undefined}>
        –
      </span>
    );
  return (
    <span className={cn("inline-flex items-center justify-end gap-1.5", className)} title={shareTitle(share, noRow)}>
      <span className="relative h-1 w-8 overflow-hidden rounded-full bg-secondary" aria-hidden>
        <span className="absolute inset-y-0 left-0 rounded-full bg-muted-foreground/70" style={{ width: `${Math.round(value * 100)}%` }} />
      </span>
      <span className="num w-8 text-right">{Math.round(value * 100)}%</span>
    </span>
  );
}

/** Diverging background for a value against a neutral midpoint (return minus SPY's); `scale` is where it saturates. */
export function heat(v: number | null | undefined, scale: number) {
  if (v == null || !Number.isFinite(v) || v === 0) return undefined;
  const a = Math.min(1, Math.abs(v) / scale) * 24;
  return { background: `color-mix(in oklab, var(${v > 0 ? "--positive" : "--negative"}) ${a.toFixed(0)}%, transparent)` };
}

/** Element width, for SVG charts that fill their column. */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/**
 * Whether a table that needs `min` px fits its wrapper. When it does, the wrapper needs no sideways
 * scroller and the table head can stick to the page; when it does not, the wrapper scrolls and the head
 * stays with the table (a sticky head cannot leave a scrolling box).
 */
export function useFits<T extends HTMLElement>(min: number) {
  const [ref, w] = useWidth<T>();
  return [ref, w >= min] as const;
}

/** Head cells that stick under the app header, or under the page's section nav (41 px) when `nav`. Written out in full so Tailwind sees the classes. */
export const STICKY_HEAD = "[&>th]:sticky [&>th]:top-[var(--sticky-top,3.5rem)] [&>th]:z-10";
export const STICKY_HEAD_2 = "[&>th]:sticky [&>th]:top-[calc(var(--sticky-top,3.5rem)+1.5rem)] [&>th]:z-10";
export const STICKY_HEAD_NAV = "[&>th]:sticky [&>th]:top-[calc(var(--sticky-top,3.5rem)+41px)] [&>th]:z-10";

/**
 * One figure with what it rests on: label, value, a secondary line, and a basis line (quarter and
 * company count, or a date). Used by the summary strip and the risk tiles so every headline says its basis.
 */
export function Tile({
  label,
  value,
  sub,
  basis,
  subTone,
  title,
  onClick,
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  basis?: ReactNode;
  subTone?: string;
  title?: string;
  onClick?: () => void;
  className?: string;
}) {
  const body = (
    <>
      <span className="block truncate text-[11px] text-muted-foreground">{label}</span>
      <span className="num mt-0.5 block text-[18px] font-semibold leading-6">{value}</span>
      <span className={cn("num block truncate text-[11px] leading-4 text-muted-foreground", subTone)}>{sub ?? "\u00a0"}</span>
      <span className="num block truncate text-[11px] leading-4 text-muted-foreground/80">{basis ?? "\u00a0"}</span>
    </>
  );
  const cls = cn("min-w-0 px-3 py-2 text-left", className);
  return onClick ? (
    <button
      type="button"
      title={title}
      onClick={onClick}
      data-agent-click
      className={cn(cls, "transition-colors duration-150 hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring")}
    >
      {body}
    </button>
  ) : (
    <div className={cls} title={title}>
      {body}
    </div>
  );
}

/** One quiet line in place of a section that has nothing for this group. */
export function QuietLine({ children }: { children: ReactNode }) {
  return <p className="px-3.5 py-2.5 text-[12px] text-muted-foreground">{children}</p>;
}
