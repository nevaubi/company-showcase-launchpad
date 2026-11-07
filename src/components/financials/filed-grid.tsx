import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface GridColumn {
  key: string;
  top: string;
  bottom?: string;
}
export interface GridCell {
  text: string;
  title?: string;
  negative?: boolean;
  /** Small marker before the value: derived quarter, calculated, restated */
  mark?: "derived" | "calc" | "restated";
  italic?: boolean;
  onClick?: () => void;
  active?: boolean;
}
export interface GridRow {
  key: string;
  label: string;
  title?: string;
  kind?: "total" | "sub" | "group" | "spacer";
  cells: (GridCell | null)[];
}

const MARK: Record<NonNullable<GridCell["mark"]>, string> = { derived: "bg-chart-3", calc: "bg-chart-4", restated: "bg-chart-5" };

/** Dense statement grid: sticky line labels, right-aligned tabular values, every value clickable to its source. */
export function FiledGrid({ head, columns, rows, scrollTo = "end", maxHeight = "70vh", footer }: {
  head: string;
  columns: GridColumn[];
  rows: GridRow[];
  scrollTo?: "start" | "end";
  maxHeight?: string;
  footer?: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = scrollTo === "end" ? el.scrollWidth : 0;
  }, [columns, scrollTo]);
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border bg-card shadow-paper">
      <div ref={scroller} className="overflow-auto scrollbar-thin" style={{ maxHeight }}>
        <table className="w-max min-w-full border-separate border-spacing-0 text-[13px]">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 min-w-56 max-w-80 border-b border-r bg-card px-4 py-2 text-left align-bottom font-medium sm:min-w-72">{head}</th>
              {columns.map((c) => (
                <th key={c.key} className="sticky top-0 z-20 min-w-28 border-b bg-card px-3 py-2 text-right align-bottom font-normal">
                  <span className="block text-[11px] text-muted-foreground">{c.top}</span>
                  {c.bottom && <span className="num block text-xs font-medium text-foreground">{c.bottom}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) =>
              r.kind === "spacer" ? (
                <tr key={r.key} aria-hidden>
                  <td colSpan={columns.length + 1} className="h-2 p-0" />
                </tr>
              ) : r.kind === "group" ? (
                <tr key={r.key}>
                  <td className="sticky left-0 z-10 border-b border-r bg-secondary px-4 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{r.label}</td>
                  <td colSpan={columns.length} className="border-b bg-secondary" />
                </tr>
              ) : (
                <tr key={r.key} className={cn("group", r.kind === "total" && "font-medium")}>
                  <td
                    title={r.title}
                    className={cn(
                      "sticky left-0 z-10 max-w-80 truncate border-b border-r bg-card px-4 py-1.5 group-hover:bg-secondary",
                      r.kind === "sub" && "pl-8 text-muted-foreground",
                      r.kind === "total" && "border-t border-t-rule",
                    )}
                  >
                    {r.label}
                  </td>
                  {r.cells.map((c, i) =>
                    !c ? (
                      <td key={i} className="border-b px-3 py-1.5 text-right text-muted-foreground/60 group-hover:bg-secondary">
                        –
                      </td>
                    ) : (
                      <td
                        key={i}
                        title={c.title}
                        tabIndex={c.onClick ? 0 : undefined}
                        onClick={c.onClick}
                        onKeyDown={(e) => e.key === "Enter" && c.onClick?.()}
                        className={cn(
                          "num relative border-b px-3 py-1.5 text-right tabular-nums group-hover:bg-secondary",
                          r.kind === "total" && "border-t border-t-rule",
                          c.negative && "text-negative",
                          c.italic && "italic",
                          c.onClick && "cursor-pointer hover:bg-highlight-soft hover:underline focus-visible:outline-2 focus-visible:outline-ring",
                          c.active && "bg-highlight-soft",
                        )}
                      >
                        {c.mark && <span aria-hidden className={cn("absolute left-1 top-2 size-1 rounded-full", MARK[c.mark])} />}
                        {c.text}
                      </td>
                    ),
                  )}
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      {footer && <div className="border-t px-4 py-2.5 text-xs text-muted-foreground">{footer}</div>}
    </div>
  );
}
