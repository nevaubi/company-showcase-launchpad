/**
 * Small shared pieces of the Data library pages (owner: unit `dataset`; other units ask through the lead).
 * Type roles follow `src/components/ir/typography.ts`: 14/600 section titles, 13/400 rows, 11/400 captions,
 * 10 px mono eyebrows. A missing value is an en dash; an empty cell says "empty", so the two never look alike.
 */
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/** A page section with its anchor, its assistant name and a header row. Never collapsed. */
export function LibrarySection({
  id,
  name,
  title,
  meta,
  actions,
  children,
  className,
}: {
  id?: string;
  /** `data-section` value: the name the assistant and the tour use. */
  name: string;
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} data-section={name} className={cn("min-w-0 scroll-mt-28", className)} aria-labelledby={id ? `${id}-title` : undefined}>
      <header className="mb-3 flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id={id ? `${id}-title` : undefined} className="text-sm font-semibold tracking-tight">
          {title}
        </h2>
        {meta && <div className="min-w-0 text-[11px] leading-4 text-muted-foreground">{meta}</div>}
        {actions && <div className="ml-auto flex flex-wrap items-center gap-1.5">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

/** The panel finish shared by tables and charts on these pages. */
export const PANEL = "min-w-0 rounded-md border bg-card shadow-paper";

/** One quiet line in place of something that cannot be shown yet. */
export function QuietLine({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-[13px] leading-5 text-muted-foreground", className)}>{children}</p>;
}

/** A stored cell: an en dash for null, the word "empty" for an empty string, otherwise the formatted text. */
export function NativeCell({ text, raw, title, className }: { text: string; raw: string | null; title?: string; className?: string }) {
  if (raw === null)
    return (
      <span className={cn("text-muted-foreground", className)} title="Missing in the source (null)">
        –
      </span>
    );
  if (raw === "")
    return (
      <span className={cn("italic text-muted-foreground/80", className)} title="Empty in the source">
        empty
      </span>
    );
  return (
    <span className={className} title={title}>
      {text}
    </span>
  );
}

/** Copies a text and says so for a moment. */
export function CopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          if (timer.current) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setDone(false), 1500);
        });
      }}
      className={cn(
        // relative: the screen-reader status inside stays in the button, not at the page's edge (it would widen a phone page)
        "relative inline-flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
        className,
      )}
    >
      {done ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      <span className="sr-only" aria-live="polite">
        {done ? "Copied" : ""}
      </span>
    </button>
  );
}

/** The first characters of a hash, the whole hash on hover, with a copy button. */
export function ShortHash({ value, label, chars = 12 }: { value: string; label: string; chars?: number }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-0.5">
      <span className="num text-[13px]" title={value}>
        {value.slice(0, chars)}
      </span>
      <CopyButton text={value} label={`Copy ${label}`} />
    </span>
  );
}

/** A thin meter for a share between 0 and 1, with the percent beside it. */
export function FillMeter({ share, title }: { share: number; title?: string }) {
  const pct = Math.max(0, Math.min(1, share)) * 100;
  const label = pct === 100 ? "100%" : pct >= 99.95 ? ">99.9%" : pct > 0 && pct < 0.05 ? "<0.1%" : `${pct.toFixed(1)}%`;
  return (
    <span className="inline-flex items-center gap-2" title={title}>
      <span aria-hidden className="h-1.5 w-14 overflow-hidden rounded-full bg-chart-1/15">
        <span className="block h-full rounded-full bg-chart-1" style={{ width: `${pct}%` }} />
      </span>
      <span className="num w-12 text-right text-[13px]">{label}</span>
    </span>
  );
}

/**
 * A link to an address of the app given as a string, navigated inside the app. For pages of the Data library that
 * another unit owns (the landing, a collection), so this page does not depend on their route types.
 */
export function HrefLink({ href, children, className, title }: { href: string; children: ReactNode; className?: string; title?: string }) {
  const router = useRouter();
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    void router.navigate({ href });
  };
  return (
    <a href={href} onClick={onClick} title={title} className={className}>
      {children}
    </a>
  );
}

/** Labelled facts as a definition list: 11 px labels, 13 px values, one row each. */
export function FactList({ items, className }: { items: { label: string; value: ReactNode }[]; className?: string }) {
  if (!items.length) return null;
  return (
    <dl className={cn("grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-[minmax(8rem,12rem)_minmax(0,1fr)]", className)}>
      {items.map((item, i) => (
        <div key={`${item.label}-${i}`} className="contents">
          <dt className="pt-0.5 text-[11px] leading-4 text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 break-words text-[13px] leading-5">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export const LINK = "underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm";
