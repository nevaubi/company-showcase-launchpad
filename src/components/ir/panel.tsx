import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Panel } from "@/components/app/page-header";
import { IR } from "@/components/ir/typography";
import { cn } from "@/lib/utils";

/**
 * Every IR region is one of these: a finished panel (hairline border, paper shadow, 6 px radius),
 * a 14 px section title, never collapsed, and a `data-section` name the assistant can target.
 */
export function IrPanel({
  section,
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
  tour,
}: {
  section: string;
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  tour?: string;
}) {
  return (
    <div data-section={section} data-tour={tour} className="min-w-0">
      <Panel
        collapse={false}
        className={cn("rounded-md border bg-card shadow-paper", className)}
        bodyClassName={bodyClassName}
        title={title ? <span className={IR.section}>{title}</span> : undefined}
        subtitle={subtitle}
        actions={actions ? <div data-agent-controls className="flex flex-wrap items-center gap-2">{actions}</div> : undefined}
      >
        {children}
      </Panel>
    </div>
  );
}

/**
 * Whether a table fits its wrapper. A table that fits needs no horizontal scroll container, so its
 * head can stick to the page while the page scrolls; one that overflows (phones, long spans) scrolls
 * sideways inside its own wrapper and keeps its first column in view instead.
 */
export function useFits<T extends HTMLElement>() {
  // A callback ref, so a table that mounts after a loading state is still observed.
  const [el, setEl] = useState<T | null>(null);
  const ref = useCallback((node: T | null) => setEl(node), []);
  const [fits, setFits] = useState(true);
  useEffect(() => {
    if (!el) return;
    const check = () => {
      const table = el.firstElementChild as HTMLElement | null;
      setFits(!table || table.scrollWidth <= el.clientWidth + 1);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [el]);
  return [ref, fits] as const;
}
