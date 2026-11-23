// Shared presentation pieces of the Technicals views, following the app-wide system written down in
// components/ir/typography.ts: 14 px/600 section titles, 13 px rows and numbers, 11 px captions, tabular
// right-aligned figures with a true minus sign, 28 px rows, hairline borders, colour only where it encodes data.
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { Panel } from "@/components/app/page-header";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export const T = {
  section: "text-sm font-semibold tracking-tight",
  group: "text-[13px] font-semibold leading-5",
  caption: "text-[11px] leading-4 text-muted-foreground",
  th: "px-3 py-1.5 text-left align-bottom text-[11px] font-normal leading-4 text-muted-foreground",
  thNum: "px-3 py-1.5 text-right align-bottom text-[11px] font-normal leading-4 text-muted-foreground whitespace-nowrap",
  td: "px-3 py-1 text-[13px] leading-5",
  num: "num px-3 py-1 text-right text-[13px] leading-5 tabular-nums whitespace-nowrap",
  row: "border-b last:border-0",
  /** a control inside a table cell or sentence: quiet until hovered, visible focus */
  cellButton:
    "rounded-sm decoration-dotted underline-offset-[3px] transition-colors duration-150 hover:bg-highlight-soft hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
} as const;

const ok = (v: number | null | undefined): v is number => v != null && Number.isFinite(v);
/** Signed percent with a true minus sign; a quiet dash when missing. */
export const pp = (v: number | null | undefined, d = 1) =>
  ok(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(d)}%` : "–";
/** Unsigned percent. */
export const pc = (v: number | null | undefined, d = 0) => (ok(v) ? `${(v * 100).toFixed(d)}%` : "–");
export const f2 = (v: number | null | undefined, d = 2) => (ok(v) ? (v < 0 ? `−${Math.abs(v).toFixed(d)}` : v.toFixed(d)) : "–");
/** Class for the sign of a change (data colour); empty for zero or missing. */
export const signTone = (v: number | null | undefined) =>
  !ok(v) || Math.abs(v) < 1e-12 ? "" : v > 0 ? "text-positive" : "text-negative";

/** A region of the Technicals page: a finished panel with a 14 px title, never collapsed, addressable by name. */
export function TechPanel({
  section,
  id,
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
  tour,
}: {
  /** Name the assistant targets (data-section) */
  section: string;
  /** Anchor for the section nav */
  id?: string;
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  tour?: string;
}) {
  return (
    <div id={id} data-section={section} data-tour={tour} className="min-w-0 scroll-mt-[calc(var(--sticky-top,3.5rem)+3.25rem)]">
      <Panel
        collapse={false}
        className={cn("rounded-md border bg-card shadow-paper", className)}
        bodyClassName={cn("p-0", bodyClassName)}
        title={title ? <span className={T.section}>{title}</span> : undefined}
        subtitle={subtitle}
        actions={actions ? <div data-agent-controls className="flex flex-wrap items-center justify-end gap-2">{actions}</div> : undefined}
      >
        {children}
      </Panel>
    </div>
  );
}

/** Caption under a table or chart: method, basis, as-of. */
export const Note = ({ children, className }: { children: ReactNode; className?: string }) => (
  <p className={cn("border-t px-3 py-2 text-[11px] leading-4 text-muted-foreground", className)}>{children}</p>
);

/** Table wrapper: wide tables scroll sideways inside their own box, never the page. */
export const TableWrap = ({ children, min }: { children: ReactNode; min?: number }) => (
  <div className="scrollbar-thin overflow-x-auto">
    <div style={min ? { minWidth: min } : undefined}>{children}</div>
  </div>
);

export function Tag({ children, tone, title }: { children: ReactNode; tone?: "positive" | "negative" | "muted" | "strong"; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded border px-1.5 text-[11px] leading-none",
        tone === "positive" && "border-positive/40 text-positive",
        tone === "negative" && "border-negative/40 text-negative",
        tone === "muted" && "text-muted-foreground",
        tone === "strong" && "border-foreground/40 font-medium text-foreground",
      )}
    >
      {children}
    </span>
  );
}

/* ---------- evidence sheet: the table behind a figure or a sentence ---------- */
export interface Calc {
  title: string;
  value?: string;
  sub?: string;
  formula: string;
  cols: string[];
  rows: (string | number)[][];
  /** Row indices to highlight */
  hi?: Set<number>;
  note?: string;
  link?: { url: string; label: string };
}
export function CalcSheet({ calc, onClose }: { calc: Calc | null; onClose: () => void }) {
  return (
    <Sheet open={!!calc} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl" data-section="Evidence table">
        {calc && (
          <>
            <SheetHeader>
              <SheetTitle className="text-base">{calc.title}</SheetTitle>
              <SheetDescription asChild>
                <div>
                  {calc.value && <span className="num text-base font-medium text-foreground">{calc.value}</span>}
                  {calc.sub && <span className={cn("text-[13px]", calc.value && "ml-2")}>{calc.sub}</span>}
                </div>
              </SheetDescription>
            </SheetHeader>
            <p className="mt-3 rounded-md border bg-secondary/50 px-3 py-2 text-[13px] leading-5">{calc.formula}</p>
            {calc.rows.length > 0 && (
              <div className="scrollbar-thin mt-3 overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b">
                      {calc.cols.map((c, i) => (
                        <th key={c} className={cn(i === 0 ? T.th : T.thNum, "pl-0 pr-3")}>
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {calc.rows.map((r, k) => (
                      <tr key={k} className={cn("border-b", calc.hi?.has(k) && "bg-highlight-soft")}>
                        {r.map((x, i) => (
                          <td key={i} className={cn(i === 0 ? "py-1 pr-3 text-[13px] leading-5" : "num py-1 pr-3 text-right text-[13px] leading-5 tabular-nums")}>
                            {x}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {calc.note && <p className="mt-3 text-[11px] leading-4 text-muted-foreground">{calc.note}</p>}
            {calc.link && (
              <a href={calc.link.url} target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs text-link hover:underline">
                {calc.link.label} ↗
              </a>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/* ---------- in-page section nav ---------- */
export interface NavItem {
  id: string;
  label: string;
}
/**
 * Anchor links to the page's sections. A click scrolls smoothly to the section (below the sticky bars) and
 * leaves the address alone, so the route, its search state and the browser history do not change.
 */
export function SectionNav({ items, className }: { items: NavItem[]; className?: string }) {
  const [active, setActive] = useState(items[0]?.id);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const seen = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0);
        // the first section in page order that is on screen
        const first = items.find((it) => (seen.get(it.id) ?? 0) > 0);
        if (first) setActive(first.id);
      },
      { rootMargin: "-110px 0px -55% 0px", threshold: [0, 0.01, 0.5] },
    );
    for (const it of items) {
      const el = document.getElementById(it.id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.map((i) => i.id).join(",")]);
  const go = (e: MouseEvent, id: string) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    const calm = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
    setActive(id);
  };
  return (
    <nav aria-label="Sections" className={cn("scrollbar-thin flex min-w-0 items-center gap-0.5 overflow-x-auto", className)}>
      {items.map((it) => (
        <a
          key={it.id}
          href={`#${it.id}`}
          data-agent-click
          aria-current={active === it.id ? "location" : undefined}
          onClick={(e) => go(e, it.id)}
          className={cn(
            "inline-flex h-7 shrink-0 items-center rounded px-2 text-xs transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
            active === it.id ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {it.label}
        </a>
      ))}
    </nav>
  );
}

/** Thin bar showing where a value sits between 0 and 1 (a percentile), with the value as text beside it. */
export function PercentileBar({ value, className }: { value: number | null | undefined; className?: string }) {
  if (!ok(value)) return <span className="text-muted-foreground">–</span>;
  const v = Math.min(1, Math.max(0, value));
  return (
    <span className={cn("inline-flex items-center gap-2", className)} title={`${Math.round(v * 100)}th percentile`}>
      <span className="relative h-1.5 w-16 rounded-full bg-secondary">
        <span className="absolute inset-y-0 left-0 rounded-full bg-chart-1/70" style={{ width: `${v * 100}%` }} />
      </span>
    </span>
  );
}
