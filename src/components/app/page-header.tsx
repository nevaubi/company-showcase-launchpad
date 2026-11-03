import type { ReactNode } from "react";
import { FileText } from "lucide-react";
import { useSource, type SourceTarget } from "@/components/source/source-context";
import { cn } from "@/lib/utils";

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
    <div className={cn("mb-6 flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="mt-1.5 font-display text-[2.4rem] leading-[1.05]">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p>}
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
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("min-w-0 rounded-lg border bg-card shadow-paper", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center gap-3 border-b px-4 py-2.5">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold">{title}</h2>}
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          {actions && <div className="ml-auto flex items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={cn("min-w-0 p-4", bodyClassName)}>{children}</div>
    </section>
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
      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {label}
        {target && <FileText className="size-3 opacity-0 transition-opacity group-hover:opacity-70" />}
      </span>
      <span className="num mt-1 block text-[1.35rem] font-medium leading-tight tracking-tight">{value}</span>
      {sub && (
        <span
          className={cn(
            "num mt-0.5 block text-[11px]",
            tone === "positive" ? "text-positive" : tone === "negative" ? "text-negative" : "text-muted-foreground",
          )}
        >
          {sub}
        </span>
      )}
    </>
  );
  const cls = cn("group block rounded-lg border bg-card px-3.5 py-3 text-left shadow-paper", className);
  if (!target) return <div className={cls}>{body}</div>;
  return (
    <button onClick={() => open(target)} className={cn(cls, "transition-colors hover:border-rule hover:bg-highlight-soft/40")}>
      {body}
    </button>
  );
}

export function Empty({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed bg-card/50 px-6 py-14 text-center">
      {icon}
      <p className="mt-3 font-medium">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}
