import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { PANEL, QuietLine } from "../ui/primitives";

/**
 * One chart of "What this table holds" (and of the collection and library sections): a 13 px title, the stored field
 * code beside it where it differs, a one-line caption assembled from the counts, the chart or its table, an optional
 * control row at the right of the title. Never collapsed.
 */
export function CountPanel({
  name,
  title,
  code,
  caption,
  actions,
  children,
  className,
}: {
  /** `data-section` value. */
  name: string;
  title: ReactNode;
  code?: string | null;
  caption?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(PANEL, "grid min-w-0 grid-cols-1 content-start gap-2 px-4 py-3", className)} data-section={name}>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="min-w-0 truncate text-[13px] font-semibold">{title}</h3>
        {code && <span className="num truncate text-[11px] text-muted-foreground">{code}</span>}
        {actions && <div className="ml-auto flex shrink-0 flex-wrap items-center gap-1.5">{actions}</div>}
      </div>
      {caption && <p className="-mt-1 text-[11px] leading-4 text-muted-foreground">{caption}</p>}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** A panel's frame while its counts load, at the height its chart will take. */
export function PanelSkeleton({ name, title, height, className }: { name: string; title: string; height: number; className?: string }) {
  return (
    <div className={cn(PANEL, "grid min-w-0 grid-cols-1 content-start gap-2 px-4 py-3", className)} data-section={name} aria-busy="true">
      <h3 className="text-[13px] font-semibold">{title}</h3>
      <span className="block h-3 w-2/3 animate-pulse rounded bg-muted" />
      <span className="block animate-pulse rounded bg-muted/70" style={{ height }} />
    </div>
  );
}

/** A panel that cannot draw its chart says why in one quiet line. */
export function PanelNote({ name, title, children, className }: { name: string; title: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn(PANEL, "grid min-w-0 grid-cols-1 content-start gap-1 px-4 py-3", className)} data-section={name}>
      <h3 className="text-[13px] font-semibold">{title}</h3>
      <QuietLine>{children}</QuietLine>
    </div>
  );
}

/** The table twin of a count chart: label, an optional code, and the count, right-aligned in tabular figures. */
export function CountTable({ rows, head }: { rows: { key: string; label: string; sub?: string; text: string }[]; head: [string, string] }) {
  return (
    <table className="w-full table-fixed border-separate border-spacing-0 text-[13px]">
      <thead>
        <tr className="text-[11px] text-muted-foreground">
          <th scope="col" className="h-7 border-b px-1 text-left font-normal">
            {head[0]}
          </th>
          <th scope="col" className="h-7 w-32 border-b px-1 text-right font-normal">
            {head[1]}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} style={{ height: 29 }}>
            <td className="truncate border-b px-1" title={r.sub ? `${r.label} (${r.sub})` : r.label}>
              {r.label}
              {r.sub && <span className="num ml-1.5 text-[11px] text-muted-foreground">{r.sub}</span>}
            </td>
            <td className="num border-b px-1 text-right">{r.text}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
