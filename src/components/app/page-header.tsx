import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, FileText } from "lucide-react";
import { useSource, type SourceTarget } from "@/components/source/source-context";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-4 flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="mt-1 font-display text-2xl leading-tight">{title}</h1>
        {description && (
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className,
  bodyClassName,
  collapse,
}: {
  /** Max body height before "Show more" (px); false disables collapsing. */
  collapse?: number | false;
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("panel-in min-w-0 border-y bg-card/40", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center gap-3 border-b px-3.5 py-2">
          <div className="min-w-0">
            {title && <h2 className="text-[13px] font-semibold tracking-tight">{title}</h2>}
            {subtitle && <p className="text-[11px] text-muted-foreground">{subtitle}</p>}
          </div>
          {actions && <div className="ml-auto flex items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <CollapsibleBody className={bodyClassName} limit={collapse === false ? 0 : (collapse ?? 440)}>
        {children}
      </CollapsibleBody>
    </section>
  );
}

/** Clamps tall content to `limit` px with a Show more toggle (no inner scrolling, no fade over the last rows). */
function CollapsibleBody({
  children,
  className,
  limit,
}: {
  children: ReactNode;
  className?: string;
  limit: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [tall, setTall] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || !limit) return;
    const check = () => setTall(el.scrollHeight > limit + 120);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [limit]);
  const clamped = tall && !open;
  return (
    <div className="relative">
      <div
        ref={ref}
        className={cn("min-w-0 p-3.5", clamped && "overflow-hidden", className)}
        style={clamped ? { maxHeight: limit } : undefined}
      >
        {children}
      </div>
      {tall && (
        <Button
          variant="ghost"
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="h-8 w-full justify-center gap-1 rounded-none border-t text-[11px] font-medium text-muted-foreground"
        >
          {open ? "Show less" : "Show more"}
          <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
        </Button>
      )}
    </div>
  );
}

/** A KPI tile; clicking opens its source attribution when a target is given. */
export function Stat({
  label,
  value,
  sub,
  tone,
  target,
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "positive" | "negative" | "neutral";
  target?: SourceTarget | null;
  className?: string;
}) {
  const { open } = useSource();
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
        {label}
        {target && (
          <FileText className="size-3 opacity-50 transition-opacity group-hover:opacity-100" />
        )}
      </span>
      <span className="num mt-0.5 block text-lg font-semibold leading-tight">{value}</span>
      {sub && (
        <span
          className={cn(
            "num mt-0.5 block text-[11px]",
            tone === "positive"
              ? "text-positive"
              : tone === "negative"
                ? "text-negative"
                : "text-muted-foreground",
          )}
        >
          {sub}
        </span>
      )}
    </>
  );
  const cls = cn("group block min-w-0 border-b bg-card/40 px-3 py-2 text-left", className);
  if (!target) return <div className={cls}>{body}</div>;
  return (
    <Button
      variant="ghost"
      onClick={() => open(target)}
      title={`Source: ${label}`}
      className={cn(
        cls,
        "h-auto w-full whitespace-normal rounded-none transition-colors hover:bg-highlight-soft/40",
      )}
    >
      {body}
    </Button>
  );
}

export function Empty({
  title,
  children,
  icon,
}: {
  title: string;
  children?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-card/50 px-6 py-14 text-center">
      {icon}
      <p className="mt-3 font-medium">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}
